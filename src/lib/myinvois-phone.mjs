/**
 * Normalize a phone number for MyInvois core-field validation (CF408-CF410).
 * Malaysian local numbers become international: 03 1234 5678 -> +60312345678.
 * @param {string | null | undefined} value
 * @returns {string}
 */
export function normalizeMyInvoisPhone(value) {
  const raw = String(value ?? "").trim();
  if (!raw || /^(?:N\/?A|NA)$/i.test(raw)) return "NA";

  let phone = raw.replace(/[^0-9+]/g, "");
  if (phone.startsWith("00")) phone = `+${phone.slice(2)}`;
  if (phone.startsWith("0")) phone = `+60${phone.slice(1)}`;
  else if (phone.startsWith("60")) phone = `+${phone}`;

  return phone;
}

/**
 * MyInvois accepts 8-20 digits, optionally prefixed with a single plus sign.
 * @param {string | null | undefined} value
 * @returns {boolean}
 */
export function isValidMyInvoisPhone(value) {
  const phone = normalizeMyInvoisPhone(value);
  return phone === "NA" || /^\+?\d{8,20}$/.test(phone);
}
