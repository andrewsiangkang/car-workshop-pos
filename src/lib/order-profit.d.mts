export type ProfitCreditNote = {
  taxAmount: number;
  lines?: Array<{ workOrderItemId?: string | null; returnedToStock?: number | null }>;
};
export function returnedStockCost(
  items: Array<{ id: string; costPrice: number }>,
  creditNotes: Array<{ lines?: Array<{ workOrderItemId?: string | null; returnedToStock?: number | null }> }>
): number;
export function jobProfit(o: {
  totalAmount: number;
  creditedAmount: number;
  taxAmount: number;
  items: Array<{ id: string; costPrice: number; quantity: number }>;
  creditNotes: ProfitCreditNote[];
}): { partsCost: number; returnedCost: number; netCost: number; grossProfit: number };
export function sstCollected(o: {
  totalAmount: number;
  creditedAmount: number;
  taxAmount: number;
  paidAmount: number;
  creditNotes: Array<{ taxAmount: number }>;
}): number;
