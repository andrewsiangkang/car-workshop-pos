import { NextResponse } from "next/server";
import { requireOwner, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { money } from "@/lib/docnumber";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

class UserError extends Error {}

/**
 * 【中文】作废付款凭证（仅老板）：保留记录并注明作废原因；如果是付供应商发票的款，发票的已付金额会减回去。
 * Void a payment voucher (boss only). The voucher is kept and marked void; if it
 * paid a supplier invoice, that invoice's paid amount and status are put back.
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

    await prisma.$transaction(async (tx) => {
      const v = await tx.paymentVoucher.findUnique({ where: { id } });
      if (!v) throw new UserError("Voucher not found");
      if (v.voidedAt) throw new UserError("Already voided");
      await tx.paymentVoucher.update({ where: { id }, data: { voidedAt: new Date(), voidReason: reason } });
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
    });
    if (actor) await writeAuditLog({ actor, request, action: "PAYMENT_VOUCHER_VOIDED", entityType: "PaymentVoucher", entityId: id, summary: `Payment voucher voided`, details: { reason } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error(e);
    return NextResponse.json({ error: "Failed to void" }, { status: 500 });
  }
}
