/** Money primitives. Persisted schema migration to integer cents is a separate, explicit migration. */

const MAX_RM = Number.MAX_SAFE_INTEGER / 100;

/**
 * Ringgit → integer sen, rounded exactly half-up (away from zero for negatives).
 * A double holds about 15 significant decimal digits, so the value is first read back as its
 * 15-digit decimal text: that drops binary noise such as 36.25 × 6% = 2.1749999999999998, which
 * used to round to 2.17 instead of 2.18. The sen are then rounded on the decimal digits, not on
 * a float multiplied by 100.
 * 【中文】RM 转成整数"分"，严格四舍五入（负数向远离 0 的方向）：先按 15 位有效数字的十进制文字读回，去掉浮点误差（36.25 × 6% 以前算成 2.17，应为 2.18）。
 */
export function toCents(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (Math.abs(n) > MAX_RM) throw new RangeError("Money value exceeds safe cent precision");
  const a = Math.abs(n);
  // Far below half a sen (and where toPrecision would switch to exponent notation).
  if (a < 1e-6) return 0;
  const [whole, frac = ""] = a.toPrecision(15).split(".");
  const digits = (frac + "000").slice(0, 3);
  let cents = Number(whole) * 100 + Number(digits.slice(0, 2));
  if (Number(digits[2]) >= 5) cents += 1;
  return n < 0 && cents !== 0 ? -cents : cents;
}

export function fromCents(cents) {
  if (!Number.isSafeInteger(cents)) throw new RangeError("Cents must be a safe integer");
  return cents / 100;
}

export function roundMoney(value) {
  return fromCents(toCents(value));
}

export function addMoney(...values) {
  return fromCents(values.reduce((sum, value) => sum + toCents(value), 0));
}

export function multiplyMoney(amount, quantity) {
  const q = Number(quantity);
  if (!Number.isFinite(q)) throw new TypeError("Quantity must be finite");
  return fromCents(toCents(amount * q));
}
