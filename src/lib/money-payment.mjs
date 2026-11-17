// Malaysian 5-sen cash rounding for taking payment (pure, integer sen; shared by the payment
// route and the payment panel so both always agree).
// - Bank Negara's rounding mechanism applies to CASH only. Card, Touch 'n Go, bank transfer and
//   "other" are charged to the exact sen and are never rounded.
// - With a split payment only the cash part is rounded: e.g. a bill of RM100.03 paid RM50.00 by
//   card + RM50.03 cash → the cash part becomes RM50.05 (rounding +0.02), the card part stays 50.00.
// - Rounding is decided only when this payment settles the whole remaining balance (a partial
//   payment is never rounded; the last payment settles and rounds).
// 【中文】马来西亚 5 仙现金进位（纯函数，以分计算）：只有现金部分进位；刷卡、TNG、转账一律按实际金额；拆分付款只对现金部分进位；只有这次付款付清全部余额时才进位。

/**
 * BNM table on the last sen digit: 1,2 → down to 0; 3,4 → up to 5; 6,7 → down to 5; 8,9 → up to 10.
 * @param {number} cents amount in integer sen
 * @returns {number} adjustment in sen (−2 … +2)
 */
// 【中文】按国家银行的进位表计算调整额（−2 到 +2 仙）。
export function cashRoundingCents(cents) {
  const lastDigit = ((Math.round(cents) % 10) + 10) % 10;
  if (lastDigit === 1 || lastDigit === 2 || lastDigit === 6 || lastDigit === 7) return -(lastDigit % 5);
  if (lastDigit === 3 || lastDigit === 4 || lastDigit === 8 || lastDigit === 9) return 5 - (lastDigit % 5);
  return 0;
}

/**
 * Work out the rounding for one payment (one or more rows).
 * @param {{ remainingCents: number; rows: Array<{ method: string; amountCents: number }>; rounding?: boolean }} p
 *   rounding: false = the cashier did not ask for rounding (legacy "NONE"); default true.
 * @returns {{ ok: boolean; error: string | null; settles: boolean; totalCents: number; cashCents: number;
 *   nonCashCents: number; adjustmentCents: number; roundedRow: number; amounts: number[]; paidCents: number }}
 *   amounts: each row's amount in sen after rounding (only the rounded cash row changes);
 *   roundedRow: index of the cash row that carries the rounding, −1 when nothing is rounded;
 *   paidCents: what goes on the bill = totalCents + adjustmentCents.
 */
// 【中文】算一次付款的进位：哪一行现金带进位、进位多少、每行最终金额。
export function planCashRounding(p) {
  const rows = Array.isArray(p.rows) ? p.rows : [];
  const amounts = rows.map((r) => Math.round(Number(r.amountCents) || 0));
  const totalCents = amounts.reduce((s, a) => s + a, 0);
  const cashCents = rows.reduce((s, r, i) => s + (r.method === "CASH" ? amounts[i] : 0), 0);
  const nonCashCents = totalCents - cashCents;
  const remaining = Math.round(Number(p.remainingCents) || 0);
  const settles = rows.length > 0 && totalCents === remaining;
  const base = { settles, totalCents, cashCents, nonCashCents, adjustmentCents: 0, roundedRow: -1, amounts, paidCents: totalCents };
  if (totalCents > remaining) {
    return { ...base, ok: false, error: "Payment amount cannot exceed the remaining balance" };
  }
  if (p.rounding === false || !settles || cashCents <= 0) return { ...base, ok: true, error: null };
  const adjustmentCents = cashRoundingCents(cashCents);
  if (adjustmentCents === 0) return { ...base, ok: true, error: null };
  // The largest cash row carries the rounding (the first one when equal), so it never drops to zero
  // unless the whole cash part is only 1–2 sen.
  let roundedRow = -1;
  rows.forEach((r, i) => {
    if (r.method === "CASH" && (roundedRow < 0 || amounts[i] > amounts[roundedRow])) roundedRow = i;
  });
  const next = amounts.slice();
  next[roundedRow] += adjustmentCents;
  if (next[roundedRow] <= 0) {
    return {
      ...base,
      ok: false,
      error: "The cash part rounds to RM 0.00. Take these few sen by card / transfer, or add them to another payment.",
    };
  }
  return { ...base, ok: true, error: null, adjustmentCents, roundedRow, amounts: next, paidCents: totalCents + adjustmentCents };
}
