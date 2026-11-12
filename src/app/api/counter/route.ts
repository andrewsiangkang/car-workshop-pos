import { NextResponse } from "next/server";
import { requireAuth, getCurrentUser, isOwner } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { money } from "@/lib/tax";
import { getOpenShift, summarizeShift } from "@/lib/counter";
import { NON_CASH_METHODS, breakdownTotal, depositOf, parseBreakdown, parseReconciled, varianceOf, type Breakdown } from "@/lib/counter-calc";

export const dynamic = "force-dynamic";

class UserError extends Error {}

function parseMoney(v: unknown, label: string) {
  if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) {
    throw new UserError(`${label} is required`);
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100000000) throw new UserError(`${label} is not a valid amount`);
  return money(n);
}

/** Either a denomination count (preferred) or a typed total. Returns the total and the count (if any). */
function readCash(b: Record<string, unknown>, breakdownKey: string, totalKey: string, label: string) {
  if (b[breakdownKey] !== undefined && b[breakdownKey] !== null) {
    const bd = parseBreakdown(b[breakdownKey]);
    if (!bd) throw new UserError(`${label}: the note / coin count is not valid`);
    return { total: money(breakdownTotal(bd)), breakdown: bd as Breakdown | null };
  }
  return { total: parseMoney(b[totalKey], label), breakdown: null as Breakdown | null };
}

/**
 * Open or close the counter (cash drawer). Boss and staff may both do it.
 *   { action: "open",  openingFloat | openingBreakdown }
 *   { action: "close", shiftId, countedCash | countedBreakdown, floatKept?, notes? }
 *   { action: "deposit" | "undeposit", shiftId, depositRef? }   (boss only)
 *   { action: "reconcile", shiftId, method, checked }            (boss only: card / TNG / transfer checked)
 *
 * Closing also works out the cash to bank in: counted cash minus the float left
 * in the drawer for tomorrow (costs are not deducted).

 * Closing compares the cash counted with the cash that should be there and
 * returns the shortage / overage to whoever closed the counter.
 */
export async function POST(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  try {
    const me = await getCurrentUser();
    if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const b = await request.json().catch(() => ({}));

    if (b.action === "open") {
      const { total: openingFloat, breakdown } = readCash(b, "openingBreakdown", "openingFloat", "Opening float");
      const shift = await prisma.$transaction(async (tx) => {
        if (await getOpenShift(tx)) throw new UserError("The counter is already open");
        return tx.cashShift.create({
          data: {
            openedByName: me.name,
            openingFloat,
            openingCount: breakdown ? JSON.stringify(breakdown) : null,
          },
        });
      });
      return NextResponse.json({ ok: true, id: shift.id }, { status: 201 });
    }

    if (b.action === "close") {
      const { total: counted, breakdown: countedBd } = readCash(b, "countedBreakdown", "countedCash", "Counted cash");
      const notes = typeof b.notes === "string" ? b.notes.trim().slice(0, 500) : "";

      const result = await prisma.$transaction(async (tx) => {
        const shift = await getOpenShift(tx);
        if (!shift) throw new UserError("The counter is not open");
        if (b.shiftId && b.shiftId !== shift.id) {
          throw new UserError("This counter session has changed. Please reload the page.");
        }
        // Only the boss decides how much float stays; for staff it is the same float as when opening.
        const floatKept =
          !isOwner(me) || b.floatKept === undefined || b.floatKept === null || b.floatKept === ""
            ? Math.min(shift.openingFloat, counted)
            : parseMoney(b.floatKept, "Float to keep");
        if (floatKept > counted + 0.005) throw new UserError("The float to keep cannot be more than the cash counted.");
        const depositAmount = depositOf(counted, floatKept);
        const s = await summarizeShift(shift, tx);
        const variance = varianceOf(counted, s.expectedCash);
        if (Math.abs(variance) >= 0.005 && !notes) {
          throw new UserError("The count does not match. Please write a note explaining the difference.");
        }
        await tx.cashShift.update({
          where: { id: shift.id },
          data: {
            closedAt: new Date(),
            closedByName: me.name,
            expectedCash: s.expectedCash,
            countedCash: counted,
            variance,
            notes: notes || null,
            countedBreakdown: countedBd ? JSON.stringify(countedBd) : null,
            floatKept,
            depositAmount,
          },
        });
        return { id: shift.id, variance, expectedCash: s.expectedCash, floatKept, depositAmount };
      });

      return NextResponse.json({
        ok: true,
        id: result.id,
        variance: result.variance,
        expectedCash: result.expectedCash,
        countedCash: counted,
        // The bank deposit is for the boss only.
        ...(isOwner(me) ? { floatKept: result.floatKept, depositAmount: result.depositAmount } : {}),
      });
    }

    if (b.action === "deposit" || b.action === "undeposit") {
      if (!isOwner(me)) return NextResponse.json({ error: "Only the boss can do this" }, { status: 403 });
      const shift = typeof b.shiftId === "string" ? await prisma.cashShift.findUnique({ where: { id: b.shiftId } }) : null;
      if (!shift || !shift.closedAt) throw new UserError("Settlement not found");
      if (b.action === "deposit") {
        if (shift.depositedAt) throw new UserError("This deposit is already marked as banked in");
        const ref = typeof b.depositRef === "string" ? b.depositRef.trim().slice(0, 100) : "";
        await prisma.cashShift.update({
          where: { id: shift.id },
          data: { depositedAt: new Date(), depositedByName: me.name, depositRef: ref || null },
        });
      } else {
        await prisma.cashShift.update({
          where: { id: shift.id },
          data: { depositedAt: null, depositedByName: null, depositRef: null },
        });
      }
      return NextResponse.json({ ok: true });
    }

    if (b.action === "reconcile") {
      if (!isOwner(me)) return NextResponse.json({ error: "Only the boss can do this" }, { status: 403 });
      if (!NON_CASH_METHODS.includes(b.method)) throw new UserError("Unknown payment method");
      await prisma.$transaction(async (tx) => {
        const shift = typeof b.shiftId === "string" ? await tx.cashShift.findUnique({ where: { id: b.shiftId } }) : null;
        if (!shift || !shift.closedAt) throw new UserError("Settlement not found");
        const cur = parseReconciled(shift.reconciled);
        if (b.checked === true) cur[b.method] = { by: me.name, at: new Date().toISOString() };
        else delete cur[b.method];
        await tx.cashShift.update({ where: { id: shift.id }, data: { reconciled: JSON.stringify(cur) } });
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error(e);
    return NextResponse.json({ error: "Counter update failed" }, { status: 500 });
  }
}
