// Particulars frozen on an issued tax document (invoice, credit note): seller, buyer and vehicle.
// An issued invoice must reprint exactly as it was issued, even after Settings, the customer
// record or the car is edited (review H6). Old records without a snapshot, and quotations
// (not tax documents), keep printing from live data.
// Pure functions (only the pure e-Invoice state / ID / submission modules are imported): used by API routes,
// pages and tests alike.
// 【中文】开发票 / 退款单时把卖方、买方、车辆资料"拍照"存下来（JSON）。以后改店铺资料、客户名字、车辆资料，补印出来的单据仍和当初开出的一样。旧单据没有快照就照旧读现在的资料；报价单不是税务单据，一律读现在的资料。

import { PRODUCTION, SANDBOX, isLiveEInvoice, isLiveIn, isLiveStatus, isNettedInConsolidation, recordEnv } from "./einvoice-state.mjs";
import { GENERAL_PUBLIC_TIN } from "./einvoice2-ids.mjs";
import { inFlightFor, submitGate } from "./einvoice2-submit.mjs";

export const DOC_SNAPSHOT_VERSION = 1;

/** @param {unknown} v trimmed text, or null when blank */
function text(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

/** @param {unknown} v whole number, or null */
function whole(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** @param {unknown} v */
function isObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * Seller particulars printed on documents, taken from Settings → Shop. Only named fields are
 * copied, so the MyInvois client secret or other settings never end up in a snapshot.
 * @param {Record<string, unknown> | null | undefined} shop
 */
// 【中文】卖方资料（店名、地址、电话、邮箱、TIN、BRN、SST 号、MSIC、银行资料）。只复制这些字段，MyInvois 密钥等不会进快照。
export function sellerSnapshot(shop) {
  const s = shop || {};
  return {
    name: text(s.name) || "My Workshop",
    address: text(s.address),
    postcode: text(s.postcode),
    city: text(s.city),
    stateCode: text(s.stateCode),
    phone: text(s.phone),
    email: text(s.email),
    tin: text(s.tin),
    brn: text(s.brn),
    sstNumber: text(s.sstNumber),
    msicCode: text(s.msicCode),
    msicDesc: text(s.msicDesc),
    bankName: text(s.bankName),
    bankAccount: text(s.bankAccount),
    paymentQrUrl: text(s.paymentQrUrl),
  };
}

/**
 * A buyer as printed: name, phone, TIN and address. NRIC / passport numbers and e-mail are
 * deliberately not copied into snapshots (PDPA: keep personal data in one place only); the
 * e-Invoice takes them from the buyer request kept on the order.
 * @param {Record<string, unknown> | null | undefined} b
 * @param {"buyer_request" | "snapshot" | "customer" | "general_public"} source
 */
function printedBuyer(b, source) {
  const x = b || {};
  return {
    name: text(x.name) || "General Public",
    phone: text(x.phone),
    tin: text(x.tin),
    address: text(x.address),
    postcode: text(x.postcode),
    city: text(x.city),
    stateCode: text(x.stateCode),
    source,
  };
}

/**
 * The buyer from the live customer record (old invoices, quotations).
 * @param {Record<string, unknown> | null | undefined} customer
 */
export function customerBuyer(customer) {
  return { ...printedBuyer(customer, "customer"), idType: null, idNo: null, email: null };
}

/** LHDN's "General Public" buyer: no name of their own, no TIN, phone or address. */
function generalPublicBuyer() {
  return { ...printedBuyer(null, "general_public"), idType: null, idNo: null, email: null };
}

/**
 * Details the buyer sent by QR (or staff typed on the invoice page) before e-Invoicing. They are
 * kept on the work order and win over everything else, so the printed invoice names the same
 * buyer as the e-Invoice sent to LHDN. Counted with a name and a TIN, or (a Malaysian individual
 * who gave no TIN) a name and an IC number: then the TIN is LHDN's general TIN EI00000000010,
 * printed and sent alike (LHDN e-Invoice Specific Guideline; confirm with your tax agent).
 * @param {Record<string, unknown> | null | undefined} order
 * @param {{ phone?: string | null } | null} fallback phone to use when the request has none
 */
// 【中文】顾客扫码 / 店员填的买方：要有名字和 TIN；没有 TIN 的马来西亚个人有名字和身份证号也算，TIN 用 LHDN 个人通用 TIN（打印和送 LHDN 一样）。
function requestedBuyer(order, fallback) {
  const o = order || {};
  if (!o.buyerRequestedAt || !text(o.buyerName)) return null;
  const tin = text(o.buyerTin);
  const icOnly = !tin && String(text(o.buyerIdType) || "").toUpperCase() === "NRIC" && !!text(o.buyerIdNo);
  if (!tin && !icOnly) return null;
  return {
    name: text(o.buyerName),
    phone: text(o.buyerPhone) || (fallback ? text(fallback.phone) : null),
    tin: tin || GENERAL_PUBLIC_TIN,
    address: text(o.buyerAddress),
    postcode: text(o.buyerPostcode),
    city: text(o.buyerCity),
    stateCode: text(o.buyerStateCode),
    source: /** @type {const} */ ("buyer_request"),
    idType: text(o.buyerIdType),
    idNo: text(o.buyerIdNo),
    email: text(o.buyerEmail),
  };
}

/**
 * The buyer named on a document, printed AND sent to LHDN (one rule for both):
 * 1. the buyer request on the order (QR form / staff), while it has a name and a TIN (or, for a
 *    Malaysian individual, an IC number);
 * 2. else the first snapshot that froze a buyer when the document was issued;
 * 3. else the live customer record (records issued before snapshots existed).
 * @param {{ order?: Record<string, unknown> | null, snapshots?: Array<{ buyer?: Record<string, unknown> | null } | null | undefined>, customer?: Record<string, unknown> | null }} p
 */
// 【中文】单据上的买方（打印和发给 LHDN 用同一个规则）：①顾客扫码 / 店员填的买家资料（有名字和 TIN）；②开单时冻结的快照；③旧单据才用现在的客户资料。
export function documentBuyer(p) {
  const frozen = (p.snapshots || []).map((s) => (s && isObject(s.buyer) ? s.buyer : null)).find(Boolean);
  const base = frozen
    ? { ...printedBuyer(frozen, "snapshot"), idType: null, idNo: null, email: null }
    : customerBuyer(p.customer);
  return requestedBuyer(p.order, base) || base;
}

/**
 * Vehicle particulars: plate, make, model, year and the mileage of this job.
 * @param {Record<string, unknown> | null | undefined} vehicle
 * @param {unknown} [mileageIn] mileage recorded on the job (wins over the car's last mileage)
 */
export function vehicleSnapshot(vehicle, mileageIn) {
  const v = vehicle || {};
  const jobMileage = whole(mileageIn);
  return {
    plateNumber: text(v.plateNumber) || "",
    make: text(v.make) || "",
    model: text(v.model) || "",
    year: whole(v.year),
    mileage: jobMileage ?? whole(v.mileage),
  };
}

/** @param {unknown} at */
function iso(at) {
  const d = at instanceof Date ? at : new Date(at === undefined ? Date.now() : /** @type {any} */ (at));
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/**
 * Snapshot stored on the work order when the invoice is issued.
 * @param {{ shop?: Record<string, unknown> | null, order?: Record<string, unknown> | null, customer?: Record<string, unknown> | null, vehicle?: Record<string, unknown> | null, at?: Date | string }} p
 */
// 【中文】开发票时存到工单上的快照。
export function buildInvoiceSnapshot(p) {
  const buyer = documentBuyer({ order: p.order, customer: p.customer });
  return {
    v: DOC_SNAPSHOT_VERSION,
    kind: "invoice",
    takenAt: iso(p.at),
    seller: sellerSnapshot(p.shop),
    buyer: printedBuyer(buyer, buyer.source === "buyer_request" ? "buyer_request" : "customer"),
    vehicle: vehicleSnapshot(p.vehicle, p.order ? p.order.mileageIn : null),
  };
}

/**
 * Seller printed on a credit note: Settings as on the credit note's date, except the SST
 * registration number when the credit note reverses SST. That tax was charged under the number
 * frozen on the invoice, so it is kept even after the shop changed or cleared its SST number
 * (review Low). Invoices issued before snapshots existed fall back to today's number.
 * @param {{ shop?: Record<string, unknown> | null, invoice?: { seller?: { sstNumber?: string | null } | null } | null, taxAmount?: unknown }} p
 */
// 【中文】退款单上的卖方：用开退款单当天的店铺资料；但退款单有退 SST 时，SST 登记号用原发票开出时的号码（那笔税是用这个号码收的）。旧发票没有快照才用现在的号码。
export function creditNoteSeller(p) {
  const seller = sellerSnapshot(p.shop);
  const frozen = p.invoice && isObject(p.invoice.seller) ? p.invoice.seller : null;
  if (frozen && Number(p.taxAmount) > 0) return { ...seller, sstNumber: text(frozen.sstNumber) };
  return seller;
}

/**
 * Snapshot stored on a credit note when it is issued: the seller as on the credit note's date
 * (with the invoice's SST number when SST is credited, see creditNoteSeller), and the buyer and
 * vehicle of the invoice it credits (the invoice's own snapshot when it has one, so the credit
 * note names the same buyer as the invoice and its e-Invoice).
 * @param {{ shop?: Record<string, unknown> | null, order?: Record<string, unknown> | null, customer?: Record<string, unknown> | null, vehicle?: Record<string, unknown> | null, taxAmount?: unknown, at?: Date | string }} p
 */
// 【中文】开退款单时存的快照：卖方用开退款单当天的店铺资料（有退 SST 时 SST 号用原发票的）；买方、车辆跟原发票一致（原发票有快照就用快照）。
export function buildCreditNoteSnapshot(p) {
  const invoice = parseDocSnapshot(p.order ? p.order.docSnapshot : null);
  const buyer = documentBuyer({ order: p.order, snapshots: [invoice], customer: p.customer });
  return {
    v: DOC_SNAPSHOT_VERSION,
    kind: "credit_note",
    takenAt: iso(p.at),
    seller: creditNoteSeller({ shop: p.shop, invoice, taxAmount: p.taxAmount }),
    buyer: printedBuyer(buyer, buyer.source === "buyer_request" ? "buyer_request" : "customer"),
    vehicle: invoice && invoice.vehicle ? invoice.vehicle : vehicleSnapshot(p.vehicle, p.order ? p.order.mileageIn : null),
  };
}

/**
 * Read a stored snapshot. Anything missing or unreadable gives null (or a null part), so the
 * document falls back to live data instead of failing to print.
 * @param {unknown} raw JSON text from the docSnapshot column
 */
export function parseDocSnapshot(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let o;
  try {
    o = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(o)) return null;
  const source = (/** @type {unknown} */ s) => (s === "buyer_request" ? "buyer_request" : "customer");
  return {
    v: Number(o.v) || DOC_SNAPSHOT_VERSION,
    kind: o.kind === "credit_note" ? "credit_note" : "invoice",
    takenAt: text(o.takenAt),
    seller: isObject(o.seller) ? sellerSnapshot(o.seller) : null,
    buyer: isObject(o.buyer) ? printedBuyer(o.buyer, source(o.buyer.source)) : null,
    vehicle: isObject(o.vehicle) ? vehicleSnapshot(o.vehicle, o.vehicle.mileage) : null,
  };
}

/**
 * Buyer of an invoice / receipt (printed and on its e-Invoice).
 * @param {{ order?: Record<string, unknown> | null, customer?: Record<string, unknown> | null }} p
 */
export function invoiceBuyer(p) {
  return documentBuyer({ order: p.order, snapshots: [parseDocSnapshot(p.order ? p.order.docSnapshot : null)], customer: p.customer });
}

/**
 * Buyer of a credit note (printed and on its e-Invoice): the invoice's buyer, so the credit note
 * and the e-Invoice it refers to always name the same buyer (review Medium: the printed credit
 * note showed the walk-in while LHDN got the QR buyer). The credit note's own snapshot is the
 * fallback for invoices issued before snapshots existed.
 * When the credit note refers to the monthly consolidated e-Invoice (`via: "consolidated"`, see
 * creditNoteReference), LHDN reported the sale as General Public, so the credit note names
 * General Public too: never a QR buyer (or their TIN) whose own e-Invoice was never issued.
 * @param {{ creditNote?: Record<string, unknown> | null, order?: Record<string, unknown> | null, customer?: Record<string, unknown> | null, via?: "invoice" | "consolidated" | null }} p
 */
// 【中文】退款单的买方：和原发票（及其电子发票）同一个买方；原发票没有快照时，用退款单开出时冻结的买方。退款单是对合并电子发票开的话，LHDN 那边是 General Public，打印和提交也都是 General Public（不印扫码买家的名字和 TIN）。
export function creditNoteBuyer(p) {
  if (p.via === "consolidated") return generalPublicBuyer();
  return documentBuyer({
    order: p.order,
    snapshots: [
      parseDocSnapshot(p.order ? p.order.docSnapshot : null),
      parseDocSnapshot(p.creditNote ? p.creditNote.docSnapshot : null),
    ],
    customer: p.customer,
  });
}

/**
 * The LHDN e-Invoice a credit note refers to, in LHDN system `env` (sandbox or production): the
 * invoice's own e-Invoice, else the monthly consolidated e-Invoice the invoice is linked to, else
 * null (not reported yet: submit the invoice first, or the credit note is netted off in the
 * consolidated e-Invoice). A credit note already netted into a consolidated e-Invoice has no
 * reference of its own. The submit route and the printed credit note both use this, so the print
 * names the same buyer LHDN gets.
 * @param {{ creditNote?: { eInvoiceStatus?: string | null } | null, order?: { invoiceNumber?: string | null, eInvoiceUuid?: string | null, eInvoiceStatus?: string | null, eInvoiceEnv?: string | null, consolidatedId?: string | null } | null, consolidated?: { number?: string | null, eInvoiceUuid?: string | null, eInvoiceStatus?: string | null, eInvoiceEnv?: string | null } | null, env: "sandbox" | "production" }} p
 * @returns {{ via: "invoice" | "consolidated", number: string, uuid: string } | null}
 */
// 【中文】退款单对应哪一张 LHDN 电子发票：原发票自己的电子发票 → 原发票所并入的合并电子发票 → 都没有就是还没申报。已在合并发票里扣除的退款单没有自己的对应。提交和打印用同一个规则。
export function creditNoteReference(p) {
  if (isNettedInConsolidation(p.creditNote)) return null;
  const o = p.order;
  if (o && o.invoiceNumber && o.eInvoiceUuid && isLiveIn(o, p.env)) {
    return { via: "invoice", number: String(o.invoiceNumber), uuid: String(o.eInvoiceUuid) };
  }
  const c = p.consolidated;
  if (o && o.consolidatedId && c && c.eInvoiceUuid && isLiveIn(c, p.env)) {
    return { via: "consolidated", number: String(c.number || ""), uuid: String(c.eInvoiceUuid) };
  }
  return null;
}

/**
 * Reference used for the printed credit note. Once it was sent, the LHDN system it went to.
 * Not sent yet: a real (production) e-Invoice comes first, so the print matches what LHDN really
 * has, and a sandbox test counts only while Settings are on Sandbox (as the submit route would do).
 * @param {{ creditNote?: { eInvoiceUuid?: string | null, eInvoiceStatus?: string | null, eInvoiceEnv?: string | null } | null, order?: object | null, consolidated?: object | null, settingsEnv: "sandbox" | "production" }} p
 */
// 【中文】打印退款单时用的对应关系：已提交的就按它提交到的环境；还没提交的，先看正式环境，设置在沙盒时才看沙盒测试。
export function printedCreditNoteReference(p) {
  const cn = p.creditNote;
  const ref = (/** @type {"sandbox" | "production"} */ env) =>
    creditNoteReference({ creditNote: cn, order: /** @type {any} */ (p.order), consolidated: /** @type {any} */ (p.consolidated), env });
  if (cn && cn.eInvoiceUuid && isLiveStatus(cn.eInvoiceStatus)) return ref(recordEnv(cn));
  return ref(PRODUCTION) || (p.settingsEnv === SANDBOX ? ref(SANDBOX) : null);
}

/**
 * Why staff can no longer change the buyer of an invoice, or null while they can. Once LHDN has
 * the sale, as the invoice's own real e-Invoice or inside a real monthly consolidated e-Invoice
 * (as General Public), the invoice, receipt and credit notes must keep naming the buyer LHDN has
 * (H6): a buyer saved later would change every reprint although LHDN never got it. Sandbox tests,
 * and a consolidated e-Invoice LHDN rejected or that was cancelled, do not lock. A link to a
 * consolidated record that cannot be found is taken as reported (the careful choice, as the
 * submit and cancel routes do). While the invoice's own submission is being sent, got no answer
 * from LHDN, or left a claim behind (a crash during the send), LHDN may already hold a document
 * with the current buyer: locked as "submitted" too, until Check Status settles it (only the page
 * used to hide the form; a second device could still save). With the Settings environment `env`
 * known, an unanswered SANDBOX test does not lock a real (production) buyer (inFlightFor).
 * @param {{ eInvoiceUuid?: string | null, eInvoiceStatus?: string | null, eInvoiceEnv?: string | null, eInvoiceSubmittingAt?: Date | string | null, consolidatedId?: string | null } | null | undefined} order
 * @param {{ eInvoiceUuid?: string | null, eInvoiceStatus?: string | null, eInvoiceEnv?: string | null } | null | undefined} consolidated the record `order.consolidatedId` points to
 * @param {"sandbox" | "production"} [env] LHDN system Settings are on (omitted: any claim locks)
 * @returns {"submitted" | "consolidated" | null}
 */
// 【中文】店员还能不能改发票的买方：发票已有正式电子发票，或已并入正式有效的合并电子发票（General Public），就不能再改，否则补印的单据会和 LHDN 不一样。沙盒测试、被拒绝 / 作废的合并发票不算。
// 正在送 LHDN、上次提交没回应、或程序崩溃留下占位时也锁住（LHDN 可能已收到现在这个买方），直到「检查状态」确认。
export function buyerEditLock(order, consolidated, env) {
  if (isLiveEInvoice(order)) return "submitted";
  if (order && (env ? inFlightFor(order, env) : submitGate(order).action !== "go")) return "submitted";
  if (order && order.consolidatedId && (!consolidated || isLiveEInvoice(consolidated))) return "consolidated";
  return null;
}

/**
 * Address as printed: street, then "postcode city", then the state name, one per line.
 * State "17" (Not Applicable) is left out.
 * @param {{ address?: string | null, postcode?: string | null, city?: string | null, stateCode?: string | null } | null | undefined} a
 * @param {(code: string) => string | undefined} stateName
 */
export function addressText(a, stateName) {
  if (!a) return null;
  const state = a.stateCode && a.stateCode !== "17" ? stateName(a.stateCode) || null : null;
  return [a.address, [a.postcode, a.city].filter(Boolean).join(" "), state].filter(Boolean).join("\n") || null;
}
