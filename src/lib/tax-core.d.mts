export type TaxScope = "ALL" | "LABOR";
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
export function normaliseScope(s: unknown): TaxScope;
export function computeTotals(items: TaxLine[], discountIn: number, rateIn: number, scopeIn: TaxScope | string): Totals;
/** computeTotals with the rounding of v0.3.29 and earlier (for invoices issued under it). */
export function computeTotalsV0329(items: TaxLine[], discountIn: number, rateIn: number, scopeIn: TaxScope | string): Totals;
/** Rounding an issued invoice was worked out with: today's, or that of v0.3.29 and earlier. */
export type Rounding = "current" | "v0329";
export function computeTotalsWithRounding(
  rounding: Rounding,
  items: TaxLine[],
  discountIn: number,
  rateIn: number,
  scopeIn: TaxScope | string
): Totals;
/** Totals of an already issued invoice, worked out the way it was issued (issuedTax = SST stored then). */
export function computeIssuedTotals(
  items: TaxLine[],
  discountIn: number,
  rateIn: number,
  scopeIn: TaxScope | string,
  issuedTax: number | null | undefined
): Totals & { rounding: Rounding };
