import { NextResponse } from "next/server";
import { requireOwner, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

class UserError extends Error {}

/**
 * 【中文】作废录错的供应商发票（仅老板）：把入库的数量扣回来，记录作废原因。记录本身保留（7 年账目要求），不会删除。
 * Void a wrongly entered supplier invoice (boss only). The record is kept (7-year
 * record keeping) but marked void, and the stock it added is taken back out.
 * Payments must be voided first. If some of the stock has already been used,
 * the void is refused so stock never goes negative — fix it with a stock adjustment.
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
      const inv = await tx.supplierInvoice.findUnique({
        where: { id },
        include: { items: true, vouchers: true, supplier: true },
      });
      if (!inv) throw new UserError("Supplier invoice not found");
      if (inv.voidedAt) throw new UserError("Already voided");
      const live = inv.vouchers.filter((v) => !v.voidedAt);
      if (live.length) {
        throw new UserError(`Void its payment voucher(s) first: ${live.map((v) => v.number).join(", ")}`);
      }

      // Total quantity to take back per stock item.
      const back = new Map<string, number>();
      for (const it of inv.items) {
        if (it.inventoryItemId) back.set(it.inventoryItemId, (back.get(it.inventoryItemId) || 0) + it.quantity);
      }
      const stock = await tx.inventoryItem.findMany({ where: { id: { in: [...back.keys()] } } });
      const short = stock.filter((s) => s.quantityOnHand < (back.get(s.id) || 0));
      if (short.length) {
        throw new UserError(
          "Some of this stock has already been used: " +
            short.map((s) => `${s.name} (on hand ${s.quantityOnHand}, invoice ${back.get(s.id)})`).join("; ") +
            ". Correct it with a stock adjustment instead."
        );
      }
      for (const s of stock) {
        const q = back.get(s.id)!;
        await tx.inventoryItem.update({ where: { id: s.id }, data: { quantityOnHand: { decrement: q } } });
        await tx.stockMovement.create({
          data: {
            type: "OUT",
            quantity: -q,
            inventoryItemId: s.id,
            notes: `Void supplier invoice ${inv.supplier.name} ${inv.invoiceNo} (${inv.internalNo}): ${reason}`,
          },
        });
      }
      // The supplier's invoice number must be free to enter again correctly, but the
      // database keeps it unique per supplier — so the voided copy is renamed.
      await tx.supplierInvoice.update({
        where: { id },
        data: {
          voidedAt: new Date(),
          voidReason: reason,
          invoiceNo: `${inv.invoiceNo} [VOID ${inv.internalNo}]`.slice(0, 120),
        },
      });
    });
    if (actor) await writeAuditLog({ actor, request, action: "SUPPLIER_INVOICE_VOIDED", entityType: "SupplierInvoice", entityId: id, summary: `Supplier invoice voided`, details: { reason } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error(e);
    return NextResponse.json({ error: "Failed to void" }, { status: 500 });
  }
}
