import { NextResponse } from "next/server";
import { requireOwner, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { nextVoucherNumber, money } from "@/lib/docnumber";
import { PAYMENT_METHODS } from "@/lib/status";
import { getOpenShift } from "@/lib/counter";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

class UserError extends Error {}
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** 【中文】开一张独立的付款凭证（仅老板），用于没有供应商发票的付款，如租金、电费、工资、零星采购。 */
export async function POST(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const me = await getCurrentUser();
    const b = await request.json();
    const payee = text(b.payee, 150);
    const purpose = text(b.purpose, 300);
    const amount = money(Number(b.amount));
    if (!payee) throw new UserError("Payee is required");
    if (!purpose) throw new UserError("Purpose is required");
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000) throw new UserError("Enter a valid amount");
    const method = PAYMENT_METHODS.includes(b.method) ? b.method : "CASH";

    const v = await prisma.$transaction(async (tx) => {
      // Cash taken out of the counter drawer: link it to the open counter so the drawer's expected cash goes down.
      let shiftId: string | null = null;
      if (method === "CASH" && b.fromDrawer === true) {
        const shift = await getOpenShift(tx);
        if (!shift) throw new UserError("The counter is closed. Open the counter first, or untick 'Paid from the counter drawer'.");
        shiftId = shift.id;
      }
      const number = await nextVoucherNumber(tx);
      return tx.paymentVoucher.create({
        data: {
          number,
          payee,
          purpose,
          amount,
          method,
          reference: text(b.reference, 100) || null,
          notes: text(b.notes, 300) || null,
          createdById: me?.id ?? null,
          shiftId,
        },
      });
    });
    if (me) await writeAuditLog({ actor: me, request, action: "PAYMENT_VOUCHER_CREATED", entityType: "PaymentVoucher", entityId: v.id, summary: `Payment voucher ${v.number} created`, details: { payee: v.payee, amount: v.amount, method: v.method, supplierInvoiceId: v.supplierInvoiceId, shiftId: v.shiftId } });
    return NextResponse.json(v, { status: 201 });
  } catch (e) {
    if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error(e);
    return NextResponse.json({ error: "Failed to create voucher" }, { status: 500 });
  }
}
