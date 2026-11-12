import { NextResponse } from "next/server";
import { requireOwner, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { nextVoucherNumber, money } from "@/lib/docnumber";
import { PAYMENT_METHODS } from "@/lib/status";
import { getOpenShift } from "@/lib/counter";

export const dynamic = "force-dynamic";

class UserError extends Error {}

/** 【中文】付供应商发票的款（仅老板）：生成付款凭证，并更新这张发票的已付金额和状态（支持分期付款）。 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const { id } = await params;
    const me = await getCurrentUser();
    const b = await request.json();
    const amount = money(Number(b.amount));
    const method = PAYMENT_METHODS.includes(b.method) ? b.method : "CASH";
    if (!Number.isFinite(amount) || amount <= 0) throw new UserError("Enter the amount to pay");

    const voucher = await prisma.$transaction(async (tx) => {
      const inv = await tx.supplierInvoice.findUnique({ where: { id }, include: { supplier: true } });
      if (!inv) throw new UserError("Supplier invoice not found");
      if (inv.voidedAt) throw new UserError("This invoice has been voided");
      const remaining = money(inv.totalAmount - inv.paidAmount);
      if (remaining <= 0.005) throw new UserError("This invoice is already fully paid");
      if (amount > remaining + 0.005) throw new UserError(`Amount is more than the balance (RM ${remaining.toFixed(2)})`);

      let shiftId: string | null = null;
      if (method === "CASH" && b.fromDrawer === true) {
        const shift = await getOpenShift(tx);
        if (!shift) throw new UserError("The counter is closed. Open the counter first, or untick 'Paid from the counter drawer'.");
        shiftId = shift.id;
      }
      const number = await nextVoucherNumber(tx);
      const v = await tx.paymentVoucher.create({
        data: {
          number,
          payee: inv.supplier.name,
          purpose: `Payment for supplier invoice ${inv.invoiceNo}`,
          amount,
          method,
          reference: typeof b.reference === "string" ? b.reference.trim().slice(0, 100) || null : null,
          notes: typeof b.notes === "string" ? b.notes.trim().slice(0, 300) || null : null,
          createdById: me?.id ?? null,
          supplierInvoiceId: id,
          shiftId,
        },
      });
      const paid = money(inv.paidAmount + amount);
      await tx.supplierInvoice.update({
        where: { id },
        data: { paidAmount: paid, status: money(inv.totalAmount - paid) <= 0.005 ? "PAID" : "PARTIAL" },
      });
      return v;
    });
    return NextResponse.json(voucher, { status: 201 });
  } catch (e) {
    if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error(e);
    return NextResponse.json({ error: "Failed to record payment" }, { status: 500 });
  }
}
