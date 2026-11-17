// PDPA rules for one customer's data (pure, no database): checking typed details (with LHDN's
// address limits), anonymising, the 7-year record-keeping check and the retention schedule.
// 【中文】客户个人资料（PDPA）的纯规则：资料校验（LHDN 地址长度上限）、匿名化、7 年保存义务检查、保留期限。
import { customerPhoneKey } from "./customer-match.mjs";

/** Invoices, receipts and credit notes must be kept 7 years (Malaysian tax record-keeping). */
export const RECORD_KEEPING_YEARS = 7;
/** Longest retention period that can be set. */
export const MAX_RETENTION_YEARS = 50;
/** Name given to an anonymised customer. */
export const ANONYMISED_NAME = "Anonymised customer";
/** Phone stored when there is none (same placeholder as a walk-in). */
export const NO_PHONE = "N/A";
/** Languages a WhatsApp reminder can be written in. */
export const REMINDER_LANGUAGES = ["en", "zh", "ms"];
/** LHDN MyInvois field limits used for the customer's address. */
export const CUSTOMER_LIMITS = { name: 200, email: 200, tin: 20, address: 150, city: 50, notes: 2000 };

/**
 * The same date `years` calendar years earlier.
 * @param {Date | number} now
 * @param {number} years
 */
export function yearsBefore(now, years) {
  const d = new Date(now);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d;
}

/**
 * Retention setting from Settings → Privacy: blank / "off" / 0 = off (null), otherwise whole years
 * from 7 (the record-keeping minimum) to 50.
 * 【中文】客户资料保留年限：留空或 0 = 关闭；否则 7–50 年（至少 7 年，因为单据要保存 7 年）。
 * @param {unknown} v
 * @returns {{ ok: true, value: number | null } | { ok: false, error: string }}
 */
export function parseRetentionYears(v) {
  if (v === null || v === undefined || v === "" || v === 0 || v === "0" || v === "off") return { ok: true, value: null };
  const n = Number(v);
  if (!Number.isInteger(n) || n < RECORD_KEEPING_YEARS || n > MAX_RETENTION_YEARS) {
    return { ok: false, error: "Keep customer records for at least 7 years (or turn this off)" };
  }
  return { ok: true, value: n };
}

/** @param {unknown} v */
const oneLine = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

/**
 * Checks customer details typed on the Customers page. Only the keys present in `input` are
 * checked and returned, unless `all` is set (a new customer). Blank optional fields become null.
 * LHDN limits: address 150 characters, city 50, postcode 5 digits, state a code from MY_STATES.
 * 【中文】校验客户资料：地址最多 150 字、城市 50 字、邮编 5 位数字、州属必须是列表里的代码。
 * @param {Record<string, unknown>} input
 * @param {{ stateCodes: string[], all?: boolean, phoneRequired?: boolean }} opts
 * @returns {{ ok: true, data: Record<string, string | null> } | { ok: false, field: string, error: string }}
 */
export function validateCustomerFields(input, { stateCodes, all = false, phoneRequired = false }) {
  /** @type {Record<string, string | null>} */
  const data = {};
  const has = (/** @type {string} */ k) => all || Object.prototype.hasOwnProperty.call(input, k);
  const fail = (/** @type {string} */ field, /** @type {string} */ error) => ({ ok: /** @type {const} */ (false), field, error });

  if (has("name")) {
    const name = oneLine(input.name);
    if (!name) return fail("name", "Please fill in the name");
    if (name.length > CUSTOMER_LIMITS.name) return fail("name", "Name is too long");
    data.name = name;
  }
  if (has("phone")) {
    const key = customerPhoneKey(input.phone);
    if (!key && phoneRequired) return fail("phone", "Please fill in a phone number");
    data.phone = key || NO_PHONE;
  }
  if (has("email")) {
    const email = oneLine(input.email);
    if (email && (email.length > CUSTOMER_LIMITS.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      return fail("email", "Enter a valid email address");
    }
    data.email = email || null;
  }
  if (has("tin")) {
    const tin = String(input.tin ?? "").replace(/\s+/g, "").toUpperCase();
    if (tin && (tin.length > CUSTOMER_LIMITS.tin || !/^[A-Z0-9]+$/.test(tin))) {
      return fail("tin", "TIN may only contain letters and numbers (at most 20)");
    }
    data.tin = tin || null;
  }
  if (has("address")) {
    const address = oneLine(input.address);
    if (address.length > CUSTOMER_LIMITS.address) return fail("address", "Address can be at most 150 characters");
    data.address = address || null;
  }
  if (has("postcode")) {
    const postcode = String(input.postcode ?? "").replace(/\s+/g, "");
    if (postcode && !/^\d{5}$/.test(postcode)) return fail("postcode", "Postcode must be 5 digits");
    data.postcode = postcode || null;
  }
  if (has("city")) {
    const city = oneLine(input.city);
    if (city.length > CUSTOMER_LIMITS.city) return fail("city", "City can be at most 50 characters");
    data.city = city || null;
  }
  if (has("stateCode")) {
    const stateCode = String(input.stateCode ?? "").trim();
    if (stateCode && !stateCodes.includes(stateCode)) return fail("stateCode", "Choose a state from the list");
    data.stateCode = stateCode || null;
  }
  if (has("notes")) {
    const notes = String(input.notes ?? "").trim();
    if (notes.length > CUSTOMER_LIMITS.notes) return fail("notes", "Notes are too long");
    data.notes = notes || null;
  }
  if (has("language")) {
    const language = String(input.language ?? "").trim();
    if (language && !REMINDER_LANGUAGES.includes(language)) return fail("language", "Choose a reminder language from the list");
    data.language = language || null;
  }
  return { ok: true, data };
}

/**
 * What anonymising writes on the customer record: the name becomes "Anonymised customer", all
 * contact and tax details are removed, reminders are switched off for good. Invoices and amounts
 * stay (they are not part of this record), and issued documents keep their frozen snapshot.
 * 【中文】匿名化写入的内容：名字改成 "Anonymised customer"，清除电话、电邮、TIN、地址、备注，永久不再发提醒；
 * 发票和金额保留，已开出的单据保留开出当天的资料快照。
 * @param {Date} now
 */
export function anonymisedCustomerData(now) {
  return {
    name: ANONYMISED_NAME,
    phone: NO_PHONE,
    email: null,
    tin: null,
    notes: null,
    address: null,
    postcode: null,
    city: null,
    stateCode: null,
    language: null,
    reminderConsentAt: null,
    reminderOptOutAt: now,
    anonymisedAt: now,
  };
}

/** @param {unknown} v */
function time(v) {
  if (v === null || v === undefined || v === "") return NaN;
  const t = v instanceof Date ? v.getTime() : new Date(/** @type {string | number} */ (v)).getTime();
  return Number.isFinite(t) ? t : NaN;
}

/**
 * @typedef {{ status?: string | null, invoiceNumber?: string | null, receiptNumber?: string | null,
 *   createdAt?: unknown, invoicedAt?: unknown, paidAt?: unknown, completedAt?: unknown,
 *   payments?: Array<{ paidAt?: unknown }>, creditNotes?: Array<{ createdAt?: unknown }> }} OrderDates
 */

/** Malaysia time is UTC+8 all year. */
const MYT_OFFSET_MS = 8 * 3600 * 1000;

/**
 * Start of the record-keeping period: 1 January (Malaysia time) of the year 7 years before this
 * one. Tax records are kept 7 years from the END of the year they relate to (Income Tax Act s82),
 * so a document dated any time in that year, or later, must still be kept. On 14 Nov 2026 this is
 * 1 Jan 2019: an invoice of 1 Jun 2019 is kept until 31 Dec 2026.
 * 【中文】保存期的开始：今年往前 7 年的 1 月 1 日（马来西亚时间）。税务记录要从「所属年度结束」起保存 7 年，
 * 所以那一年里任何日期的单据都还要保存。
 * @param {Date | number} now
 * @returns {number} epoch ms
 */
export function recordKeepingStart(now) {
  const year = new Date(time(now) + MYT_OFFSET_MS).getUTCFullYear();
  return Date.UTC(year - RECORD_KEEPING_YEARS, 0, 1) - MYT_OFFSET_MS;
}

/**
 * Dates of the documents of one job: its invoice (invoice date, else job date) and its receipt
 * (payment date, else invoice date, else job date). A receipt paid in a later year than its
 * invoice counts on its own date, so it is kept long enough.
 * 【中文】一张工单的单据日期：发票（开票日，否则工单日）和收据（付款日，否则开票日、工单日）分别计算。
 * @param {OrderDates} o
 * @returns {number[]} epoch ms
 */
export function orderDocumentTimes(o) {
  /** @type {number[]} */
  const out = [];
  const first = (/** @type {unknown[]} */ list) => list.map(time).find(Number.isFinite);
  if (o.invoiceNumber) {
    const t = first([o.invoicedAt, o.createdAt]);
    if (t !== undefined) out.push(t);
  }
  if (o.receiptNumber) {
    const t = first([o.paidAt, o.invoicedAt, o.createdAt]);
    if (t !== undefined) out.push(t);
  }
  return out;
}

/**
 * Dates of the tax documents issued to this customer: each invoice, receipt and credit note.
 * @param {OrderDates[]} orders
 * @returns {number[]} epoch ms
 */
export function taxDocumentTimes(orders) {
  /** @type {number[]} */
  const out = [];
  for (const o of orders || []) {
    out.push(...orderDocumentTimes(o));
    for (const cn of o.creditNotes || []) {
      const t = time(cn.createdAt);
      if (Number.isFinite(t)) out.push(t);
    }
  }
  return out;
}

/**
 * Tax documents of this customer still inside the record-keeping period (see recordKeepingStart).
 * 【中文】这位客户还在保存期内的单据数量和最新日期。
 * @param {OrderDates[]} orders
 * @param {Date | number} now
 * @returns {{ count: number, latest: string | null }}
 */
export function recordKeepingCheck(orders, now) {
  const cutoff = recordKeepingStart(now);
  const recent = taxDocumentTimes(orders).filter((t) => t >= cutoff);
  return { count: recent.length, latest: recent.length ? new Date(Math.max(...recent)).toISOString() : null };
}

/**
 * The customer's last visit: the newest of the customer record's creation and every job date,
 * invoice, payment and credit note. Errs on the late side, so nobody is anonymised too early.
 * @param {{ createdAt?: unknown, workOrders?: OrderDates[] }} customer
 * @returns {number} epoch ms (NaN when unknown)
 */
export function lastActivityTime(customer) {
  let best = time(customer.createdAt);
  const take = (/** @type {unknown} */ v) => {
    const t = time(v);
    if (Number.isFinite(t) && !(t <= best)) best = t;
  };
  for (const o of customer.workOrders || []) {
    take(o.createdAt);
    take(o.invoicedAt);
    take(o.paidAt);
    take(o.completedAt);
    for (const p of o.payments || []) take(p.paidAt);
    for (const cn of o.creditNotes || []) take(cn.createdAt);
  }
  return best;
}

/**
 * Due for anonymisation under the retention schedule: not anonymised yet, a known last visit
 * older than `years`, and (extra safety) no tax document still inside the record-keeping period
 * (recordKeepingStart: 7 years from the end of the document's year).
 * 【中文】是否到了保留期限：尚未匿名化、最后一次来店早于设定年限，并且（双重保险）没有任何还在保存期内的单据。
 * @param {{ anonymisedAt?: unknown, createdAt?: unknown, workOrders?: OrderDates[] }} customer
 * @param {number} years
 * @param {Date | number} now
 */
export function isRetentionDue(customer, years, now) {
  if (customer.anonymisedAt) return false;
  if (!Number.isInteger(years) || years < RECORD_KEEPING_YEARS) return false;
  const last = lastActivityTime(customer);
  if (!Number.isFinite(last) || last >= yearsBefore(now, years).getTime()) return false;
  return recordKeepingCheck(customer.workOrders || [], now).count === 0;
}

/** Job statuses where work is still going on (the customer must stay reachable). */
export const OPEN_JOB_STATUSES = ["CONFIRMED", "IN_PROGRESS"];

/**
 * Why this customer may not be anonymised right now, or null when it may.
 * - ALREADY: already anonymised;
 * - OPEN_JOB: a job is confirmed or in progress;
 * - RECORD_KEEPING: an invoice, receipt or credit note is still inside the record-keeping period
 *   (recordKeepingStart) and the boss has not confirmed that they understand the record-keeping duty.
 * 【中文】不能匿名化的原因：已经匿名化；有进行中的工单；有还在保存期内的单据而老板还没确认了解保存义务。
 * @param {{ customer: { anonymisedAt?: unknown }, orders: OrderDates[], now: Date | number, confirmRecordKeeping?: boolean }} p
 * @returns {null | { code: "ALREADY" | "OPEN_JOB" | "RECORD_KEEPING", count?: number, latest?: string | null }}
 */
export function anonymiseRefusal({ customer, orders, now, confirmRecordKeeping }) {
  if (customer.anonymisedAt) return { code: "ALREADY" };
  if ((orders || []).some((o) => OPEN_JOB_STATUSES.includes(String(o.status)))) return { code: "OPEN_JOB" };
  const recent = recordKeepingCheck(orders, now);
  if (recent.count > 0 && confirmRecordKeeping !== true) return { code: "RECORD_KEEPING", ...recent };
  return null;
}
