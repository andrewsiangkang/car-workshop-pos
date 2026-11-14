// Before a customer is anonymised (pure, no database): freeze the buyer on the documents that must
// still be kept but were issued before v0.3.29, when documents did not store their particulars yet.
// Those documents print (and e-Invoice) the buyer from the live customer record, so without this
// they would show "Anonymised customer" once the record is cleared.
// 【中文】匿名化之前的纯规则：v0.3.29 之前开出、还在保存期内的单据没有冻结买方资料（打印和电子发票都读现在的客户资料），
// 先把买方按今天打印出来的样子冻结在单据上，匿名化之后补印仍然显示原来的买方。
import { buildCreditNoteSnapshot, buildInvoiceSnapshot } from "./doc-snapshot.mjs";
import { orderDocumentTimes, recordKeepingStart } from "./privacy-customer.mjs";

/** @param {unknown} v */
const blank = (v) => v === null || v === undefined || (typeof v === "string" && !v.trim());

/** @param {unknown} v */
function time(v) {
  if (v === null || v === undefined || v === "") return NaN;
  const t = v instanceof Date ? v.getTime() : new Date(/** @type {string | number} */ (v)).getTime();
  return Number.isFinite(t) ? t : NaN;
}

/**
 * Only the buyer is frozen: the seller (Settings) and the car are not touched by anonymising, so
 * they keep printing exactly as they do today for every older document.
 * @param {{ v: number, kind: string, takenAt: string, buyer: object }} snap
 */
function buyerOnly(snap) {
  return JSON.stringify({ v: snap.v, kind: snap.kind, takenAt: snap.takenAt, buyer: snap.buyer, frozenFor: "anonymisation" });
}

/**
 * The snapshots to write before anonymising one customer: each invoice / receipt and each credit
 * note that is still inside the record-keeping period (recordKeepingStart) and has no snapshot yet
 * gets the buyer it prints today. Documents that already have a snapshot are left alone, and
 * documents past the keeping period are not frozen: their personal data is removed instead
 * (buyerDataToClear).
 * 【中文】匿名化前要写入的快照：还在保存期内、还没有快照的发票 / 收据 / 退款单，冻结今天打印出来的买方。
 * 已有快照的不动；过了保存期的不冻结，个人资料改为删除（见 buyerDataToClear）。
 * @param {{ customer: Record<string, unknown>, orders: Array<Record<string, any>>, now: Date | number }} p
 *   orders: the customer's work orders (all scalar fields), each with creditNotes [{ id, createdAt, docSnapshot }]
 * @returns {{ orders: Array<{ id: string, docSnapshot: string }>, creditNotes: Array<{ id: string, docSnapshot: string }> }}
 */
export function snapshotsToFreeze({ customer, orders, now }) {
  const since = recordKeepingStart(now);
  const at = new Date(now);
  /** @type {Array<{ id: string, docSnapshot: string }>} */
  const orderOut = [];
  /** @type {Array<{ id: string, docSnapshot: string }>} */
  const cnOut = [];
  for (const o of orders || []) {
    let order = o;
    const issued = !!(o.invoiceNumber || o.receiptNumber);
    if (issued && blank(o.docSnapshot) && orderDocumentTimes(o).some((t) => t >= since)) {
      const docSnapshot = buyerOnly(buildInvoiceSnapshot({ order: o, customer, at }));
      orderOut.push({ id: String(o.id), docSnapshot });
      // A credit note of this invoice names the invoice's buyer (creditNoteBuyer).
      order = { ...o, docSnapshot };
    }
    for (const cn of o.creditNotes || []) {
      if (!blank(cn.docSnapshot) || !(time(cn.createdAt) >= since)) continue;
      cnOut.push({ id: String(cn.id), docSnapshot: buyerOnly(buildCreditNoteSnapshot({ order, customer, at })) });
    }
  }
  return { orders: orderOut, creditNotes: cnOut };
}

/**
 * The snapshot without its buyer (seller and car stay frozen), or null when it holds no buyer.
 * @param {unknown} raw
 */
function withoutBuyer(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let o;
  try {
    o = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!o || typeof o !== "object" || Array.isArray(o) || o.buyer === undefined || o.buyer === null) return null;
  delete o.buyer;
  return JSON.stringify(o);
}

/**
 * When a customer is anonymised: the issued documents already past the record-keeping period
 * (the invoice, receipt and every credit note of the job older than recordKeepingStart) no longer
 * keep personal data. Their jobs' buyer requests (QR / staff: name, IC / passport, TIN, e-mail,
 * phone, address, consent) are cleared (`orderIds`), and the buyer is taken out of the job's and
 * its credit notes' snapshots, so they then name the anonymised customer. Documents still inside
 * the keeping period are not touched (snapshotsToFreeze keeps their buyer).
 * 【中文】匿名化时：已过保存期的单据（发票、收据和所有退款单都早于保存期开始）不再保留个人资料：清除工单上的买方资料，
 * 并从工单和退款单的快照里删掉买方（卖方和车辆照旧），之后显示为已匿名的客户。还在保存期内的单据不动。
 * @param {{ orders: Array<Record<string, any>>, now: Date | number }} p
 *   orders: the customer's issued work orders (all scalar fields), each with creditNotes [{ id, createdAt, docSnapshot }]
 * @returns {{ orderIds: string[], orders: Array<{ id: string, docSnapshot: string }>, creditNotes: Array<{ id: string, docSnapshot: string }> }}
 */
export function buyerDataToClear({ orders, now }) {
  const since = recordKeepingStart(now);
  /** @type {string[]} */
  const orderIds = [];
  /** @type {Array<{ id: string, docSnapshot: string }>} */
  const orderOut = [];
  /** @type {Array<{ id: string, docSnapshot: string }>} */
  const cnOut = [];
  for (const o of orders || []) {
    if (!(o.invoiceNumber || o.receiptNumber)) continue;
    const times = orderDocumentTimes(o);
    // A document without a usable date is kept as it is (the careful choice).
    if (!times.length || !times.every((t) => t < since)) continue;
    const notes = o.creditNotes || [];
    if (!notes.every((cn) => time(cn.createdAt) < since)) continue;
    orderIds.push(String(o.id));
    const snap = withoutBuyer(o.docSnapshot);
    if (snap !== null) orderOut.push({ id: String(o.id), docSnapshot: snap });
    for (const cn of notes) {
      const s = withoutBuyer(cn.docSnapshot);
      if (s !== null) cnOut.push({ id: String(cn.id), docSnapshot: s });
    }
  }
  return { orderIds, orders: orderOut, creditNotes: cnOut };
}

/**
 * Audit summary of one sweep of expired buyer data (sweepExpiredBuyerData), counts only, no
 * personal data. A customer that could not be cleared (it is tried again at the next start) is
 * recorded too, also when nothing else was cleared in the same run, so a customer that fails on
 * every run still shows in the audit log. Null when there is nothing to record.
 * 【中文】过期买方资料清除的审计摘要（只有数量，没有个人资料）。清除失败的客户（下次启动再试）也要记录，
 * 即使同一次没有清除任何单据，所以每次都失败的客户也会出现在审计日志里。什么都没有时返回 null。
 * @param {{ customers: number, documents: number, failed: number }} r
 * @returns {string | null}
 */
export function expiredBuyerDataSummary(r) {
  const documents = Number(r.documents) || 0;
  const failed = Number(r.failed) || 0;
  if (!documents && !failed) return null;
  const failedText = `${failed} anonymised customer(s) past the record-keeping period could not be cleared (tried again at next start)`;
  if (!documents) return failedText;
  const base = `Buyer details removed from ${documents} document(s) of ${Number(r.customers) || 0} anonymised customer(s): past the record-keeping period`;
  return failed ? `${base}; ${failedText}` : base;
}
