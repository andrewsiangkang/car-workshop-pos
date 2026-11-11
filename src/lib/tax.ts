/**
 * SST (Service Tax) calculation, shared by server and browser so the quote preview,
 * saved totals, printed documents and LHDN e-Invoice always agree to the sen.
 *
 * Rules used:
 *  - Prices are entered EXCLUDING tax.
 *  - Tax is charged only when the shop has an SST registration number and a rate > 0.
 *  - The discount is shared across lines in proportion to their value, then tax is
 *    worked out per line on the discounted amount and rounded per line. The order's
 *    tax is the sum of the line taxes (this matches how MyInvois checks totals).
 *  - Scope "ALL": parts and labour taxed. "LABOR": labour lines only.
 * Confirm the correct rate and scope for the shop with JKDM / the tax agent.
 */

export type TaxScope = "ALL" | "LABOR";

// 【中文】金额四舍五入到分（sen），避免 0.1+0.2 这类小数误差。
export function money(n: number) {
  return Math.round((Number(n) || 0) * 100 + Number.EPSILON) / 100;
}

// 【中文】店铺是否已登记 SST：必须填了 SST 号码（不是 NA）且税率大于 0 才收税。
export function sstActive(shop: { sstNumber?: string | null; sstRate?: number | null } | null | undefined) {
  const no = (shop?.sstNumber || "").trim().toUpperCase();
  return !!no && no !== "NA" && no !== "N/A" && (Number(shop?.sstRate) || 0) > 0;
}

/** Rate that applies for this shop right now (0 when not SST-registered). */
// 【中文】当前实际生效的税率（未登记 SST 则为 0）。
export function effectiveRate(shop: { sstNumber?: string | null; sstRate?: number | null } | null | undefined) {
  return sstActive(shop) ? Math.min(100, Math.max(0, Number(shop!.sstRate) || 0)) : 0;
}

export function normaliseScope(s: unknown): TaxScope {
  return s === "LABOR" ? "LABOR" : "ALL";
}

export type TaxLine = { type: string; total: number };

export type Totals = {
  partsAmount: number;
  laborAmount: number;
  discount: number;
  taxRate: number;
  taxScope: TaxScope;
  taxAmount: number;
  totalAmount: number;
  lines: Array<{ discountShare: number; net: number; taxable: boolean; tax: number }>;
};

// 【中文】核心算账函数：先按各行金额比例分摊折扣，再逐行算税并四舍五入，税额 = 各行税额之和；报价预览、保存、打印、LHDN 电子发票都用它，所以数字一致。
export function computeTotals(
  items: TaxLine[],
  discountIn: number,
  rateIn: number,
  scopeIn: TaxScope | string
): Totals {
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
