import { NextResponse } from "next/server";
import type { PaymentMethod } from "@prisma/client";
import { requireAuth, getCurrentUser, isOwner } from "@/lib/auth";
import { redactOrder } from "@/lib/redact";
import { prisma } from "@/lib/prisma";
import { nextDocNumber, money } from "@/lib/docnumber";
import { VALID_STATUSES, PAYMENT_METHODS } from "@/lib/status";
import { computeTotals, effectiveRate, normaliseScope } from "@/lib/tax";
import { getOpenShift } from "@/lib/counter";
import { writeAuditLog } from "@/lib/audit";
import { SANDBOX, PRODUCTION, envFromSandboxFlag, isLiveEInvoice } from "@/lib/einvoice-state.mjs";
import { isValidMyInvoisPhone, normalizeMyInvoisPhone } from "@/lib/myinvois-phone.mjs";
import { planInvoiceStock, roundQty, type StockPlanRow } from "@/lib/stock-calc.mjs";
import { archivedOnInvoice } from "@/lib/money-inventory.mjs";
import { buildInvoiceSnapshot, buyerEditLock, parseDocSnapshot } from "@/lib/doc-snapshot.mjs";
import { amountDueCents } from "@/lib/credit-calc.mjs";
import { checkStaffBuyerContact, checkStaffBuyerIdentity } from "@/lib/einvoice-rules.mjs";
import { inFlightFor, isUnconfirmed, notInFlightWhere, submitGate } from "@/lib/einvoice2-submit.mjs";
import { uuidHolderMessage, uuidRecordedElsewhere } from "@/lib/einvoice2-guard";

// An e-Invoice (the invoice's own, or the month's consolidated one) still being sent, or sent with
// no answer from LHDN: it may already be at LHDN, so nothing that depends on it may change yet.
// 【中文】发票自己的或当月合并的电子发票还在送出 / 等 LHDN 回应：可能 LHDN 已经收到，先按「检查状态」。
const INVOICE_IN_FLIGHT = "This invoice is being sent to LHDN or waiting for LHDN's answer. Press Check Status on the invoice page first.";
const CONSOLIDATED_IN_FLIGHT =
  "The monthly consolidated e-Invoice that includes this invoice is being sent or waiting for LHDN's answer. Check its status on the e-Invoice page first.";
import { SELLER_SELECT } from "@/lib/docdata";
import { planCashRounding } from "@/lib/money-payment.mjs";
import { toCents, fromCents } from "@/lib/money-core.mjs";

export const dynamic = "force-dynamic";

const include = { customer: true, vehicle: true, items: true, payments: true };

/** SST number frozen on the invoice (audit evidence of what was printed), or null. */
function issuedSst(docSnapshot: string | null | undefined) {
  return parseDocSnapshot(docSnapshot)?.seller?.sstNumber ?? null;
}

/** Error thrown inside a transaction that should reach the user as a 400. */
class UserError extends Error {}

/** Same, with another HTTP status (403 / 404). */
class StatusError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/** Not enough stock to invoice: answered as 409 STOCK_SHORT so the user can choose "Invoice anyway". */
class StockShortError extends Error {
  constructor(public items: StockPlanRow[]) {
    super("Not enough stock");
  }
}

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
      // true after the user saw the "not enough stock" list and chose "Invoice anyway".
      const allowNegativeStock = body.allowNegativeStock === true;
      const stockWarnings: string[] = [];
      const stockChanges: Array<{ inventoryItemId: string; name: string; quantity: number; before: number; after: number; short: number }> = [];

      // Number is allocated and saved in one transaction, re-checking that no other
      // click already issued one (invoice numbers must be unique for LHDN / SST).
      // Parts are taken off stock in the same transaction (no longer at quote time).
      const updated = await prisma.$transaction(async (tx) => {
        const fresh = await tx.workOrder.findUnique({ where: { id }, select: { invoiceNumber: true, status: true } });
        if (fresh?.invoiceNumber) return tx.workOrder.findUnique({ where: { id }, include });
        if (fresh?.status === "CANCELLED") throw new UserError("Cancelled work order cannot generate invoice");

        // Take the OUTSTANDING quantity of each linked part: line quantity − what this job
        // already took (older jobs took stock at quote time, sometimes only part of it).
        const invIds = Array.from(new Set(order.items.filter((i) => i.type === "PART" && i.inventoryItemId).map((i) => i.inventoryItemId as string)));
        const invRows = invIds.length
          ? await tx.inventoryItem.findMany({ where: { id: { in: invIds } }, select: { id: true, name: true, sku: true, quantityOnHand: true, archivedAt: true } })
          : [];
        const plan = invIds.length
          ? planInvoiceStock(
              order.items,
              await tx.stockMovement.findMany({ where: { workOrderId: id, inventoryItemId: { in: invIds } }, select: { inventoryItemId: true, quantity: true } }),
              invRows
            )
          : [];
        // A part the boss archived is hidden from Inventory: taking stock from it would leave a hidden
        // negative balance, so the invoice waits until it is restored. 【中文】已归档的零件要先恢复才能开发票。
        const archivedMsg = archivedOnInvoice(plan, invRows);
        if (archivedMsg) throw new UserError(archivedMsg);
        const short = plan.filter((p) => p.short > 0);
        if (short.length && !allowNegativeStock) throw new StockShortError(short);

        const invoiceNumber = await nextDocNumber("INV", "invoiceNumber", tx);
        for (const p of plan) {
          if (p.outstanding <= 0) continue;
          // With "Invoice anyway" the full quantity is taken: on hand may go below zero,
          // which shows the parts are owed until the next stock-in.
          await tx.inventoryItem.update({
            where: { id: p.inventoryItemId },
            data: { quantityOnHand: { decrement: p.outstanding } },
          });
          await tx.stockMovement.create({
            data: {
              inventoryItemId: p.inventoryItemId,
              type: "OUT",
              quantity: -p.outstanding,
              notes:
                `Used in ${order.orderNumber} (invoice ${invoiceNumber})` +
                (p.short > 0 ? ` - invoiced while stock short: ${p.short} owed (on hand was ${p.onHand})` : ""),
              workOrderId: id,
            },
          });
          const after = roundQty(p.onHand - p.outstanding);
          stockChanges.push({ inventoryItemId: p.inventoryItemId, name: p.name, quantity: p.outstanding, before: p.onHand, after, short: p.short });
          if (p.short > 0) stockWarnings.push(`${p.name || p.inventoryItemId}: ${p.short} owed (on hand ${p.onHand} → ${after})`);
        }

        // SST is fixed when the invoice is issued, at the shop's rate on that day
        // (the quote may have been made before the shop registered or the rate changed).
        const shop = await tx.shopProfile.findFirst({ select: SELLER_SELECT });
        const t = computeTotals(order.items, order.discount, effectiveRate(shop), normaliseScope(shop?.sstScope));
        // Freeze seller / buyer / vehicle as they are now, read in this same transaction, so
        // reprints never change after Settings, the customer or the car is edited (H6).
        // 【中文】开票当下冻结卖方 / 买方 / 车辆资料（同一个事务里读取），以后补印不会变。
        const now = new Date();
        const parties = await tx.workOrder.findUnique({ where: { id }, include: { customer: true, vehicle: true } });
        const snapshot = buildInvoiceSnapshot({ shop, order: parties, customer: parties?.customer, vehicle: parties?.vehicle, at: now });
        return tx.workOrder.update({
          where: { id },
          data: {
            taxRate: t.taxRate,
            taxScope: t.taxScope,
            taxAmount: t.taxAmount,
            totalAmount: t.totalAmount,
            invoiceNumber,
            status: "COMPLETED",
            invoicedAt: now,
            completedAt: order.completedAt || now,
            docSnapshot: JSON.stringify(snapshot),
          },
          include,
        });
      }, { timeout: 15000 });
      if (updated && stockChanges.length) {
        await writeAuditLog({ actor, request, action: "STOCK_TAKEN_FOR_INVOICE", entityType: "WorkOrder", entityId: id, summary: `Parts taken off stock for ${order.orderNumber}`, details: { invoiceNumber: updated.invoiceNumber, allowNegativeStock, items: stockChanges } });
      }
      if (updated) await writeAuditLog({ actor, request, action: "INVOICE_ISSUED", entityType: "WorkOrder", entityId: id, summary: `Invoice issued for ${order.orderNumber}`, details: { invoiceNumber: updated.invoiceNumber, totalAmount: updated.totalAmount, taxAmount: updated.taxAmount, sellerSstNumber: issuedSst(updated.docSnapshot), particularsSnapshot: !!updated.docSnapshot, stockShortAccepted: stockWarnings.length > 0 } });
      const out = updated ? redactOrder(updated, owner) : updated;
      return NextResponse.json(
        out && typeof out === "object"
          ? { ...out, stockWarnings: stockWarnings.length ? stockWarnings : undefined }
          : out
      );
    }

    if (action === "record_payment") {
      // Accept multiple payment rows for one invoice (split payment), while keeping the legacy single-row payload compatible.
      const requestedPayments = Array.isArray(body.payments) ? body.payments : [body];
      if (!requestedPayments.length || requestedPayments.length > 10) throw new UserError("Add between 1 and 10 payment methods");
      let roundedRows: Array<{ method: string; amount: number }> = [];
      let thisRoundingCents = 0;

      // Status and balance are re-read INSIDE the transaction, so a double-click / two cashiers /
      // a cancel at the same moment cannot record the same balance twice (overpayment).
      const updated = await prisma.$transaction(async (tx) => {
        const cur = await tx.workOrder.findUnique({
          where: { id },
          select: { totalAmount: true, paidAmount: true, creditedAmount: true, receiptNumber: true, roundingAdjustment: true, invoiceNumber: true, status: true },
        });
        if (!cur) throw new UserError("Work order not found");
        if (!cur.invoiceNumber) throw new UserError("Please generate invoice before recording payment");
        if (cur.status === "CANCELLED") throw new UserError("Cannot take payment for a cancelled work order");
        // Every payment belongs to a counter session, so the day can be settled afterwards.
        const shift = await getOpenShift(tx);
        if (!shift) {
          throw new UserError("The counter is closed. Open the counter first (Counter page), then take payment.");
        }
        // Same rule as refundLimits: a fully credited invoice owes nothing (credit-calc.mjs).
        const remainingCents = amountDueCents(cur);
        const remaining = remainingCents / 100;
        if (remaining <= 0) throw new UserError("This work order is fully paid");
        type SplitPaymentRow = {
          amount: number;
          method: string;
          tendered: number | null;
          changeGiven: number | null;
          reference: string | null;
          tenderedTyped: boolean; // false = exact money (no "cash received" typed)
        };
        const rows: SplitPaymentRow[] = requestedPayments.map((row: Record<string, unknown>) => {
          const method = PAYMENT_METHODS.includes(String(row.method)) ? String(row.method) : "CASH";
          const amount = row.amount === undefined || row.amount === "" ? remaining : money(Number(row.amount));
          if (!Number.isFinite(amount) || amount <= 0) throw new UserError("Every payment amount must be greater than zero");
          let tendered: number | null = null;
          let changeGiven: number | null = null;
          let tenderedTyped = false;
          if (method === "CASH") {
            const raw = row.tendered;
            tenderedTyped = !(raw === undefined || raw === null || raw === "");
            tendered = tenderedTyped ? money(Number(raw)) : amount;
            if (!Number.isFinite(tendered) || tendered > 100000000) throw new UserError("Invalid cash received amount");
            changeGiven = money(tendered - amount);
          }
          return { amount, method, tendered, changeGiven, reference: String(row.reference || "").slice(0, 100) || null, tenderedTyped };
        });
        let totalCents = rows.reduce<number>((sum: number, row: SplitPaymentRow) => sum + toCents(row.amount), 0);
        if (totalCents > remainingCents) throw new UserError(`Payment amount RM ${(totalCents / 100).toFixed(2)} cannot exceed remaining balance RM ${remaining.toFixed(2)}`);

        // 5-sen rounding (Bank Negara) applies to the CASH part of the bill only: card, TNG and
        // transfer rows stay exact, and with a split payment only the cash part is rounded. It is
        // decided only when this payment settles the whole balance (money-payment.mjs).
        // 【中文】5 仙进位只适用于现金部分：刷卡 / TNG / 转账不进位；拆分付款只对现金部分进位；付清余额时才进位。
        const roundingMode = String(body.roundingMode || "NONE");
        if (!["NONE", "AUTO", "MANUAL"].includes(roundingMode)) throw new UserError("Invalid rounding mode");
        const plan = planCashRounding({
          remainingCents,
          rows: rows.map((row) => ({ method: row.method, amountCents: toCents(row.amount) })),
          rounding: roundingMode !== "NONE",
        });
        if (!plan.ok) throw new UserError(plan.error || "Invalid payment");
        if (roundingMode === "MANUAL") {
          // Legacy clients: a typed adjustment is accepted only when it is exactly the BNM rounding of the cash part.
          const typed = toCents(Number(body.roundingAdjustment || 0));
          if (typed !== plan.adjustmentCents) {
            throw new UserError("Rounding applies to the cash part only, to the nearest RM0.05 (BNM table)");
          }
        }
        const roundingAdjustmentCents = plan.adjustmentCents;
        if (plan.roundedRow >= 0) {
          const row = rows[plan.roundedRow];
          row.amount = fromCents(plan.amounts[plan.roundedRow]);
          // Exact money (nothing typed in "cash received") means the customer handed over the rounded amount.
          if (!row.tenderedTyped) row.tendered = row.amount;
          if (row.tendered !== null) row.changeGiven = money(row.tendered - row.amount);
        }
        // Cash handed over must cover each cash row (after rounding). 【中文】收到的现金不能少于这一行（进位后）的金额。
        for (const row of rows) {
          if (row.tendered !== null && toCents(row.tendered) < toCents(row.amount)) {
            throw new UserError(`Cash received (RM ${row.tendered.toFixed(2)}) is less than the cash payment (RM ${row.amount.toFixed(2)})`);
          }
        }
        totalCents += roundingAdjustmentCents;
        roundedRows = rows.map((row) => ({ method: row.method, amount: row.amount }));
        thisRoundingCents = roundingAdjustmentCents;
        const total = totalCents / 100;
        const receiptNumber = cur.receiptNumber || (await nextDocNumber("RC", "receiptNumber", tx));
        await tx.payment.createMany({
          data: rows.map((row) => ({
            amount: row.amount,
            method: row.method as PaymentMethod,
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
          data: {
            receiptNumber,
            roundingAdjustment: money(cur.roundingAdjustment + roundingAdjustmentCents / 100),
            paidAmount: money(cur.paidAmount + total),
            paidAt: new Date(),
          },
          include,
        });
      });
      await writeAuditLog({ actor, request, action: "PAYMENT_RECORDED", entityType: "WorkOrder", entityId: id, summary: `Payment recorded for ${order.orderNumber}`, details: { payments: roundedRows, cashRoundingThisPayment: thisRoundingCents / 100, roundingAdjustment: updated.roundingAdjustment, cumulativePaidAmount: updated.paidAmount, receiptNumber: updated.receiptNumber } });
      return NextResponse.json(redactOrder(updated, owner));
    }

    // Staff typed the buyer's details (e.g. after looking the TIN up by NRIC): used when submitting to LHDN.
    if (action === "save_buyer") {
      if (!order.invoiceNumber) return NextResponse.json({ error: "Generate the invoice first" }, { status: 400 });
      // Locked once LHDN has the sale: its own real e-Invoice, or a real monthly consolidated
      // e-Invoice that reported it as General Public. A buyer saved after that would change every
      // reprint of the invoice, receipt and credit notes although LHDN never got it (H6).
      // A sandbox test does not lock the buyer: the real e-Invoice has not been issued yet.
      // 【中文】LHDN 已经有这笔销售（正式电子发票或正式合并电子发票）后，就不能再改买方，否则补印的单据会和 LHDN 不一样。
      const linkedCon = order.consolidatedId
        ? await prisma.consolidatedInvoice.findUnique({
            where: { id: order.consolidatedId },
            select: { eInvoiceUuid: true, eInvoiceStatus: true, eInvoiceEnv: true },
          })
        : null;
      // LHDN system Settings are on: an unanswered sandbox test does not lock a real buyer.
      const settingsEnv = envFromSandboxFlag((await prisma.shopProfile.findFirst({ select: { myInvoisSandbox: true } }))?.myInvoisSandbox);
      const lock = buyerEditLock(order, linkedCon, settingsEnv);
      if (lock === "submitted") {
        return NextResponse.json({ error: "Already submitted to LHDN" }, { status: 409 });
      }
      if (lock === "consolidated") {
        return NextResponse.json(
          { error: "This invoice was already reported to LHDN in a monthly consolidated e-Invoice, so its buyer can no longer be changed." },
          { status: 409 }
        );
      }
      // Same rules as the customer's QR form: the TIN may be left blank only for a Malaysian
      // individual (NRIC); the ID number is checked for its type. 【中文】和顾客扫码表格同一套规则。
      const ident = checkStaffBuyerIdentity(body);
      if (!ident.ok) return NextResponse.json({ error: ident.error, field: ident.field }, { status: 400 });
      const { name, tin, idType, idNo } = ident.value;
      const phoneIn = String(body.phone ?? "").trim();
      // LHDN needs a named buyer's phone on an individual e-Invoice (CF410).
      if (phoneIn && !isValidMyInvoisPhone(phoneIn, { allowNA: false })) {
        return NextResponse.json({ error: "Phone number looks wrong (e.g. 012-345 6789 or +60 12-345 6789)" }, { status: 400 });
      }
      // Address, e-mail and phone come from the same form (pre-filled with what is stored) and
      // replace what an earlier QR request saved: a buyer chosen by staff (e.g. the driver's
      // employer) must not be printed and sent to LHDN with the QR sender's own address / phone.
      // 【中文】地址、电邮、电话都以店员表格为准（表格已预先填好现有资料），不会把公司配上扫码人的私人地址和电话。
      const contact = checkStaffBuyerContact(body);
      if (!contact.ok) {
        const error =
          contact.errors.address === "too_long"
            ? "Buyer address is too long for LHDN (street at most 150, city at most 50 characters)"
            : contact.errors.address
              ? "Buyer address: fill in the street, a 5-digit postcode, city and state, or leave all four empty"
              : "Email looks wrong";
        return NextResponse.json({ error }, { status: 400 });
      }
      const c = contact.value;
      // Written only while no submission holds the invoice (Submit may have been pressed on
      // another device since the check above), so LHDN always gets the buyer that is stored.
      // 【中文】只在没有提交占位时才写入（别的电脑可能刚按了提交），保证 LHDN 收到的买方和保存的一样。
      const saved = await prisma.workOrder.updateMany({
        where: { id, ...notInFlightWhere(settingsEnv) },
        data: {
          buyerRequestedAt: new Date(), buyerName: name, buyerTin: tin || null, buyerIdType: idType, buyerIdNo: idNo,
          buyerPhone: phoneIn ? normalizeMyInvoisPhone(phoneIn) : null,
          buyerEmail: c.email || null,
          buyerAddress: c.address || null,
          buyerPostcode: c.postcode || null,
          buyerCity: c.city || null,
          buyerStateCode: c.stateCode || null,
        },
      });
      if (saved.count === 0) return NextResponse.json({ error: INVOICE_IN_FLIGHT, code: "SUBMIT_IN_PROGRESS" }, { status: 409 });
      const updated = await prisma.workOrder.findUniqueOrThrow({ where: { id }, include });
      await writeAuditLog({ actor, request, action: "EINVOICE_BUYER_UPDATED", entityType: "WorkOrder", entityId: id, summary: `e-Invoice buyer details updated for ${order.orderNumber}` });
      return NextResponse.json(redactOrder(updated, owner));
    }

    // Record an e-Invoice issued in the MyInvois portal by hand (boss only).
    // It used to be open to staff, trusted any UUID, set "valid" without asking LHDN and could
    // overwrite a real reference, which silently took the sale out of consolidated reporting.
    if (action === "save_einvoice") {
      if (!owner) return NextResponse.json({ error: "Only the boss can record an e-Invoice reference" }, { status: 403 });
      const uuid = String(body.uuid || "").trim();
      const longId = String(body.longId || "").trim() || null;
      const env = body.environment === SANDBOX ? SANDBOX : PRODUCTION;
      if (!order.invoiceNumber) {
        return NextResponse.json({ error: "Generate the invoice first" }, { status: 400 });
      }
      if (order.status === "CANCELLED") {
        return NextResponse.json({ error: "This work order is cancelled" }, { status: 400 });
      }
      // LHDN UUIDs / Long IDs are short alphanumeric codes.
      if (!/^[A-Za-z0-9]{10,40}$/.test(uuid) || (longId && !/^[A-Za-z0-9]{10,80}$/.test(longId))) {
        return NextResponse.json({ error: "UUID / Long ID format looks wrong" }, { status: 400 });
      }
      // A submission from this app that LHDN has not answered yet may already be at LHDN: settle it
      // (Check Status) before a hand-typed reference is recorded on top of it. Same rule as the
      // consolidation (inFlightFor): an unanswered SANDBOX test does not hold up a real e-Invoice.
      // 【中文】登记正式电子发票时，沙盒测试没回应不算「正在送」（与合并发票同一规则）。
      const inFlight = (rec: Parameters<typeof inFlightFor>[0]) => (env === PRODUCTION ? inFlightFor(rec, PRODUCTION) : submitGate(rec).action !== "go");
      if (inFlight(order)) {
        return NextResponse.json({ error: INVOICE_IN_FLIGHT, code: "SUBMIT_IN_PROGRESS" }, { status: 409 });
      }
      // A UUID belongs to exactly one LHDN document. Pasting another invoice's (or the monthly
      // consolidated) UUID here would count this sale as reported although LHDN has nothing for it.
      // 【中文】一个 UUID 只属于一份 LHDN 文件：已记录在别的发票、退款单或合并发票上的 UUID 不能再用。
      const holder = await uuidRecordedElsewhere(uuid, { workOrderId: id });
      if (holder) return NextResponse.json({ error: uuidHolderMessage(holder) }, { status: 409 });
      if (env === PRODUCTION && order.consolidatedId) {
        const con = await prisma.consolidatedInvoice.findUnique({ where: { id: order.consolidatedId } });
        if (con && isLiveEInvoice(con)) {
          return NextResponse.json(
            { error: `This invoice was already reported in the monthly consolidated e-Invoice ${con.number}.` },
            { status: 409 }
          );
        }
        if (con && inFlight(con)) {
          return NextResponse.json({ error: CONSOLIDATED_IN_FLIGHT, code: "SUBMIT_IN_PROGRESS" }, { status: 409 });
        }
      }
      // A real e-Invoice of its own takes the invoice out of a monthly consolidated attempt that
      // does not count (sandbox test, rejected or cancelled: a live one was refused above). Its
      // credit notes netted into that attempt are then unreported again, not "netted".
      // 【中文】正式电子发票登记后，解除与无效（沙盒 / 被拒 / 已作废）合并发票的关联，原先并入其中的退款单恢复为未申报。
      const unlinkConsolidated = env === PRODUCTION && !!order.consolidatedId;
      // Replacing a real, still-valid reference needs an explicit confirmation from the boss.
      const replacing = isLiveEInvoice(order) && order.eInvoiceUuid !== uuid;
      if (replacing && body.replace !== true) {
        return NextResponse.json(
          { error: `This invoice already has a real e-Invoice (UUID ${order.eInvoiceUuid}). Replace it?`, code: "LIVE_UUID_EXISTS" },
          { status: 409 }
        );
      }
      const updated = await prisma.$transaction(async (tx) => {
        if (unlinkConsolidated) {
          await tx.creditNote.updateMany({
            where: { workOrderId: id, eInvoiceStatus: "consolidated" },
            data: { eInvoiceStatus: null },
          });
        }
        return tx.workOrder.update({
          where: { id },
          data: {
            eInvoiceUuid: uuid,
            eInvoiceLongId: longId,
            // Not "valid" until LHDN says so: press Check Status to confirm.
            eInvoiceStatus: order.eInvoiceUuid === uuid && order.eInvoiceStatus && !isUnconfirmed(order) ? order.eInvoiceStatus : "pending",
            eInvoiceEnv: env,
            // A hand-typed reference did not come from this app's submission.
            submissionUid: order.eInvoiceUuid === uuid ? order.submissionUid : null,
            // A claim left by an unanswered sandbox test ends here, so Check Status does not later
            // look the real reference up as a lost submission. 【中文】清掉沙盒测试留下的占位。
            eInvoiceSubmittingAt: null,
            ...(unlinkConsolidated ? { consolidatedId: null } : {}),
          },
          include,
        });
      });
      await writeAuditLog({
        actor, request, action: "EINVOICE_REFERENCE_UPDATED", entityType: "WorkOrder", entityId: id,
        summary: `e-Invoice reference ${replacing ? "replaced" : "recorded"} for ${order.orderNumber}`,
        details: {
          environment: env,
          replaced: replacing,
          previous: { uuid: order.eInvoiceUuid, longId: order.eInvoiceLongId, status: order.eInvoiceStatus, environment: order.eInvoiceEnv },
          next: { uuid, longId },
          ...(unlinkConsolidated ? { unlinkedConsolidatedId: order.consolidatedId } : {}),
        },
      });
      return NextResponse.json(redactOrder(updated, owner));
    }

    // Remove an e-Invoice reference the boss typed in by mistake (boss only). Only a hand-typed one
    // (no submission from this app, nothing being sent): until now a wrong UUID could only be
    // replaced, never removed, so a UUID pasted on the wrong invoice blocked the document it belongs
    // to (e.g. the month's consolidated e-Invoice). The previous values stay in the audit log.
    // 【中文】移除老板手动填错的电子发票资料（只限老板）：只限手动登记的（不是本程序提交的、也没有正在送出），以前只能替换不能移除，
    // 贴错的 UUID 会挡住它真正所属的单据（例如当月合并发票）。原来的资料记在审计日志里。
    if (action === "clear_einvoice") {
      if (!owner) return NextResponse.json({ error: "Only the boss can remove an e-Invoice reference" }, { status: 403 });
      if (!order.eInvoiceUuid) return NextResponse.json({ error: "This invoice has no e-Invoice reference." }, { status: 400 });
      if (order.submissionUid) {
        return NextResponse.json(
          { error: "This reference came from a submission by this app, not typed in by hand. Press Check Status to see what LHDN has." },
          { status: 409 }
        );
      }
      if (submitGate(order).action !== "go") {
        return NextResponse.json({ error: INVOICE_IN_FLIGHT, code: "SUBMIT_IN_PROGRESS" }, { status: 409 });
      }
      // Only the state that was read is changed (a submission or save meanwhile wins).
      const n = await prisma.workOrder.updateMany({
        where: {
          id, eInvoiceUuid: order.eInvoiceUuid, eInvoiceStatus: order.eInvoiceStatus, submissionUid: null, eInvoiceSubmittingAt: null,
        },
        data: { eInvoiceUuid: null, eInvoiceLongId: null, eInvoiceStatus: null },
      });
      if (n.count === 0) return NextResponse.json({ error: "This record changed meanwhile. Reload the page." }, { status: 409 });
      await writeAuditLog({
        actor, request, action: "EINVOICE_REFERENCE_REMOVED", entityType: "WorkOrder", entityId: id,
        summary: `e-Invoice reference removed from ${order.invoiceNumber || order.orderNumber} (typed in by mistake)`,
        details: {
          previous: { uuid: order.eInvoiceUuid, longId: order.eInvoiceLongId, status: order.eInvoiceStatus, environment: order.eInvoiceEnv },
        },
      });
      const updated = await prisma.workOrder.findUnique({ where: { id }, include });
      return NextResponse.json(redactOrder(updated!, owner));
    }

    if (action === "update_workshop_plan") {
      if (order.status === "CANCELLED") return NextResponse.json({ error: "Cancelled work orders cannot be rescheduled" }, { status: 400 });
      const priority = String(body.priority || "NORMAL");
      if (!["LOW", "NORMAL", "HIGH", "URGENT"].includes(priority)) {
        return NextResponse.json({ error: "Invalid priority" }, { status: 400 });
      }
      const rawDue = body.estimatedCompletionAt;
      const estimatedCompletionAt = rawDue ? new Date(String(rawDue)) : null;
      if (rawDue && Number.isNaN(estimatedCompletionAt!.getTime())) {
        return NextResponse.json({ error: "Invalid estimated completion date" }, { status: 400 });
      }
      const assignedToId = body.assignedToId ? String(body.assignedToId) : null;
      if (assignedToId) {
        const technician = await prisma.user.findFirst({ where: { id: assignedToId, role: "TECHNICIAN", disabledAt: null }, select: { id: true } });
        if (!technician) return NextResponse.json({ error: "Selected technician is unavailable" }, { status: 400 });
      }
      const before = await prisma.workOrder.findUnique({ where: { id }, select: { priority: true, estimatedCompletionAt: true, assignedToId: true } });
      if (!before) return NextResponse.json({ error: "Work order not found" }, { status: 404 });
      const updated = await prisma.workOrder.update({
        where: { id },
        data: { priority, estimatedCompletionAt, assignedToId },
        include,
      });
      await writeAuditLog({
        actor, request, action: "WORKSHOP_PLAN_UPDATED", entityType: "WorkOrder", entityId: id,
        summary: `Workshop plan updated for ${order.orderNumber}`,
        details: {
          before: { priority: before.priority, estimatedCompletionAt: before.estimatedCompletionAt?.toISOString() || null, assignedToId: before.assignedToId },
          after: { priority, estimatedCompletionAt: estimatedCompletionAt?.toISOString() || null, assignedToId },
        },
      });
      return NextResponse.json(redactOrder(updated, owner));
    }

    if (action === "update_status") {
      const next = body.status as string;
      if (!VALID_STATUSES.includes(next)) {
        return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      }
      let from = order.status as string;
      // Archived stock items that get parts back when this job is cancelled are restored (stock on a
      // hidden item would be lost from view). 【中文】取消时零件放回已归档的项目，该项目会自动恢复显示。
      let restoredItems: Array<{ id: string; name: string; sku: string | null; quantity: number }> = [];

      // Every check runs on the order as re-read INSIDE the transaction, so a payment, credit
      // note, invoice or e-Invoice recorded at the same moment cannot slip past a cancel.
      // 【中文】所有检查都在事务里重新读取工单后再做，避免同时付款 / 开票 / 开退款单时被取消绕过。
      const updated = await prisma.$transaction(async (tx) => {
        restoredItems = [];
        const cur = await tx.workOrder.findUnique({ where: { id } });
        if (!cur) throw new StatusError("Work order not found", 404);
        from = cur.status;
        if (cur.status === "CANCELLED") throw new UserError("This work order is cancelled and cannot be changed");
        // An issued invoice is a tax record: it may not be quietly moved back to draft/quote.
        if (cur.invoiceNumber && next !== "CANCELLED" && next !== "COMPLETED") {
          throw new UserError("An invoice has been issued - the job can only stay Completed or be Cancelled");
        }

        if (next === "CANCELLED") {
          if (cur.paidAmount > 0) {
            throw new UserError("Payment has been received. Refund it first (and issue a credit note) before cancelling.");
          }
          if (cur.creditedAmount > 0) {
            throw new UserError("Credit notes exist for this invoice. Use a credit note for the remaining amount instead of cancelling.");
          }
          if (cur.consolidatedId) {
            // Only a real (production) consolidated e-Invoice blocks cancelling; a sandbox test does not.
            const con = await tx.consolidatedInvoice.findUnique({ where: { id: cur.consolidatedId } });
            if (!con || isLiveEInvoice(con)) {
              throw new UserError("This invoice was reported in a monthly consolidated e-Invoice. Issue a credit note instead of cancelling.");
            }
            if (submitGate(con).action !== "go") throw new UserError(CONSOLIDATED_IN_FLIGHT);
          }
          if (submitGate(cur).action !== "go") throw new UserError(INVOICE_IN_FLIGHT);
          if (cur.invoiceNumber && !owner) throw new StatusError("Only the boss can cancel an invoiced job", 403);
          if (isLiveEInvoice(cur)) {
            throw new UserError(
              "This invoice was sent to LHDN MyInvois. Cancel it in the MyInvois portal first " +
                "(allowed within 72 hours of validation; after that a credit note is required)."
            );
          }

          // Put parts taken for this job back into stock (previously they were lost).
          const moves = await tx.stockMovement.findMany({ where: { workOrderId: id } });
          const net = new Map<string, number>();
          for (const m of moves) net.set(m.inventoryItemId, (net.get(m.inventoryItemId) || 0) + m.quantity);
          for (const [itemId, q] of net) {
            if (q >= 0) continue; // nothing outstanding
            const back = await tx.inventoryItem.update({
              where: { id: itemId },
              data: { quantityOnHand: { increment: -q } },
              select: { id: true, name: true, sku: true, archivedAt: true },
            });
            if (back.archivedAt) {
              await tx.inventoryItem.update({ where: { id: itemId }, data: { archivedAt: null } });
              restoredItems.push({ id: back.id, name: back.name, sku: back.sku, quantity: -q });
            }
            await tx.stockMovement.create({
              data: {
                inventoryItemId: itemId,
                type: "IN",
                quantity: -q,
                notes: `Returned - ${cur.orderNumber} cancelled`,
                workOrderId: id,
              },
            });
          }
        }

        const now = new Date();
        const data: Record<string, unknown> = { status: next };
        if (next === "CONFIRMED") data.confirmedAt = new Date();
        if (next === "IN_PROGRESS") data.startedAt = cur.startedAt || now;
        if (next === "COMPLETED") data.completedAt = cur.completedAt || now;
        const saved = await tx.workOrder.update({ where: { id }, data, include });
        if (from !== next) {
          await tx.workOrderHistory.create({
            data: {
              workOrderId: id,
              fromStatus: from,
              toStatus: next,
              note: typeof body.note === "string" ? body.note.trim().slice(0, 500) || null : null,
              actorUserId: actor.id,
              actorName: actor.name,
            },
          });
        }
        return saved;
      });
      await writeAuditLog({ actor, request, action: next === "CANCELLED" ? "WORK_ORDER_CANCELLED" : "WORK_ORDER_STATUS_CHANGED", entityType: "WorkOrder", entityId: id, summary: `${order.orderNumber}: ${from} → ${next}`, details: { from, to: next } });
      for (const it of restoredItems) {
        await writeAuditLog({
          actor, request, action: "INVENTORY_RESTORED", entityType: "InventoryItem", entityId: it.id,
          summary: `Inventory item restored: ${it.name} (parts returned when ${order.orderNumber} was cancelled)`,
          details: { sku: it.sku, reason: "stock returned by a cancelled job", workOrderId: id, quantityReturned: it.quantity, before: { archived: true }, after: { archived: false } },
        });
      }
      return NextResponse.json(redactOrder(updated, owner));
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof StatusError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof StockShortError) {
      return NextResponse.json(
        {
          code: "STOCK_SHORT",
          error: "Not enough stock for some parts on this job",
          items: e.items.map((p) => ({ inventoryItemId: p.inventoryItemId, name: p.name, sku: p.sku, needed: p.outstanding, onHand: p.onHand, short: p.short })),
        },
        { status: 409 }
      );
    }
    console.error(e);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}
