import { NextResponse } from "next/server";
import { requireOwner, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { auditShowsPriceEdit, planPriceRestore, type PriceRestorePlan } from "@/lib/money-stock-prices.mjs";

export const dynamic = "force-dynamic";

class UserError extends Error {}

/**
 * 【中文】作废录错的供应商发票（仅老板）：把入库的数量扣回来，记录作废原因。记录本身保留（7 年账目要求），不会删除。
 * Void a wrongly entered supplier invoice (boss only). The record is kept (7-year
 * record keeping) but marked void, and the stock it added is taken back out.
 * Payments must be voided first. If some of the stock has already been used,
 * the void is refused so stock never goes negative — fix it with a stock adjustment.
 * The cost / selling prices the invoice overwrote are put back, but only while the item still
 * carries the prices this invoice set (money-stock-prices.mjs); otherwise they are left and the
 * audit log says why.
 * 【中文】作废时把这张发票改掉的成本价 / 售价放回原价——只有库存价格仍是这张发票设定的才放回，否则保持不变并在审计日志说明。
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

    const prices = await prisma.$transaction(async (tx) => {
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
      // Prices: has a later supplier invoice (not voided) or a manual edit changed them since?
      const ids = [...back.keys()];
      const laterLines = ids.length
        ? await tx.supplierInvoiceItem.findMany({
            where: { inventoryItemId: { in: ids }, invoiceId: { not: id }, invoice: { voidedAt: null, createdAt: { gt: inv.createdAt } } },
            select: { inventoryItemId: true },
          })
        : [];
      const edits = ids.length
        ? await tx.auditLog.findMany({
            where: { entityType: "InventoryItem", entityId: { in: ids }, action: "INVENTORY_UPDATED", createdAt: { gt: inv.createdAt } },
            select: { entityId: true, details: true },
          })
        : [];
      const changedLater = new Set<string>([
        ...laterLines.map((l) => l.inventoryItemId as string),
        ...edits.filter((e) => auditShowsPriceEdit(e.details)).map((e) => e.entityId as string),
      ]);
      const plan = planPriceRestore({ lines: inv.items, items: stock, changedLater });

      for (const s of stock) {
        const q = back.get(s.id)!;
        const p = plan.find((x) => x.inventoryItemId === s.id);
        await tx.inventoryItem.update({
          where: { id: s.id },
          data: {
            quantityOnHand: { decrement: q },
            ...(p?.cost.action === "restore" && p.cost.to !== null ? { costPrice: p.cost.to } : {}),
            ...(p?.selling.action === "restore" && p.selling.to !== null ? { sellingPrice: p.selling.to } : {}),
          },
        });
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
      return plan;
    });
    // Each item's prices: put back (before → after), or left as they are and why
    // ("changed_later" = a later supplier invoice or a manual edit changed them since).
    const priceDetails = prices.map((p: PriceRestorePlan) => ({
      inventoryItemId: p.inventoryItemId,
      name: p.name,
      cost: p.cost.action === "restore" ? { before: p.cost.current, after: p.cost.to } : { kept: p.cost.current, reason: p.cost.reason },
      selling: p.selling.action === "restore" ? { before: p.selling.current, after: p.selling.to } : { kept: p.selling.current, reason: p.selling.reason },
    }));
    const pricesLeft = prices.filter((p) => p.cost.action === "keep" || p.selling.action === "keep").map((p) => p.name);
    if (actor) {
      await writeAuditLog({
        actor, request, action: "SUPPLIER_INVOICE_VOIDED", entityType: "SupplierInvoice", entityId: id,
        summary: `Supplier invoice voided`,
        details: { reason, prices: priceDetails, ...(pricesLeft.length ? { pricesLeftBecauseChangedSince: pricesLeft } : {}) },
      });
    }
    return NextResponse.json({ ok: true, pricesLeft });
  } catch (e) {
    if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error(e);
    return NextResponse.json({ error: "Failed to void" }, { status: 500 });
  }
}
