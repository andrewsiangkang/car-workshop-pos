// SST totals as a pure module (no "@/" imports), so node tests and other pure helpers
// (credit-calc.mjs) use exactly the same arithmetic as src/lib/tax.ts, which re-exports it.
// 【中文】SST 计算的纯函数版本：tax.ts 直接转用它，测试和退款单计算也用同一份，保证数字一致。
import { roundMoney, toCents } from "./money-core.mjs";

const money = (n) => roundMoney(Number(n) || 0);

/**
 * The rounding used up to v0.3.29: a float multiplied by 100 and Math.round. It differs from
 * today's exact half-up rounding on some half-sen values (36.25 × 6% = 2.17 here, 2.18 now).
 * Only used to rebuild the lines of invoices issued under that version (computeTotalsV0329).
 * 【中文】v0.3.29 及以前的四舍五入方法（浮点乘 100 再 Math.round）；只用于按旧版本的算法重算旧发票的明细。
 */
const legacyMoney = (n) => {
  const v = Number(n) || 0;
  if (!Number.isFinite(v)) return 0;
  return Math.round((v + Math.sign(v) * Number.EPSILON) * 100) / 100;
};

/** "LABOR" = only labour lines are taxed; anything else = "ALL". */
export function normaliseScope(s) {
  return s === "LABOR" ? "LABOR" : "ALL";
}

/**
 * Totals of a set of lines: discount shared by line value (remainder to the largest line),
 * then SST per line on the discounted amount, rounded per line; order tax = sum of line taxes.
 * @param {Array<{ type: string; total: number }>} items
 * @param {number} discountIn
 * @param {number} rateIn
 * @param {string} scopeIn
 */
// 【中文】核心算账函数：先按各行金额比例分摊折扣，再逐行算税并四舍五入，税额 = 各行税额之和。
export function computeTotals(items, discountIn, rateIn, scopeIn) {
  return computeTotalsWith(money, items, discountIn, rateIn, scopeIn);
}

/**
 * computeTotals with the rounding of v0.3.29 and earlier. An invoice issued under that version
 * stored the SST of that calculation, so its e-Invoice lines are rebuilt the same way to match
 * the printed invoice to the sen.
 * 【中文】按 v0.3.29 的四舍五入方法算账：旧版本开出的发票，电子发票明细要用同样的方法重算，金额才和打印的发票一致。
 * @param {Array<{ type: string; total: number }>} items
 * @param {number} discountIn
 * @param {number} rateIn
 * @param {string} scopeIn
 */
export function computeTotalsV0329(items, discountIn, rateIn, scopeIn) {
  return computeTotalsWith(legacyMoney, items, discountIn, rateIn, scopeIn);
}

/**
 * computeTotals with a given rounding: "v0329" (computeTotalsV0329) or "current" (computeTotals).
 * Used to work out a part of an issued invoice (a credit note) the same way the invoice was.
 * 【中文】按指定的四舍五入方法算账（"v0329" 旧版本，"current" 现在）：退款单按原发票开票时的方法算。
 * @param {"current" | "v0329"} rounding
 * @param {Array<{ type: string; total: number }>} items
 * @param {number} discountIn
 * @param {number} rateIn
 * @param {string} scopeIn
 */
export function computeTotalsWithRounding(rounding, items, discountIn, rateIn, scopeIn) {
  return rounding === "v0329"
    ? computeTotalsV0329(items, discountIn, rateIn, scopeIn)
    : computeTotals(items, discountIn, rateIn, scopeIn);
}

/**
 * Totals of an invoice that was already issued, worked out the way it was issued. issuedTax is the
 * SST stored on the invoice then: when today's computeTotals does not give it but v0.3.29's rounding
 * does, the invoice was issued under v0.3.29 or earlier and its lines are rebuilt that way, so line
 * taxes add up to the stored SST and the total to the stored total. Otherwise (no stored SST, or one
 * neither rounding gives) today's computeTotals. `rounding` says which was used, so a credit note
 * against the invoice can be worked out the same way (computeTotalsWithRounding).
 * Everything that re-computes an issued invoice from its lines (its e-Invoice, credit notes) uses this.
 * 【中文】已开出发票的金额，按开票时的方法重算：现在的算法得不到存下来的 SST、而 v0.3.29 的算法刚好得到时，就是旧版本开的发票，
 * 用旧方法重算各行，行税额加起来等于存下来的 SST。rounding 记录用了哪一种，退款单也按同一种方法算。
 * @param {Array<{ type: string; total: number }>} items
 * @param {number} discountIn
 * @param {number} rateIn
 * @param {string} scopeIn
 * @param {number | null | undefined} issuedTax
 */
export function computeIssuedTotals(items, discountIn, rateIn, scopeIn, issuedTax) {
  const now = computeTotals(items, discountIn, rateIn, scopeIn);
  const stored = Number(issuedTax);
  if (issuedTax == null || !Number.isFinite(stored) || toCents(now.taxAmount) === toCents(stored)) {
    return { ...now, rounding: "current" };
  }
  const old = computeTotalsV0329(items, discountIn, rateIn, scopeIn);
  return toCents(old.taxAmount) === toCents(stored) ? { ...old, rounding: "v0329" } : { ...now, rounding: "current" };
}

/** @param {(n: number) => number} money */
function computeTotalsWith(money, items, discountIn, rateIn, scopeIn) {
  const taxRate = Math.min(100, Math.max(0, Number(rateIn) || 0));
  const taxScope = normaliseScope(scopeIn);
  const totals = items.map((i) => money(i.total));
  const partsAmount = money(items.reduce((s, i, k) => s + (i.type === "LABOR" ? 0 : totals[k]), 0));
  const laborAmount = money(items.reduce((s, i, k) => s + (i.type === "LABOR" ? totals[k] : 0), 0));
  const gross = money(partsAmount + laborAmount);
  const discount = money(Math.min(gross, Math.max(0, Number(discountIn) || 0)));

  // Share the discount by line value; the rounding remainder goes to the largest line.
  const shares = totals.map((t) => (gross > 0 ? money((discount * t) / gross) : 0));
  const diff = money(discount - shares.reduce((s, x) => s + x, 0));
  if (diff !== 0 && totals.length) {
    const big = totals.indexOf(Math.max(...totals));
    shares[big] = money(shares[big] + diff);
  }

  const lines = items.map((it, k) => {
    const net = money(totals[k] - shares[k]);
    const taxable = taxRate > 0 && (taxScope === "ALL" || it.type === "LABOR");
    return { discountShare: shares[k], net, taxable, tax: taxable ? money((net * taxRate) / 100) : 0 };
  });
  const taxAmount = money(lines.reduce((s, l) => s + l.tax, 0));
  return {
    partsAmount,
    laborAmount,
    discount,
    taxRate,
    taxScope,
    taxAmount,
    totalAmount: money(gross - discount + taxAmount),
    lines,
  };
}
