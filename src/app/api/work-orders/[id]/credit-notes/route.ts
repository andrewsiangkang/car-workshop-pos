import { NextResponse } from "next/server";
import { requireOwner, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { nextCreditNoteNumber, money } from "@/lib/docnumber";
import { PAYMENT_METHODS } from "@/lib/status";
import { getOpenShift } from "@/lib/counter";
import { writeAuditLog } from "@/lib/audit";
import { computeCreditNote, refundLimits, isSaneAmount, type CreditMode } from "@/lib/credit-calc.mjs";
import { returnableQty, roundQty } from "@/lib/stock-calc.mjs";
import { buildCreditNoteSnapshot } from "@/lib/doc-snapshot.mjs";
import { SELLER_SELECT } from "@/lib/docdata";

export const dynamic = "force-dynamic";

class UserError extends Error {
  constructor(message: string, public code: string | null = null) {
    super(message);
  }
}

type LinePick = { itemId: string; quantity: number; returnToStock: boolean };

/**
 * Issue a credit note against an invoice (boss only), optionally refunding money.
 * Body: { reason, refundAmount?, refundMethod?, refundReference?, and ONE of:
 *   lines: [{ itemId, quantity, returnToStock? }]   — credit these invoice lines (returned part, wrong job)
 *   split: { labor, parts }                          — goodwill / price correction, amounts before SST
 *   amount                                           — goodwill incl. SST (SST pro-rata; only when SST covers all lines)
 * }
 *
 * An issued invoice is never edited. A credit note reduces what the customer owes;
 * if they already paid, the refund is recorded as a negative payment.
 */
// 【中文】开退款单（仅老板）：可以指定退哪几行（数量），SST 按原发票的税率与范围计算（只收工钱税时退零件不退税）；退回的零件可勾选"放回库存"。
// 只填金额时（优惠/改价）：全部收税才按比例算税；只收工钱税时必须按行或拆分工钱/零件。付款时四舍五入少收的单也能全额退、全额退钱。全部在一个事务里完成。
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const { id } = await params;
    const me = await getCurrentUser();
    const b = await request.json();
    // A huge pasted number answers 400, not a 500 from the sen helpers (amount / split are
    // checked the same way inside computeCreditNote).
    if (!isSaneAmount(b.refundAmount)) throw new UserError("Amount is too large");
    const refundAmount = money(Number(b.refundAmount) || 0);
    const reason = String(b.reason || "").trim().slice(0, 300);
    const refundMethod = PAYMENT_METHODS.includes(b.refundMethod) ? b.refundMethod : "CASH";

    const picks: LinePick[] = Array.isArray(b.lines)
      ? b.lines.slice(0, 200).map((l: Record<string, unknown>) => ({
          itemId: String(l?.itemId || ""),
          quantity: Number(l?.quantity) || 0,
          returnToStock: l?.returnToStock === true,
        })).filter((l: LinePick) => l.itemId && l.quantity !== 0)
      : [];
    // The panel says which mode it used; older callers that only send `amount` stay amount-only.
    const mode: CreditMode = ["lines", "split", "amount"].includes(b.mode)
      ? b.mode
      : picks.length ? "lines" : b.split && typeof b.split === "object" ? "split" : "amount";

    if (!reason) throw new UserError("A reason is required (it appears on the credit note)");
    if (refundAmount < 0) throw new UserError("Refund cannot be negative");

    const result = await prisma.$transaction(async (tx) => {
      const o = await tx.workOrder.findUnique({
        where: { id },
        include: {
          items: true,
          customer: true,
          vehicle: true,
          creditNotes: { select: { taxAmount: true, lines: { select: { workOrderItemId: true, quantity: true } } } },
        },
      });
      if (!o) throw new UserError("Work order not found");
      if (!o.invoiceNumber) throw new UserError("A credit note can only be issued after the invoice");
      if (o.status === "CANCELLED") throw new UserError("Work order is cancelled");

      // What earlier credit notes already credited (SST and quantities per invoice line).
      const creditedTax = money(o.creditNotes.reduce((s, cn) => s + cn.taxAmount, 0));
      const creditedQty: Record<string, number> = {};
      for (const cn of o.creditNotes) {
        for (const l of cn.lines) {
          if (l.workOrderItemId) creditedQty[l.workOrderItemId] = roundQty((creditedQty[l.workOrderItemId] || 0) + l.quantity);
        }
      }

      const calc = computeCreditNote({
        invoice: { totalAmount: o.totalAmount, taxAmount: o.taxAmount, taxRate: o.taxRate, taxScope: o.taxScope, discount: o.discount, items: o.items },
        creditedAmount: o.creditedAmount,
        creditedTax,
        creditedQty,
        mode,
        lines: picks,
        split: mode === "split" ? { labor: Number(b.split?.labor) || 0, parts: Number(b.split?.parts) || 0 } : undefined,
        amount: mode === "amount" ? Number(b.amount) : undefined,
      });
      if (!calc.ok) throw new UserError(calc.error, calc.code);
      const { amount, taxAmount } = calc;

      // Refund limits allow for the cash rounding at payment (a bill rounded down can still be
      // fully credited and everything paid refunded). Kept for reference, the old check was
      // newPaid <= o.totalAmount + (o.roundingAdjustment || 0) - newCredited, which went below
      // zero after a negative rounding; refundLimits clamps it and clears it on a full credit.
      const limits = refundLimits({
        totalAmount: o.totalAmount,
        creditedAmount: o.creditedAmount,
        paidAmount: o.paidAmount,
        roundingAdjustment: o.roundingAdjustment || 0,
        amount,
        refundAmount,
      });
      if (!limits.ok) throw new UserError(limits.error || "Invalid credit note");

      // Money paid back to a customer leaves the drawer, so it must belong to an open counter session.
      let refundShiftId: string | null = null;
      if (refundAmount > 0) {
        const shift = await getOpenShift(tx);
        if (!shift) {
          throw new UserError("The counter is closed. Open the counter first (Counter page) before paying a refund.");
        }
        refundShiftId = shift.id;
      }

      // Parts going back on the shelf: only PART lines linked to inventory, and never more
      // than this job still holds (so stock is not created out of nothing).
      const itemById = new Map(o.items.map((i) => [i.id, i]));
      const ticked = calc.lines.filter((l) => {
        const it = itemById.get(l.itemId);
        return it?.type === "PART" && !!it.inventoryItemId && picks.find((p) => p.itemId === l.itemId)?.returnToStock;
      });
      const invRows = ticked.length
        ? await tx.inventoryItem.findMany({
            where: { id: { in: ticked.map((l) => itemById.get(l.itemId)!.inventoryItemId as string) } },
            select: { id: true, name: true, sku: true, quantityOnHand: true, archivedAt: true },
          })
        : [];
      const invById = new Map(invRows.map((r) => [r.id, r]));
      // A part whose inventory item was deleted cannot go back on the shelf.
      const wantReturn = ticked.filter((l) => invById.has(itemById.get(l.itemId)!.inventoryItemId as string));
      const moves = wantReturn.length
        ? await tx.stockMovement.findMany({ where: { workOrderId: id }, select: { inventoryItemId: true, quantity: true } })
        : [];
      const returnLeft = new Map<string, number>();
      for (const l of wantReturn) {
        const invId = itemById.get(l.itemId)!.inventoryItemId as string;
        const left = returnLeft.has(invId) ? returnLeft.get(invId)! : returnableQty(moves, invId);
        if (l.quantity > left + 0.0005) {
          throw new UserError("Cannot return more to stock than was taken for this job. Untick \"Return to stock\" for that line.");
        }
        returnLeft.set(invId, roundQty(left - l.quantity));
      }

      const number = await nextCreditNoteNumber(tx);
      // Freeze the particulars printed on the credit note: seller as today (but the invoice's SST
      // number when SST is credited), buyer and vehicle of the invoice it credits (H6; same buyer
      // as its e-Invoice, review Medium).
      // 【中文】冻结退款单上的资料：卖方用今天的店铺资料（有退 SST 时 SST 号用原发票的），买方、车辆跟原发票一致。
      const snapshot = buildCreditNoteSnapshot({
        shop: await tx.shopProfile.findFirst({ select: SELLER_SELECT }),
        order: o,
        customer: o.customer,
        vehicle: o.vehicle,
        taxAmount,
      });
      const created = await tx.creditNote.create({
        data: {
          number,
          docSnapshot: JSON.stringify(snapshot),
          amount,
          taxAmount,
          reason,
          refundAmount,
          refundMethod: refundAmount > 0 ? refundMethod : null,
          createdById: me?.id ?? null,
          workOrderId: id,
          lines: {
            create: calc.lines.map((l) => {
              const it = itemById.get(l.itemId)!;
              return {
                workOrderItemId: it.id,
                type: l.type,
                description: it.description,
                quantity: l.quantity,
                unitPrice: it.unitPrice,
                total: l.total,
                net: l.net,
                taxAmount: l.taxAmount,
                inventoryItemId: it.inventoryItemId,
                returnedToStock: wantReturn.includes(l) ? l.quantity : 0,
              };
            }),
          },
        },
        include: { lines: true },
      });

      const stock: Array<{ inventoryItemId: string; name: string; quantity: number; before: number; after: number }> = [];
      // Stock put back into an archived item would sit on a hidden item, so that item is shown
      // again (like cancelling a job). 【中文】零件放回已归档的项目时，该项目自动恢复显示，并记入审计日志。
      const restored: Array<{ id: string; name: string; sku: string | null; quantity: number }> = [];
      for (const l of wantReturn) {
        const invId = itemById.get(l.itemId)!.inventoryItemId as string;
        const inv = invById.get(invId)!;
        await tx.inventoryItem.update({
          where: { id: invId },
          data: { quantityOnHand: { increment: l.quantity }, ...(inv.archivedAt ? { archivedAt: null } : {}) },
        });
        if (inv.archivedAt) {
          const seen = restored.find((r) => r.id === invId);
          if (seen) seen.quantity = roundQty(seen.quantity + l.quantity);
          else restored.push({ id: invId, name: inv.name, sku: inv.sku, quantity: l.quantity });
        }
        await tx.stockMovement.create({
          data: {
            inventoryItemId: invId,
            type: "IN",
            quantity: l.quantity,
            notes: `Returned on ${number} (${o.orderNumber})`,
            workOrderId: id,
          },
        });
        const after = roundQty(inv.quantityOnHand + l.quantity);
        stock.push({ inventoryItemId: invId, name: inv.name, quantity: l.quantity, before: inv.quantityOnHand, after });
        inv.quantityOnHand = after; // two lines of the same part
      }

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
        data: { creditedAmount: limits.newCredited, paidAmount: limits.newPaid },
      });
      return {
        cn: created,
        buyerSource: snapshot.buyer.source,
        sstNumber: snapshot.seller.sstNumber, // SST number printed on the credit note
        stock,
        restored,
        before: { creditedAmount: o.creditedAmount, paidAmount: o.paidAmount },
        after: { creditedAmount: limits.newCredited, paidAmount: limits.newPaid },
      };
    }, { timeout: 15000 });

    const { cn } = result;
    if (me) {
      await writeAuditLog({
        actor: me, request, action: "CREDIT_NOTE_ISSUED", entityType: "CreditNote", entityId: cn.id,
        summary: `Credit note ${cn.number} issued`,
        details: {
          workOrderId: id, mode, amount: cn.amount, taxAmount: cn.taxAmount,
          refundAmount: cn.refundAmount, refundMethod: cn.refundMethod, buyerSource: result.buyerSource, sstNumber: result.sstNumber,
          lines: cn.lines.map((l) => ({ description: l.description, type: l.type, quantity: l.quantity, net: l.net, taxAmount: l.taxAmount, returnedToStock: l.returnedToStock })),
          before: result.before, after: result.after,
        },
      });
      if (result.stock.length) {
        await writeAuditLog({
          actor: me, request, action: "STOCK_RETURNED_ON_CREDIT_NOTE", entityType: "CreditNote", entityId: cn.id,
          summary: `Parts returned to stock on ${cn.number}`,
          details: { workOrderId: id, items: result.stock },
        });
      }
      for (const it of result.restored) {
        await writeAuditLog({
          actor: me, request, action: "INVENTORY_RESTORED", entityType: "InventoryItem", entityId: it.id,
          summary: `Inventory item restored: ${it.name} (parts returned on credit note ${cn.number})`,
          details: {
            sku: it.sku, reason: "stock returned by a credit note", creditNoteNumber: cn.number, workOrderId: id,
            quantityReturned: it.quantity, before: { archived: true }, after: { archived: false },
          },
        });
      }
    }
    return NextResponse.json(cn, { status: 201 });
  } catch (e) {
    if (e instanceof UserError) return NextResponse.json({ error: e.message, code: e.code || undefined }, { status: 400 });
    console.error(e);
    return NextResponse.json({ error: "Failed to issue credit note" }, { status: 500 });
  }
}
