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
 *
 * The arithmetic lives in tax-core.mjs (pure, tested by node --test); this file keeps the
 * typed API the rest of the app imports.
 */

import { roundMoney } from "@/lib/money-core.mjs";
import {
  computeTotals as computeTotalsCore,
  normaliseScope as normaliseScopeCore,
  type TaxScope,
  type TaxLine,
  type Totals,
} from "@/lib/tax-core.mjs";

export type { TaxScope, TaxLine, Totals };

// 【中文】金额四舍五入到分（sen），避免 0.1+0.2 这类小数误差。
export function money(n: number) {
  return roundMoney(Number(n) || 0);
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
  return normaliseScopeCore(s);
}

// 【中文】核心算账函数：先按各行金额比例分摊折扣，再逐行算税并四舍五入，税额 = 各行税额之和；报价预览、保存、打印、LHDN 电子发票都用它，所以数字一致。
export function computeTotals(
  items: TaxLine[],
  discountIn: number,
  rateIn: number,
  scopeIn: TaxScope | string
): Totals {
  return computeTotalsCore(items, discountIn, rateIn, scopeIn);
}
