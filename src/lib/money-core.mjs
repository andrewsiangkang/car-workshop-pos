/** Money primitives. Persisted schema migration to integer cents is a separate, explicit migration. */
export function toCents(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (Math.abs(n) > Number.MAX_SAFE_INTEGER / 100) throw new RangeError("Money value exceeds safe cent precision");
  return Math.round((n + Math.sign(n) * Number.EPSILON) * 100);
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
