import { NextResponse } from "next/server";
import { requireAuth, getCurrentUser, isOwner } from "@/lib/auth";
import { redactOrder } from "@/lib/redact";
import { prisma } from "@/lib/prisma";
import { nextDocNumber, money } from "@/lib/docnumber";
import { VALID_STATUSES, PAYMENT_METHODS } from "@/lib/status";
import { computeTotals, effectiveRate, normaliseScope } from "@/lib/tax";
import { getOpenShift } from "@/lib/counter";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

const include = { customer: true, vehicle: true, items: true, payments: true };

/** Error thrown inside a transaction that should reach the user as a 400. */
class UserError extends Error {}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const __denied = await requireAuth();
  if (__denied) return __denied;
  try {
    const { id } = await params;
    const order = await prisma.workOrder.findUnique({
      where: { id },
      include: { ...include, createdBy: { select: { name: true } } },
    });
    if (!order) return NextResponse.json({ error: "Work order not found" }, { status: 404 });
    return NextResponse.json(redactOrder(order, isOwner(await getCurrentUser())));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to load" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const __denied = await requireAuth();
  if (__denied) return __denied;
  try {
    const actor = await getCurrentUser();
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const body = await request.json();
    const action = body.action as string;
    const owner = isOwner(actor);

    const order = await prisma.workOrder.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!order) return NextResponse.json({ error: "Work order not found" }, { status: 404 });

    if (action === "generate_invoice") {
      if (order.status === "CANCELLED") {
        return NextResponse.json({ error: "Cancelled work order cannot generate invoice" }, { status: 400 });
      }
      // Number is allocated and saved in one transaction, re-checking that no other
      // click already issued one (invoice numbers must be unique for LHDN / SST).
      // Stock shortfalls recorded when parts were taken for this job (notes contain "short").
      const shortMoves = await prisma.stockMovement.findMany({
        where: { workOrderId: id, type: "OUT", notes: { contains: "short" } },
        include: { inventoryItem: { select: { name: true, sku: true } } },
      });
      const stockWarnings = shortMoves.map((m) => {
        const label = m.inventoryItem?.name || m.inventoryItemId;
        return `${label}: ${m.notes || "stock short"}`;
      });

      const updated = await prisma.$transaction(async (tx) => {
        const fresh = await tx.workOrder.findUnique({ where: { id }, select: { invoiceNumber: true } });
        if (fresh?.invoiceNumber) return tx.workOrder.findUnique({ where: { id }, include });
        const invoiceNumber = await nextDocNumber("INV", "invoiceNumber", tx);
        // SST is fixed when the invoice is issued, at the shop's rate on that day
        // (the quote may have been made before the shop registered or the rate changed).
        const shop = await tx.shopProfile.findFirst({ select: { sstNumber: true, sstRate: true, sstScope: true } });
        const t = computeTotals(order.items, order.discount, effectiveRate(shop), normaliseScope(shop?.sstScope));
        return tx.workOrder.update({
          where: { id },
          data: {
            taxRate: t.taxRate,
            taxScope: t.taxScope,
            taxAmount: t.taxAmount,
            totalAmount: t.totalAmount,
            invoiceNumber,
            status: "COMPLETED",
            invoicedAt: new Date(),
            completedAt: order.completedAt || new Date(),
          },
          include,
        });
      });
      if (updated) await writeAuditLog({ actor, request, action: "INVOICE_ISSUED", entityType: "WorkOrder", entityId: id, summary: `Invoice issued for ${order.orderNumber}`, details: { invoiceNumber: updated.invoiceNumber, totalAmount: updated.totalAmount } });
      const body = updated ? redactOrder(updated, owner) : updated;
      return NextResponse.json(
        body && typeof body === "object"
          ? { ...body, stockWarnings: stockWarnings.length ? stockWarnings : undefined }
          : body
      );
    }

    if (action === "record_payment") {
      if (!order.invoiceNumber) {
        return NextResponse.json({ error: "Please generate invoice before recording payment" }, { status: 400 });
      }
      if (order.status === "CANCELLED") {
        return NextResponse.json({ error: "Cannot take payment for a cancelled work order" }, { status: 400 });
      }
      // Accept multiple payment rows for one invoice (split payment), while keeping the legacy single-row payload compatible.
      const requestedPayments = Array.isArray(body.payments) ? body.payments : [body];
      if (!requestedPayments.length || requestedPayments.length > 10) throw new UserError("Add between 1 and 10 payment methods");

      // Balance is re-read INSIDE the transaction, so a double-click / two cashiers
      // cannot record the same balance twice (overpayment).
      const updated = await prisma.$transaction(async (tx) => {
        // Every payment belongs to a counter session, so the day can be settled afterwards.
        const shift = await getOpenShift(tx);
        if (!shift) {
          throw new UserError("The counter is closed. Open the counter first (Counter page), then take payment.");
        }
        const cur = await tx.workOrder.findUnique({
          where: { id },
          select: { totalAmount: true, paidAmount: true, creditedAmount: true, receiptNumber: true },
        });
        if (!cur) throw new UserError("Work order not found");
        const remainingCents = Math.max(0, Math.round((cur.totalAmount - cur.creditedAmount - cur.paidAmount + Number.EPSILON) * 100));
        const remaining = remainingCents / 100;
        if (remaining <= 0) throw new UserError("This work order is fully paid");
        type SplitPaymentRow = {
          amount: number;
          method: string;
          tendered: number | null;
          changeGiven: number | null;
          reference: string | null;
        };
        const rows: SplitPaymentRow[] = requestedPayments.map((row: Record<string, unknown>) => {
          const method = PAYMENT_METHODS.includes(String(row.method)) ? String(row.method) : "CASH";
          const amount = row.amount === undefined || row.amount === "" ? remaining : money(Number(row.amount));
          if (!Number.isFinite(amount) || amount <= 0) throw new UserError("Every payment amount must be greater than zero");
          let tendered: number | null = null;
          let changeGiven: number | null = null;
          if (method === "CASH") {
            const raw = row.tendered;
            tendered = raw === undefined || raw === null || raw === "" ? amount : money(Number(raw));
            if (!Number.isFinite(tendered) || tendered > 100000000) throw new UserError("Invalid cash received amount");
            if (tendered < amount) throw new UserError(`Cash received (RM ${tendered.toFixed(2)}) is less than the cash payment (RM ${amount.toFixed(2)})`);
            changeGiven = money(tendered - amount);
          }
          return { amount, method, tendered, changeGiven, reference: String(row.reference || "").slice(0, 100) || null };
        });
        const totalCents = rows.reduce<number>((sum: number, row: SplitPaymentRow) => sum + Math.round(row.amount * 100), 0);
        const total = totalCents / 100;
        if (totalCents > remainingCents) throw new UserError(`Payment amount RM ${total.toFixed(2)} cannot exceed remaining balance RM ${remaining.toFixed(2)}`);
        const receiptNumber = cur.receiptNumber || (await nextDocNumber("RC", "receiptNumber", tx));
        await tx.payment.createMany({
          data: rows.map((row) => ({
            amount: row.amount,
            method: row.method as any,
            tendered: row.tendered,
            changeGiven: row.changeGiven,
            shiftId: shift.id,
            workOrderId: id,
            notes: String(body.notes || "").slice(0, 500) || null,
            reference: row.reference,
          })),
        });
        return tx.workOrder.update({
          where: { id },
          data: { receiptNumber, paidAmount: money(cur.paidAmount + total), paidAt: new Date() },
          include,
        });
      });
      await writeAuditLog({ actor, request, action: "PAYMENT_RECORDED", entityType: "WorkOrder", entityId: id, summary: `Payment recorded for ${order.orderNumber}`, details: { payments: requestedPayments.map((row: Record<string, unknown>) => ({ method: row.method, amount: row.amount })), cumulativePaidAmount: updated.paidAmount, receiptNumber: updated.receiptNumber } });
      return NextResponse.json(redactOrder(updated, owner));
    }

    // Staff typed the buyer's details (e.g. after looking the TIN up by NRIC): used when submitting to LHDN.
    if (action === "save_buyer") {
      if (!order.invoiceNumber) return NextResponse.json({ error: "Generate the invoice first" }, { status: 400 });
      if (order.eInvoiceUuid && !["invalid", "cancelled"].includes((order.eInvoiceStatus || "").toLowerCase())) {
        return NextResponse.json({ error: "Already submitted to LHDN" }, { status: 409 });
      }
      const idType = String(body.idType || "NRIC").toUpperCase();
      const idNo = String(body.idNo || "").toUpperCase().replace(/[\s-]/g, "");
      const tin = String(body.tin || "").toUpperCase().replace(/\s/g, "");
      const name = String(body.name || "").replace(/\s+/g, " ").trim().slice(0, 150);
      if (!["NRIC", "PASSPORT", "BRN", "ARMY"].includes(idType)) return NextResponse.json({ error: "Invalid ID type" }, { status: 400 });
      if (!/^[A-Z0-9]{6,20}$/.test(tin)) return NextResponse.json({ error: "TIN looks wrong" }, { status: 400 });
      if (idType === "NRIC" ? !/^\d{12}$/.test(idNo) : !/^[A-Z0-9]{5,20}$/.test(idNo)) {
        return NextResponse.json({ error: "ID number looks wrong" }, { status: 400 });
      }
      if (name.length < 2) return NextResponse.json({ error: "Name required" }, { status: 400 });
      const updated = await prisma.workOrder.update({
        where: { id },
        data: { buyerRequestedAt: new Date(), buyerName: name, buyerTin: tin, buyerIdType: idType, buyerIdNo: idNo },
        include,
      });
      await writeAuditLog({ actor, request, action: "EINVOICE_BUYER_UPDATED", entityType: "WorkOrder", entityId: id, summary: `e-Invoice buyer details updated for ${order.orderNumber}` });
      return NextResponse.json(redactOrder(updated, owner));
    }

    if (action === "save_einvoice") {
      const uuid = String(body.uuid || "").trim();
      const longId = String(body.longId || "").trim() || null;
      if (!order.invoiceNumber) {
        return NextResponse.json({ error: "Generate the invoice first" }, { status: 400 });
      }
      // LHDN UUIDs / Long IDs are short alphanumeric codes.
      if (!/^[A-Za-z0-9]{10,40}$/.test(uuid) || (longId && !/^[A-Za-z0-9]{10,80}$/.test(longId))) {
        return NextResponse.json({ error: "UUID / Long ID format looks wrong" }, { status: 400 });
      }
      const updated = await prisma.workOrder.update({
        where: { id },
        data: {
          eInvoiceUuid: uuid,
          eInvoiceLongId: longId,
          eInvoiceStatus: longId ? "valid" : "pending",
        },
        include,
      });
      await writeAuditLog({ actor, request, action: "EINVOICE_REFERENCE_UPDATED", entityType: "WorkOrder", entityId: id, summary: `e-Invoice reference updated for ${order.orderNumber}`, details: { hasLongId: Boolean(longId) } });
      return NextResponse.json(redactOrder(updated, owner));
    }

    if (action === "update_status") {
      const next = body.status as string;
      if (!VALID_STATUSES.includes(next)) {
        return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      }
      if (order.status === "CANCELLED") {
        return NextResponse.json({ error: "This work order is cancelled and cannot be changed" }, { status: 400 });
      }
      // An issued invoice is a tax record: it may not be quietly moved back to draft/quote.
      if (order.invoiceNumber && next !== "CANCELLED" && next !== "COMPLETED") {
        return NextResponse.json(
          { error: "An invoice has been issued - the job can only stay Completed or be Cancelled" },
          { status: 400 }
        );
      }

      if (next === "CANCELLED") {
        if (order.paidAmount > 0) {
          return NextResponse.json(
            { error: "Payment has been received. Refund it first (and issue a credit note) before cancelling." },
            { status: 400 }
          );
        }
        if (order.creditedAmount > 0) {
          return NextResponse.json(
            { error: "Credit notes exist for this invoice. Use a credit note for the remaining amount instead of cancelling." },
            { status: 400 }
          );
        }
        if (order.consolidatedId) {
          return NextResponse.json(
            { error: "This invoice was reported in a monthly consolidated e-Invoice. Issue a credit note instead of cancelling." },
            { status: 400 }
          );
        }
        if (order.invoiceNumber && !owner) {
          return NextResponse.json({ error: "Only the boss can cancel an invoiced job" }, { status: 403 });
        }
        if (order.eInvoiceUuid && order.eInvoiceStatus !== "cancelled" && order.eInvoiceStatus !== "invalid") {
          return NextResponse.json(
            {
              error:
                "This invoice was sent to LHDN MyInvois. Cancel it in the MyInvois portal first " +
                "(allowed within 72 hours of validation; after that a credit note is required).",
            },
            { status: 400 }
          );
        }
      }

      const data: Record<string, unknown> = { status: next };
      if (next === "CONFIRMED") data.confirmedAt = new Date();
      if (next === "COMPLETED") data.completedAt = order.completedAt || new Date();

      const updated = await prisma.$transaction(async (tx) => {
        if (next === "CANCELLED") {
          // Put parts taken for this job back into stock (previously they were lost).
          const moves = await tx.stockMovement.findMany({ where: { workOrderId: id } });
          const net = new Map<string, number>();
          for (const m of moves) net.set(m.inventoryItemId, (net.get(m.inventoryItemId) || 0) + m.quantity);
          for (const [itemId, q] of net) {
            if (q >= 0) continue; // nothing outstanding
            await tx.inventoryItem.update({
              where: { id: itemId },
              data: { quantityOnHand: { increment: -q } },
            });
            await tx.stockMovement.create({
              data: {
                inventoryItemId: itemId,
                type: "IN",
                quantity: -q,
                notes: `Returned - ${order.orderNumber} cancelled`,
                workOrderId: id,
              },
            });
          }
        }
        return tx.workOrder.update({ where: { id }, data, include });
      });
      await writeAuditLog({ actor, request, action: next === "CANCELLED" ? "WORK_ORDER_CANCELLED" : "WORK_ORDER_STATUS_CHANGED", entityType: "WorkOrder", entityId: id, summary: `${order.orderNumber}: ${order.status} → ${next}`, details: { from: order.status, to: next } });
      return NextResponse.json(redactOrder(updated, owner));
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error(e);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}
