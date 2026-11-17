// How a work order finds the car and the customer again: plate and phone normalisation,
// shared by the plate lookup, the work-order save and the Customers page.
// 【中文】车牌、电话的统一规范化：查车牌、开工单、客户页面都用同一套规则，避免同一个客户/车被当成新的。
import { normalizeMyInvoisPhone } from "./myinvois-phone.mjs";

/**
 * Plate as stored: no whitespace at all, upper case ("wxy 1234" -> "WXY1234").
 * @param {unknown} value
 */
export function normalisePlate(value) {
  return String(value ?? "").replace(/\s+/g, "").toUpperCase().slice(0, 20);
}

/**
 * The phone used to match customers: spaces, hyphens, brackets and dots removed, a leading
 * "+" kept. Returns "" for a blank number or a placeholder ("N/A", "-", "NIL", "0"…), so a
 * walk-in without a phone can never be matched to another walk-in. Dummy numbers made of one
 * repeated digit ("000-0000000", "000 000 0000", "111-1111111") count as placeholders too: the
 * check runs on the stripped key, so separators cannot turn a dummy into a "real" phone.
 * @param {unknown} value
 */
// 【中文】用来比对客户的电话：去掉空格、横线、括号、点；保留开头的 +。没填、占位符（N/A、-、NIL…）或全是同一个数字的假号码（000-0000000、000 000 0000）都返回空字符串 → 永远不按它配对。
export function customerPhoneKey(value) {
  const raw = String(value ?? "").trim();
  if (!raw || !/\d/.test(raw)) return "";
  // Same placeholder list as the LHDN phone rule ("0", "000", "N/A"…).
  if (normalizeMyInvoisPhone(raw) === "NA") return "";
  const key = raw.replace(/[\s\-().]/g, "").slice(0, 30);
  if (!/\d/.test(key)) return "";
  // Checked again after stripping: "000-0000000" is the same dummy as "0000000000".
  if (normalizeMyInvoisPhone(key) === "NA" || /^\+?(\d)\1*$/.test(key)) return "";
  return key;
}

/**
 * Same name for matching purposes: case and repeated spaces are ignored,
 * so "ali  bin abu" does not count as renaming "Ali bin Abu".
 * @param {unknown} a
 * @param {unknown} b
 */
export function sameCustomerName(a, b) {
  const n = (v) => String(v ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  return n(a) === n(b);
}
