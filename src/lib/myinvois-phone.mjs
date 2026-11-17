// Phone numbers for MyInvois core-field validation (CF408-CF410).
// 【中文】MyInvois 电话号码规范化与校验：本地号码转 +60 国际格式（E.164），拒绝占位符、分机号等无效写法。

/** Typed in when there is no number: "NA", "N/A", "-", "NIL", "TBA", "none", "0"… */
const PLACEHOLDER = /^(?:n\.?\s*\/?\s*a\.?|nil|none|null|tba|tbc|unknown|-+|\.+|0+)$/i;

/**
 * Normalize a phone number to international (E.164) form for MyInvois.
 * - Malaysian local numbers become international: "03-1234 5678" -> "+60312345678".
 * - Placeholders ("NA", "-", "NIL", empty…) become "NA".
 * - Only the first number is kept when several are typed ("012-… / 019-…").
 * - An extension ("ext 12", "x12", "#12") is dropped; the trunk "(0)" in "+60 (0)12…" is removed.
 * Text with no digits that is not a known placeholder returns "" (invalid).
 * @param {string | null | undefined} value
 * @returns {string}
 */
export function normalizeMyInvoisPhone(value) {
  let raw = String(value ?? "").trim();
  if (!raw || PLACEHOLDER.test(raw)) return "NA";

  // First number only.
  raw = raw.split(/\s*(?:[/,;|&]|\bor\b|\batau\b)\s*/i)[0].trim();
  // Drop an extension at the end.
  raw = raw.replace(/\s*(?:ext\.?|extension|samb\.?|x|#)\s*\d{1,6}\s*$/i, "").trim();
  if (!raw || PLACEHOLDER.test(raw)) return "NA";
  if (!/\d/.test(raw)) return "";
  // "+60 (0)12-345 6789": the (0) is the local trunk prefix, not part of the number.
  raw = raw.replace(/\(\s*0\s*\)/g, "");

  let phone = raw.replace(/[^0-9+]/g, "");
  if (phone.startsWith("00")) phone = `+${phone.slice(2)}`;
  else if (phone.startsWith("0")) phone = `+60${phone.slice(1)}`;
  else if (phone.startsWith("60")) phone = `+${phone}`;
  return phone;
}

/**
 * MyInvois wants E.164: "+", a country code that does not start with 0, 8-15 digits in all.
 * Malaysian numbers (+60) must have 8-10 digits after the 60 and must not start with 0.
 * "NA" is only acceptable where LHDN allows it (the buyer on a consolidated / general-public
 * e-Invoice), so callers decide with `allowNA`.
 * @param {string | null | undefined} value
 * @param {{ allowNA?: boolean }} [options]
 * @returns {boolean}
 */
export function isValidMyInvoisPhone(value, options = {}) {
  const allowNA = options.allowNA !== false;
  const phone = normalizeMyInvoisPhone(value);
  if (phone === "NA") return allowNA;
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) return false;
  if (phone.startsWith("+60")) return /^\+60[1-9]\d{7,9}$/.test(phone);
  return true;
}
