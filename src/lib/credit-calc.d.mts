export type RefundLimits = {
  ok: boolean;
  error: string | null;
  maxCredit: number;
  minRefund: number;
  maxRefund: number;
  dueAfter: number;
  newCredited: number;
  newPaid: number;
  fullyCredited: boolean;
};
export function amountDueCents(p: {
  totalAmount: number;
  roundingAdjustment?: number | null;
  creditedAmount?: number | null;
  paidAmount?: number | null;
}): number;
export function refundLimits(p: {
  totalAmount: number;
  creditedAmount: number;
  paidAmount: number;
  roundingAdjustment?: number;
  amount: number;
  refundAmount?: number;
}): RefundLimits;

export type CreditMode = "lines" | "split" | "amount";
export type CreditedLine = {
  itemId: string;
  type: "PART" | "LABOR";
  quantity: number;
  total: number; // value of the credited units before discount and SST
  net: number; // after the invoice's discount share
  taxAmount: number;
};
export type CreditNoteCalc =
  | { ok: true; error: null; code: null; amount: number; taxAmount: number; closesInvoice: boolean; lines: CreditedLine[] }
  | { ok: false; error: string; code: string | null };
export function computeCreditNote(p: {
  invoice: {
    totalAmount: number;
    taxAmount: number;
    taxRate: number;
    taxScope: string;
    discount: number;
    items: Array<{ id: string; type: string; quantity: number; total: number }>;
  };
  creditedAmount: number;
  creditedTax: number;
  creditedQty?: Record<string, number>;
  mode: CreditMode;
  lines?: Array<{ itemId: string; quantity: number }>;
  split?: { labor: number; parts: number };
  amount?: number;
}): CreditNoteCalc;

export const MAX_INPUT_AMOUNT: number;
export function isSaneAmount(value: unknown): boolean;
export function splitLeft(p: {
  invoice: {
    totalAmount: number;
    taxAmount: number;
    taxRate: number;
    taxScope: string;
    discount: number;
    items: Array<{ id: string; type: string; quantity: number; total: number }>;
  };
  creditedAmount: number;
  creditedTax: number;
  creditedQty?: Record<string, number>;
}): { labor: number; parts: number };
