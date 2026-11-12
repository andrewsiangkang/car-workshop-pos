import { NextResponse } from "next/server";
import { requireOwner, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { nextCreditNoteNumber, money } from "@/lib/docnumber";
import { PAYMENT_METHODS } from "@/lib/status";
import { getOpenShift } from "@/lib/counter";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

class UserError extends Error {}

/**
 * Issue a credit note against an invoice (boss only), optionally refunding money.
 * Body: { amount, reason, refundAmount?, refundMethod? }
 *
 * An issued invoice is never edited. A credit note reduces what the customer owes;
 * if they already paid, the refund is recorded as a negative payment.
 */
// 【中文】开退款单（仅老板）：已开出的发票不能改，只能开退款单减少应收；如果顾客已付款，退的钱记为负数付款。全部在一个事务里完成，并检查：不能超过可退金额、不能退超过已付金额。
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const { id } = await params;
    const me = await getCurrentUser();
    const b = await request.json();
    const amount = money(Number(b.amount));
    const refundAmount = money(Number(b.refundAmount) || 0);
    const reason = String(b.reason || "").trim().slice(0, 300);
    const refundMethod = PAYMENT_METHODS.includes(b.refundMethod) ? b.refundMethod : "CASH";

    if (!Number.isFinite(amount) || amount <= 0) throw new UserError("Enter the amount to credit");
    if (!reason) throw new UserError("A reason is required (it appears on the credit note)");
    if (refundAmount < 0 || refundAmount > amount) throw new UserError("Refund cannot be more than the credit amount");

    const cn = await prisma.$transaction(async (tx) => {
      const o = await tx.workOrder.findUnique({ where: { id } });
      if (!o) throw new UserError("Work order not found");
      if (!o.invoiceNumber) throw new UserError("A credit note can only be issued after the invoice");
      if (o.status === "CANCELLED") throw new UserError("Work order is cancelled");

      const creditable = money(o.totalAmount - o.creditedAmount);
      if (amount > creditable) throw new UserError(`Maximum that can still be credited is RM ${creditable.toFixed(2)}`);
      if (refundAmount > o.paidAmount + 0.005) {
        throw new UserError(`Cannot refund more than was paid (RM ${o.paidAmount.toFixed(2)})`);
      }
      const newCredited = money(o.creditedAmount + amount);
      const newPaid = money(o.paidAmount - refundAmount);
      const newTotalDue = money(o.totalAmount - newCredited);
      if (newPaid > newTotalDue + 0.005) {
        throw new UserError(
          `Customer would have paid RM ${(newPaid - newTotalDue).toFixed(2)} too much. Refund at least RM ${(refundAmount + newPaid - newTotalDue).toFixed(2)}.`
        );
      }

      // Money paid back to a customer leaves the drawer, so it must belong to an open counter session.
      let refundShiftId: string | null = null;
      if (refundAmount > 0) {
        const shift = await getOpenShift(tx);
        if (!shift) {
          throw new UserError("The counter is closed. Open the counter first (Counter page) before paying a refund.");
        }
        refundShiftId = shift.id;
      }

      // SST part of the credit, in the same proportion as on the invoice.
      const taxAmount = o.totalAmount > 0 ? money((amount * o.taxAmount) / o.totalAmount) : 0;
      const number = await nextCreditNoteNumber(tx);
      const created = await tx.creditNote.create({
        data: {
          number,
          amount,
          taxAmount,
          reason,
          refundAmount,
          refundMethod: refundAmount > 0 ? refundMethod : null,
          createdById: me?.id ?? null,
          workOrderId: id,
        },
      });
      if (refundAmount > 0) {
        await tx.payment.create({
          data: {
            amount: -refundAmount,
            method: refundMethod,
            shiftId: refundShiftId,
            workOrderId: id,
            notes: `Refund - credit note ${number}`,
            reference: String(b.refundReference || "").slice(0, 100) || null,
          },
        });
      }
      await tx.workOrder.update({
        where: { id },
        data: { creditedAmount: newCredited, paidAmount: newPaid },
      });
      return created;
    });
    if (me) await writeAuditLog({ actor: me, request, action: "CREDIT_NOTE_ISSUED", entityType: "CreditNote", entityId: cn.id, summary: `Credit note ${cn.number} issued`, details: { workOrderId: id, amount: cn.amount, refundAmount: cn.refundAmount, refundMethod: cn.refundMethod } });
    return NextResponse.json(cn, { status: 201 });
  } catch (e) {
    if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error(e);
    return NextResponse.json({ error: "Failed to issue credit note" }, { status: 500 });
  }
}
