// e-Invoice rules for the monthly consolidated e-Invoice and the customer's own QR request:
// the LHDN deadline, when the QR request closes, who should get an individual e-Invoice,
// LHDN field lengths, and checks for a consolidated e-Invoice recorded from the MyInvois portal.
// Pure functions (only the pure phone / money / e-Invoice state / ID / submission modules are imported): used by
// API routes, pages, the public form and tests alike.
// 【中文】电子发票共用规则：合并发票截止日（次月 7 号）、顾客扫码申请何时关闭、哪些发票应单独开电子发票、
// LHDN 栏位长度上限、以及登记 MyInvois 网站提交的合并发票时的检查。纯函数，测试可直接调用。

import { isValidMyInvoisPhone, normalizeMyInvoisPhone } from "./myinvois-phone.mjs";
import { toCents } from "./money-core.mjs";
import { isLiveEInvoice, isLiveStatus, isReportedFor } from "./einvoice-state.mjs";
import { GENERAL_PUBLIC_TIN, ID_TYPES, checkBuyerId } from "./einvoice2-ids.mjs";
import { inFlightFor } from "./einvoice2-submit.mjs";

const MY_OFFSET_MS = 8 * 60 * 60 * 1000; // Malaysia time is UTC+8 all year

/**
 * "YYYY-MM" of an instant in Malaysia time.
 * @param {Date | string | number} date
 */
export function malaysiaMonth(date) {
  return new Date(new Date(date).getTime() + MY_OFFSET_MS).toISOString().slice(0, 7);
}

/**
 * Start / end (exclusive) of a Malaysian calendar month, and the LHDN deadline for its
 * consolidated e-Invoice: the 7th of the next month, 23:59:59 Malaysia time.
 * @param {string} month "YYYY-MM"
 */
// 【中文】马来西亚时间某月的起止时间，以及合并电子发票的截止时间（次月 7 号 23:59:59）。
export function monthBounds(month) {
  const [y, m] = month.split("-").map(Number);
  return {
    start: new Date(Date.UTC(y, m - 1, 1) - MY_OFFSET_MS),
    end: new Date(Date.UTC(y, m, 1) - MY_OFFSET_MS),
    deadline: new Date(Date.UTC(y, m, 7, 23, 59, 59) - MY_OFFSET_MS),
  };
}

/**
 * Last moment a customer may ask for (or correct) their own e-Invoice by QR: the consolidation
 * deadline of the month the invoice was issued in. After that the sale is reported in the
 * consolidated e-Invoice, so a request would only be ignored.
 * @param {Date | string | null | undefined} invoicedAt
 * @returns {Date | null}
 */
export function buyerRequestDeadline(invoicedAt) {
  if (!invoicedAt) return null;
  return monthBounds(malaysiaMonth(invoicedAt)).deadline;
}

/**
 * Why the QR e-Invoice request of an invoice is closed, or "none" while it is open.
 * The most useful reason for the customer comes first.
 * @param {{ hasInvoice: boolean, live: boolean, consolidated: boolean, staffSaved?: boolean, invoicedAt?: Date | string | null }} o
 * @param {Date} [now]
 * @returns {"none" | "no_invoice" | "submitted" | "consolidated" | "staff_saved" | "expired"}
 */
// 【中文】扫码申请是否已关闭：没有发票 / 已开电子发票 / 已并入合并发票 / 店员已填好资料 / 已过截止日。
export function buyerRequestLock(o, now = new Date()) {
  if (!o.hasInvoice) return "no_invoice";
  if (o.live) return "submitted";
  if (o.consolidated) return "consolidated";
  // Staff already entered the buyer (e.g. looked up the TIN): the link must not overwrite it.
  if (o.staffSaved) return "staff_saved";
  const deadline = buyerRequestDeadline(o.invoicedAt);
  if (deadline && now.getTime() > deadline.getTime()) return "expired";
  return "none";
}

/**
 * The invoice was really reported in a monthly consolidated e-Invoice: the one it is linked to,
 * or the one recorded for its month, is a real (production) e-Invoice LHDN still counts.
 * A sandbox test, or one LHDN rejected / that was cancelled, does not count: being linked to it
 * (consolidatedId) is not enough to close the customer's QR request.
 * @param {...({ eInvoiceUuid?: string | null, eInvoiceStatus?: string | null, eInvoiceEnv?: string | null } | null | undefined)} cons
 */
// 【中文】发票是否真的已并入合并电子发票：所链接的或该月的合并发票必须是正式环境、仍有效的。沙盒测试或被拒绝 / 作废的不算。
export function reportedInConsolidation(...cons) {
  return cons.some((c) => isLiveEInvoice(c));
}

/** LHDN's shared TINs (general public, foreign buyer / supplier, government): EI00000000010/20/30/40. */
const GENERIC_TIN = /^EI0{9}[1-9]0$/;

/**
 * The customer has a TIN of their own on file (a fleet / company account), not a placeholder
 * or one of LHDN's shared TINs. Such a buyer should get an individual e-Invoice.
 * @param {string | null | undefined} tin
 */
export function hasOwnTin(tin) {
  const t = String(tin ?? "").toUpperCase().replace(/[\s-]/g, "");
  return /^[A-Z0-9]{6,20}$/.test(t) && !GENERIC_TIN.test(t) && !/^0+$/.test(t);
}

/**
 * How one invoice of a month is treated by the monthly consolidated e-Invoice.
 * - Already e-Invoiced on its own: not in it.
 * - The customer asked for their own e-Invoice (QR) or has a TIN on file: it should get an
 *   individual e-Invoice. While the month is open it is left out; once the month has ended it
 *   is included as General Public so the sale is never left unreported, and it is flagged so
 *   the boss sees it before submitting.
 * @param {{ reported: boolean, buyerRequested: boolean, customerTin?: string | null, monthEnded: boolean }} o
 * @returns {{ line: boolean, individual: null | "buyer_request" | "customer_tin" }}
 */
// 【中文】合并发票如何处理一张发票：已单独开过的不算；顾客要求过或有 TIN 的应单独开——月份结束后仍未开，就并入合并发票（General Public）并醒目提示。
export function consolidationTreatment(o) {
  if (o.reported) return { line: false, individual: null };
  const individual = o.buyerRequested ? "buyer_request" : hasOwnTin(o.customerTin) ? "customer_tin" : null;
  return { line: !individual || !!o.monthEnded, individual };
}

/**
 * One invoice in the monthly consolidated e-Invoice preview for LHDN system `env`: its treatment
 * (consolidationTreatment), and whether it is held back because its own submission, or one of its
 * credit notes', is being sent or got no answer from LHDN ("unconfirmed"). Such an invoice may
 * already be at LHDN (an unanswered submission has no UUID, so it does not count as reported), so
 * it gets no line until Check Status settles it: else the same sale could be reported twice.
 * @param {{ eInvoiceUuid?: string | null, eInvoiceStatus?: string | null, eInvoiceEnv?: string | null, eInvoiceSubmittingAt?: Date | string | null, buyerRequestedAt?: Date | string | null, customer?: { tin?: string | null } | null, creditNotes?: Array<{ number: string, eInvoiceStatus?: string | null, eInvoiceEnv?: string | null, eInvoiceSubmittingAt?: Date | string | null }> }} o
 * @param {"sandbox" | "production"} env
 * @param {boolean} monthEnded
 * @param {Date} [now]
 * @returns {{ line: boolean, individual: null | "buyer_request" | "customer_tin", blocked: null | { creditNote: string | null } }}
 */
// 【中文】合并发票预览里一张发票怎么处理：除了 consolidationTreatment 的规则，它自己（或它的退款单）正在送 LHDN 或没回应时，
// 可能已经在 LHDN（没回应的没有 UUID，不算"已申报"），所以先不放进合并发票，等「检查状态」确认，否则同一笔交易会申报两次。
export function consolidationEntry(o, env, monthEnded, now = new Date()) {
  const how = consolidationTreatment({
    reported: isReportedFor(o, env), // e-Invoiced individually
    buyerRequested: !!o.buyerRequestedAt,
    customerTin: o.customer ? o.customer.tin : null,
    monthEnded,
  });
  if (!how.line) return { ...how, blocked: null };
  const cn = (o.creditNotes || []).find((c) => inFlightFor(c, env, now));
  if (inFlightFor(o, env, now) || cn) return { line: false, individual: how.individual, blocked: { creditNote: cn ? cn.number : null } };
  return { ...how, blocked: null };
}

/** LHDN maximum lengths for the buyer details a customer types in (UBL field limits). */
export const BUYER_LIMITS = Object.freeze({ name: 300, address: 150, city: 50, email: 320 });

export const BUYER_ID_TYPES = ID_TYPES;

const text = (v) => String(v ?? "").slice(0, 2000).replace(/\s+/g, " ").trim();

/**
 * TIN and ID as a buyer typed them (QR form or staff form). The TIN may be left blank only by a
 * Malaysian individual (ID type NRIC): the e-Invoice then carries LHDN's general TIN
 * EI00000000010 with their MyKad number (LHDN e-Invoice Specific Guideline; confirm with your tax
 * agent). Businesses (BRN) and passport / army IDs still need a TIN. Each ID number is checked
 * for its type (a real MyKad, an SSM number…). Errors per field: "required" | "invalid".
 * @param {Record<string, unknown>} r
 */
// 【中文】买方的 TIN 和证件：只有马来西亚个人（身份证）可以不填 TIN，电子发票会用 LHDN 的个人通用 TIN EI00000000010 加身份证号；
// 公司（BRN）、护照、军人证仍须填 TIN。证件号码按类型检查（真实的 MyKad、SSM 号码等）。
function checkTinAndId(r) {
  /** @type {Record<string, string>} */
  const errors = {};
  const typed = text(r.tin).toUpperCase().replace(/\s/g, "");
  // An all-zero placeholder ("000000") is no TIN: the e-Invoice (buyerParty) treats it so, and the
  // print must name the same buyer, so it counts as blank (allowed only with an IC number).
  // 【中文】全是 0 的 TIN（如 000000）等于没填：电子发票那边也这样看，打印和 LHDN 才一致；只有身份证可以不填。
  const tin = /^0+$/.test(typed) ? "" : typed;
  const idType = text(r.idType).toUpperCase();
  const idNo = text(r.idNo).toUpperCase().replace(/[\s-]/g, "");
  if (!BUYER_ID_TYPES.includes(idType)) errors.idType = "invalid";
  else {
    const bad = checkBuyerId(idType, idNo);
    if (bad) errors.idNo = bad;
  }
  if (tin ? !/^[A-Z0-9]{6,20}$/.test(tin) : idType !== "NRIC") errors.tin = tin ? "invalid" : "required";
  return { errors, tin, idType, idNo };
}

/**
 * Check what the customer typed on the public QR form. Nothing is cut short silently: a
 * value over LHDN's limit is refused with "too_long". `consent` must be exactly true (the
 * PDPA notice tick box). Error codes per field: "required" | "invalid" | "too_long".
 * @param {Record<string, unknown> | null | undefined} raw
 */
// 【中文】检查顾客填写的资料：超过 LHDN 长度上限就拒绝并说明（不再悄悄截断）；必须勾选 PDPA 同意。
export function checkBuyerFields(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  /** @type {Record<string, string>} */
  const errors = {};
  const name = text(r.name);
  const ids = checkTinAndId(r);
  Object.assign(errors, ids.errors);
  const { tin, idType, idNo } = ids;
  const email = text(r.email);
  const phoneIn = text(r.phone);
  const address = text(r.address);
  const postcode = text(r.postcode);
  const city = text(r.city);
  const stateCode = text(r.stateCode);

  if (name.length < 2) errors.name = "required";
  else if (name.length > BUYER_LIMITS.name) errors.name = "too_long";
  if (email.length > BUYER_LIMITS.email) errors.email = "too_long";
  else if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "invalid";
  // Optional, but when given it must be a number LHDN accepts for a named buyer (CF410).
  const phone = normalizeMyInvoisPhone(phoneIn) === "NA" ? "" : phoneIn;
  if (phone && !isValidMyInvoisPhone(phone, { allowNA: false })) errors.phone = "invalid";
  if (address.length < 3) errors.address = "required";
  else if (address.length > BUYER_LIMITS.address) errors.address = "too_long";
  if (!/^\d{5}$/.test(postcode)) errors.postcode = postcode ? "invalid" : "required";
  if (city.length < 2) errors.city = "required";
  else if (city.length > BUYER_LIMITS.city) errors.city = "too_long";
  // 01-16; 17 ("not applicable") is not a real address.
  if (!/^(0[1-9]|1[0-6])$/.test(stateCode)) errors.stateCode = "required";
  if (r.consent !== true) errors.consent = "required";

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name, tin, idType, idNo, email,
      phone: phone ? normalizeMyInvoisPhone(phone) : "",
      address, postcode, city, stateCode,
    },
  };
}

/**
 * Address and e-mail staff save with the buyer on the invoice page (save_buyer). They replace
 * what an earlier QR request stored, so a company chosen by staff is never printed / sent with
 * the address or e-mail of the person who scanned the QR. All optional (LHDN then gets "NA"),
 * but an address that is given must be complete, with the same rules and LHDN limits as the
 * customer's QR form (checkBuyerFields). Errors: { address?: "incomplete" | "too_long", email?: "invalid" }.
 * @param {Record<string, unknown> | null | undefined} raw
 */
// 【中文】店员在发票页保存买方时一起保存的地址和电邮：会取代之前扫码填的资料（不会把公司配上扫码人的私人地址）。
// 可以全部留空；填了地址就必须完整（街道、5 位邮编、城市、州属），规则和长度上限与顾客扫码表格相同。
export function checkStaffBuyerContact(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  /** @type {Record<string, string>} */
  const errors = {};
  const email = text(r.email);
  const address = text(r.address);
  const postcode = text(r.postcode);
  const city = text(r.city);
  const stateCode = text(r.stateCode);
  if (email.length > BUYER_LIMITS.email || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) errors.email = "invalid";
  if (address || postcode || city || stateCode) {
    if (address.length > BUYER_LIMITS.address || city.length > BUYER_LIMITS.city) errors.address = "too_long";
    else if (address.length < 3 || !/^\d{5}$/.test(postcode) || city.length < 2 || !/^(0[1-9]|1[0-6])$/.test(stateCode)) {
      errors.address = "incomplete";
    }
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { email, address, postcode, city, stateCode } };
}

const STAFF_ID_ERRORS = {
  idType: "Choose the ID type (NRIC, passport, BRN or army)",
  idNo: "The ID number is not valid for that ID type (NRIC: the 12 digits of a real IC; BRN: the SSM number, e.g. 202001012345)",
  tin: "TIN is needed for a business, passport or army ID (only a Malaysian individual with an IC may leave it blank). It is 6 to 20 letters or numbers.",
  name: "Name required",
};

/**
 * Name, TIN and ID staff save as the buyer on the invoice page (save_buyer). Same rules as the
 * customer's QR form: the TIN may be blank only for a Malaysian individual (NRIC), and the ID
 * number must be valid for its type. `tin` is "" when left blank (store null).
 * @param {Record<string, unknown> | null | undefined} raw
 * @returns {{ ok: true, value: { name: string, tin: string, idType: string, idNo: string } } | { ok: false, field: "name" | "tin" | "idType" | "idNo", error: string }}
 */
// 【中文】店员在发票页保存买方时的名字、TIN、证件：规则和顾客扫码表格相同（只有身份证个人可以不填 TIN，证件号码按类型检查）。
export function checkStaffBuyerIdentity(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const ids = checkTinAndId({ ...r, idType: r.idType ?? "NRIC" });
  const name = text(r.name).slice(0, 150);
  for (const field of /** @type {const} */ (["idType", "idNo", "tin"])) {
    if (ids.errors[field]) return { ok: false, field, error: STAFF_ID_ERRORS[field] };
  }
  if (name.length < 2) return { ok: false, field: "name", error: STAFF_ID_ERRORS.name };
  return { ok: true, value: { name, tin: ids.tin, idType: ids.idType, idNo: ids.idNo } };
}

/**
 * LHDN document type for a credit note (per the LHDN e-Invoice Guideline; have your tax agent
 * confirm it):
 * - nothing refunded → "02" credit note (reduces the invoice, no money goes back);
 * - the whole credited value refunded → "04" refund note (confirms money returned to the buyer);
 * - only part refunded → not sendable as one document ("partial_refund"): issue the refunded part
 *   and the rest as two separate credit notes.
 * A refund short of the credit by no more than the invoice's cash rounding (an invoice of 100.02
 * paid as 100.00 and fully refunded) counts as a full refund.
 * @param {{ amount: number, refundAmount?: number | null, roundingAdjustment?: number | null }} p
 * @returns {{ ok: true, type: "02" | "04" } | { ok: false, reason: "partial_refund" }}
 */
// 【中文】退款单送 LHDN 的类型（依 LHDN 电子发票指南，请税务代理确认）：没退钱 → 02 贷项通知；退回全部金额 → 04 退款单；
// 只退一部分 → 不能用一份单据送出，要分开开两张（退钱的部分、不退钱的部分）。付款时现金进位少收的几仙不算"部分退款"。
export function creditNoteDocType(p) {
  const A = toCents(p.amount);
  const F = toCents(p.refundAmount || 0);
  if (F <= 0) return { ok: true, type: "02" };
  // Cash rounding is at most 2 sen (5-sen rounding); a negative adjustment = customer paid less.
  const roundingShort = Math.min(2, Math.max(0, -toCents(p.roundingAdjustment || 0)));
  if (F + roundingShort >= A) return { ok: true, type: "04" };
  return { ok: false, reason: "partial_refund" };
}

/** Days a buyer request may wait for its own e-Invoice before it is flagged (review H4). */
export const BUYER_REQUEST_ALERT_DAYS = 3;

/**
 * A buyer request (QR form or staff) still waiting for its own e-Invoice after more than
 * `days` days: invoice issued and not cancelled, no e-Invoice yet, and not reported in a
 * consolidated e-Invoice either.
 * @param {{ buyerRequestedAt?: Date | string | null, invoiceNumber?: string | null, status?: string | null, reported: boolean, consolidated: boolean }} o
 * @param {Date} [now]
 * @param {number} [days]
 */
// 【中文】顾客扫码（或店员）要求的个别电子发票，等了超过 3 天还没开出、也没并入合并发票，就要提醒老板。
export function buyerRequestWaiting(o, now = new Date(), days = BUYER_REQUEST_ALERT_DAYS) {
  if (!o.buyerRequestedAt || !o.invoiceNumber || o.status === "CANCELLED") return false;
  if (o.reported || o.consolidated) return false;
  const at = new Date(o.buyerRequestedAt).getTime();
  return Number.isFinite(at) && now.getTime() - at > days * 24 * 60 * 60 * 1000;
}

/** LHDN statuses after which a document no longer counts, as they may be stored. */
const ENDED_STATUSES = ["invalid", "cancelled", "rejected", "Invalid", "Cancelled", "Rejected"];

/**
 * Prisma `where` for the buyer requests that may be waiting (see buyerRequestWaiting): asked
 * before `cutoff`, invoice issued and not cancelled, no e-Invoice that counts for `env` (same rule
 * as isReportedFor), and not linked to one of the consolidated e-Invoices that count
 * (`reportedConsolidatedIds`). The database filters these out BEFORE the list is cut to its first
 * rows: filtering after loading the 500 oldest requests left the list empty once a shop had 500
 * old requests that were all done, so new waiting customers were never shown.
 * @param {{ cutoff: Date, env: "sandbox" | "production", reportedConsolidatedIds: string[] }} p
 */
// 【中文】查询可能还在等待的顾客申请：条件全部放进数据库查询（以前先取最旧的 500 笔再过滤，旧申请多了以后新的就永远显示不出来）。
export function waitingRequestWhere(p) {
  const notReported = [{ eInvoiceUuid: null }, { eInvoiceStatus: { in: ENDED_STATUSES } }];
  // A sandbox test counts only while working in the sandbox.
  if (p.env === "production") notReported.push({ eInvoiceEnv: "sandbox" });
  const notConsolidated = p.reportedConsolidatedIds.length
    ? [{ consolidatedId: null }, { consolidatedId: { notIn: [...p.reportedConsolidatedIds] } }]
    : null;
  return {
    buyerRequestedAt: { not: null, lt: p.cutoff },
    invoiceNumber: { not: null },
    status: { not: "CANCELLED" },
    AND: [{ OR: notReported }, ...(notConsolidated ? [{ OR: notConsolidated }] : [])],
  };
}

/**
 * Check the reference of a consolidated e-Invoice the boss submitted in the MyInvois portal.
 * @param {{ uuid?: unknown, longId?: unknown, number?: unknown }} raw
 */
// 【中文】检查老板在 MyInvois 网站提交的合并发票资料（UUID、Long ID、单号）格式。
export function checkPortalReference(raw) {
  const uuid = String(raw?.uuid ?? "").trim();
  const longId = String(raw?.longId ?? "").trim();
  const number = String(raw?.number ?? "").trim();
  // LHDN UUIDs / Long IDs are short alphanumeric codes. The document number is typed exactly as
  // the MyInvois portal shows it (any printable characters, spaces and # included, at most 50):
  // a stricter pattern made some real numbers impossible to record.
  // 【中文】单号要照 MyInvois 网站显示的输入（任何可打印字符，可含空格和 #，最多 50 个）。
  if (!/^[A-Za-z0-9]{10,40}$/.test(uuid)) return { ok: false, error: "UUID format looks wrong" };
  if (longId && !/^[A-Za-z0-9]{10,80}$/.test(longId)) return { ok: false, error: "Long ID format looks wrong" };
  if (!/^[\x21-\x7E][\x20-\x7E]{0,49}$/.test(number)) {
    return { ok: false, error: "Document number looks wrong (type it as the MyInvois portal shows it, at most 50 characters)" };
  }
  return { ok: true, value: { uuid, longId: longId || null, number } };
}

/**
 * LHDN's details of the document a portal-recorded consolidated e-Invoice points to, when its
 * document number differs from the one typed in: is it still this shop's consolidated e-Invoice of
 * the month (typed with another number), or another document? It is the consolidated one when LHDN
 * still counts it, it is an invoice to General Public (TIN EI00000000010, or the name "General
 * Public"), and its total payable is the record's total to the sen. Otherwise (another buyer,
 * another total, a credit note) the reference belongs to some other document.
 * @param {unknown} raw LHDN's document details
 * @param {{ status: string | null | undefined, totalAmount: number }} p
 */
// 【中文】网站登记的合并发票单号和 LHDN 的不同时：LHDN 仍有效、买方是 General Public、应付总额和记录一致（精确到仙），才是本店这个月的合并发票（只是单号输入不同）；否则是别的单据。
export function portalConsolidatedDocument(raw, p) {
  if (!raw || typeof raw !== "object" || !isLiveStatus(p.status)) return false;
  const d = /** @type {Record<string, unknown>} */ (raw);
  const typeName = String(d.typeName ?? d.documentType ?? "").trim().toLowerCase();
  if (typeName && typeName !== "invoice" && typeName !== "01") return false;
  const tins = [d.receiverId, d.receiverTin, d.receiverTIN, d.buyerTin, d.buyerTIN].map((v) => String(v ?? "").trim().toUpperCase());
  const name = String(d.receiverName ?? d.buyerName ?? "").trim().toLowerCase();
  if (!tins.includes(GENERAL_PUBLIC_TIN) && name !== "general public") return false;
  const total = Number(d.totalPayableAmount ?? d.total);
  return Number.isFinite(total) && Number.isFinite(p.totalAmount) && toCents(total) === toCents(p.totalAmount);
}

/**
 * Same ids, ignoring order and duplicates: the boss confirms exactly the invoices the page showed.
 * @param {unknown} a
 * @param {string[]} b
 */
export function sameIdSet(a, b) {
  if (!Array.isArray(a)) return false;
  const x = new Set(a.map(String));
  const y = new Set(b);
  return x.size === y.size && [...y].every((id) => x.has(id));
}

/**
 * What the boss records from the MyInvois portal must be what the page showed: the same
 * invoices, the same credit notes netted in and the same total to the sen. A credit note
 * issued after the page was opened changes the amounts, so the portal document (built from the
 * page) would no longer match what is saved.
 * @param {{ orderIds?: unknown, creditNoteIds?: unknown, total?: unknown } | null | undefined} sent
 * @param {{ lines: Array<{ orderId: string, creditNoteIds: string[] }>, totals: { total: number } }} p
 */
// 【中文】登记网站提交的合并发票时，发票、扣掉的退款单和总额（精确到仙）都必须和页面显示的一样，否则拒绝。
export function portalRecordMatches(sent, p) {
  const total = typeof sent?.total === "number" ? sent.total : NaN;
  return (
    sameIdSet(sent?.orderIds, p.lines.map((l) => l.orderId)) &&
    sameIdSet(sent?.creditNoteIds, p.lines.flatMap((l) => l.creditNoteIds)) &&
    Number.isFinite(total) &&
    toCents(total) === toCents(p.totals.total)
  );
}

/**
 * Checked again inside the save transaction: from the invoices and credit notes as they are now,
 * each line still gives the reported total and SST of the preview, and the credit notes not yet
 * reported on their own are exactly the ones netted in. Same rules as consolidationPreview.
 * @param {Array<{ orderId: string, creditNoteIds: string[], total: number, tax: number }>} lines
 * @param {Array<{ id: string, totalAmount: number, taxAmount: number }>} orders the line invoices, read now
 * @param {Array<{ id: string, workOrderId: string, amount: number, taxAmount?: number | null, eInvoiceUuid?: string | null, eInvoiceStatus?: string | null, eInvoiceEnv?: string | null }>} creditNotes all credit notes of those invoices, read now
 * @param {"sandbox" | "production"} env
 */
// 【中文】保存前在事务内再核对一次：按现在的发票和退款单重新计算每一行的申报金额和 SST，必须和预览一致。
export function consolidationLinesUnchanged(lines, orders, creditNotes, env) {
  const pending = creditNotes.filter((c) => !isReportedFor(c, env));
  if (!sameIdSet(pending.map((c) => c.id), lines.flatMap((l) => l.creditNoteIds))) return false;
  const byId = new Map(orders.map((o) => [o.id, o]));
  return lines.every((l) => {
    const o = byId.get(l.orderId);
    if (!o) return false;
    const mine = pending.filter((c) => c.workOrderId === l.orderId);
    const credited = toCents(mine.reduce((s, c) => s + c.amount, 0));
    const creditedTax = toCents(mine.reduce((s, c) => s + (c.taxAmount || 0), 0));
    return (
      toCents(o.totalAmount) - credited === toCents(l.total) &&
      Math.max(0, toCents(o.taxAmount) - creditedTax) === toCents(l.tax)
    );
  });
}

/**
 * Split a long list into parts whose JSON stays under `maxChars`, so an audit entry
 * (details are capped at 4000 characters) never cuts a list in the middle.
 * @param {string[]} items
 * @param {number} [maxChars]
 * @returns {string[][]}
 */
export function chunkForAudit(items, maxChars = 2500) {
  const parts = [];
  let cur = [];
  let size = 2;
  for (const it of items) {
    const add = JSON.stringify(it).length + 1;
    if (cur.length && size + add > maxChars) {
      parts.push(cur);
      cur = [];
      size = 2;
    }
    cur.push(it);
    size += add;
  }
  if (cur.length || !parts.length) parts.push(cur);
  return parts;
}
