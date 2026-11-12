import { NextResponse } from "next/server";
import { requireAuth, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { money } from "@/lib/tax";
import { getOpenShift, summarizeShift } from "@/lib/counter";
import { varianceOf } from "@/lib/counter-calc";

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

/**
 * Open or close the counter (cash drawer). Boss and staff may both do it.
 *   { action: "open",  openingFloat }
 *   { action: "close", shiftId, countedCash, notes? }
 *
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
      const openingFloat = parseMoney(b.openingFloat, "Opening float");
      const shift = await prisma.$transaction(async (tx) => {
        if (await getOpenShift(tx)) throw new UserError("The counter is already open");
        return tx.cashShift.create({ data: { openedByName: me.name, openingFloat } });
      });
      return NextResponse.json({ ok: true, id: shift.id }, { status: 201 });
    }

    if (b.action === "close") {
      const counted = parseMoney(b.countedCash, "Counted cash");
      const notes = typeof b.notes === "string" ? b.notes.trim().slice(0, 500) : "";

      const result = await prisma.$transaction(async (tx) => {
        const shift = await getOpenShift(tx);
        if (!shift) throw new UserError("The counter is not open");
        if (b.shiftId && b.shiftId !== shift.id) {
          throw new UserError("This counter session has changed. Please reload the page.");
        }
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
          },
        });
        return { id: shift.id, variance, expectedCash: s.expectedCash };
      });

      return NextResponse.json({
        ok: true,
        id: result.id,
        variance: result.variance,
        expectedCash: result.expectedCash,
        countedCash: counted,
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error(e);
    return NextResponse.json({ error: "Counter update failed" }, { status: 500 });
  }
}
