import { NextResponse } from "next/server";
import { requireOwner, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { money } from "@/lib/docnumber";
import { writeAuditLog } from "@/lib/audit";
import { liveSettlement } from "@/lib/counter";
import { readClosingSnapshot } from "@/lib/counter-calc";

export const dynamic = "force-dynamic";

class UserError extends Error {}

/**
 * 【中文】作废付款凭证（仅老板）：保留记录并注明作废原因；如果是付供应商发票的款，发票的已付金额会减回去。
 * Void a payment voucher (boss only). The voucher is kept and marked void; if it
 * paid a supplier invoice, that invoice's paid amount and status are put back.
 * A voucher paid from the drawer of a day that is already closed never changes that day's
 * settlement (see below).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const { id } = await params;
    const actor = await getCurrentUser();
    const b = await request.json().catch(() => ({}));
    const reason = typeof b.reason === "string" ? b.reason.trim().slice(0, 300) : "";
    if (!reason) throw new UserError("Please give a reason for voiding");

    const result = await prisma.$transaction(async (tx) => {
      const v = await tx.paymentVoucher.findUnique({ where: { id } });
      if (!v) throw new UserError("Voucher not found");
      if (v.voidedAt) throw new UserError("Already voided");
      // Cash paid out of a counter drawer whose day is already closed: that day's settlement stays
      // exactly as it was closed (its totals are frozen in closingSnapshot; a day closed before
      // v0.3.30 is frozen now, before the void). No cash is added to today's drawer: if the money
      // comes back, it is counted in when it arrives. The void is listed on the closed day's report.
      // A voucher not paid from a drawer is still in the "Money Paid Out by Voucher" total of the
      // closed day it was paid in, so that day is frozen too. The snapshot is stamped with the time
      // it was taken, so the report knows which voids happened before it (already left out of it).
      // 【中文】从已关柜那天的钱柜付出的凭证：那天的结算保持关柜时的数字（v0.3.30 之前关柜的，先在作废前冻结）；不是从钱柜付的凭证，付款当天已关柜的也一样先冻结；不会把现金加到今天的钱柜；作废记录会列在那天的报表上。
      const now = new Date();
      let closedShift: { id: string; closedAt: Date } | null = null;
      const frozenNow: string[] = [];
      const closedShifts = v.shiftId
        ? await tx.cashShift.findMany({ where: { id: v.shiftId, closedAt: { not: null } } })
        : await tx.cashShift.findMany({ where: { openedAt: { lte: v.paidAt }, closedAt: { gte: v.paidAt } } });
      for (const shift of closedShifts) {
        if (!shift.closedAt) continue;
        if (v.shiftId) closedShift = { id: shift.id, closedAt: shift.closedAt };
        if (!readClosingSnapshot(shift.closingSnapshot)) {
          const snapshot = await liveSettlement(shift, tx, now);
          await tx.cashShift.update({ where: { id: shift.id }, data: { closingSnapshot: JSON.stringify(snapshot) } });
          frozenNow.push(shift.id);
        }
      }
      await tx.paymentVoucher.update({ where: { id }, data: { voidedAt: now, voidReason: reason } });
      if (v.supplierInvoiceId) {
        const inv = await tx.supplierInvoice.findUnique({ where: { id: v.supplierInvoiceId } });
        if (inv) {
          const paid = money(Math.max(0, inv.paidAmount - v.amount));
          await tx.supplierInvoice.update({
            where: { id: inv.id },
            data: {
              paidAmount: paid,
              status: paid <= 0.005 ? "UNPAID" : money(inv.totalAmount - paid) <= 0.005 ? "PAID" : "PARTIAL",
            },
          });
        }
      }
      return { number: v.number, amount: v.amount, method: v.method, shiftId: v.shiftId, supplierInvoiceId: v.supplierInvoiceId, closedShift, frozenNow };
    }, { timeout: 15000 });
    if (actor) {
      await writeAuditLog({
        actor, request, action: "PAYMENT_VOUCHER_VOIDED", entityType: "PaymentVoucher", entityId: id,
        summary: `Payment voucher ${result.number} voided`,
        details: {
          reason,
          before: { voided: false },
          after: { voided: true },
          amount: result.amount,
          method: result.method,
          supplierInvoiceId: result.supplierInvoiceId,
          drawerShiftId: result.shiftId,
          // Paid from a drawer whose day is closed: that day's settlement is left unchanged.
          ...(result.closedShift ? { closedDayUnchanged: true, closedShiftId: result.closedShift.id, closedAt: result.closedShift.closedAt.toISOString() } : {}),
          // Days closed before v0.3.30 whose figures were frozen just before this void.
          ...(result.frozenNow.length ? { frozenShiftIds: result.frozenNow } : {}),
        },
      });
    }
    return NextResponse.json({ ok: true, closedDayUnchanged: !!result.closedShift });
  } catch (e) {
    if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error(e);
    return NextResponse.json({ error: "Failed to void" }, { status: 500 });
  }
}
