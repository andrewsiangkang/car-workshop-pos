export function auditShowsPriceEdit(details: string | null | undefined): boolean;
export type PriceDecision = {
  action: "restore" | "keep" | "none";
  current: number;
  to: number | null;
  reason: string;
};
export type PriceRestorePlan = { inventoryItemId: string; name: string; cost: PriceDecision; selling: PriceDecision };
export function planPriceRestore(p: {
  lines: Array<{ inventoryItemId: string | null; unitCost: number; prevCostPrice: number | null; prevSellingPrice: number | null }>;
  items: Array<{ id: string; name: string; costPrice: number; sellingPrice: number }>;
  changedLater?: Iterable<string>;
}): PriceRestorePlan[];
