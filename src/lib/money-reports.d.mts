export type ReportCreditNote = {
  amount: number;
  taxAmount: number;
  createdAt: Date | string;
  /** Credited lines: `type` ("PART" / "LABOR") and `total` (before discount and SST) feed the revenue mix. */
  lines?: Array<{
    workOrderItemId?: string | null;
    returnedToStock?: number | null;
    type?: string | null;
    quantity?: number | null;
    total?: number | null;
  }>;
};
export type ReportJob = {
  id: string;
  totalAmount: number;
  taxAmount: number;
  roundingAdjustment?: number | null;
  partsAmount?: number;
  laborAmount?: number;
  /** Invoice discount (RM): a split credit note's labour and parts are after it, partsAmount / laborAmount before it. */
  discount?: number | null;
  /** SST % and scope ("ALL" / "LABOR") as issued: tells a split credit note's labour from its parts. */
  taxRate?: number | null;
  taxScope?: string | null;
  items: Array<{ id: string; costPrice: number; quantity: number; type?: string | null }>;
  /** Every credit note of the job (not only the period's). */
  creditNotes: ReportCreditNote[];
  /** Every payment of the job (not only the period's); refunds are negative. */
  payments: Array<{ amount: number; paidAt: Date | string }>;
};
export function jobPeriodSen(
  o: Omit<ReportJob, "id">,
  inPeriod: (at: Date) => boolean
): {
  collected: number;
  received: number;
  refunds: number;
  sst: number;
  partsCost: number;
  partsSales: number;
  laborSales: number;
  payments: number;
  events: number;
};
export type PeriodTotals = {
  collections: number;
  received: number;
  refunds: number;
  sst: number;
  partsCost: number;
  partsSales: number;
  laborSales: number;
  grossProfit: number;
  paidJobs: number;
  perJob: Array<{ id: string; collected: number }>;
};
export function periodTotals(jobs: ReportJob[], inPeriod: (paidAt: Date) => boolean): PeriodTotals;
/**
 * Parts and labour (sen, before discount) that a credit note without lines takes off an invoice
 * with SST on labour only (split note or the whole remainder), told apart by its SST and capped at
 * what is left of each type. Shared by the revenue mix and Top Selling.
 */
export function splitMixSen(
  cn: { taxAmount?: number | null },
  creditC: number,
  job: { partsC: number; laborC: number; discountC?: number; taxRate: number; laborLines?: number },
  leftPartsC: number,
  leftLaborC: number,
  /** SST still on the bill before this note (sen); left out, the note is taken to close it. */
  taxLeftC?: number
): { parts: number; labor: number };
export type ItemSalesJob = {
  id: string;
  totalAmount: number;
  taxAmount: number;
  roundingAdjustment?: number | null;
  /** SST % and scope as issued, and the invoice discount (RM): with SST on labour only, a credit note without lines is told apart into labour and parts by its SST. */
  taxRate?: number | null;
  taxScope?: string | null;
  discount?: number | null;
  items: Array<{ id: string; description: string; quantity: number; total: number; type?: string | null }>;
  creditNotes: Array<{
    amount: number;
    taxAmount: number;
    lines?: Array<{ workOrderItemId?: string | null; quantity?: number | null; total?: number | null }>;
  }>;
};
/** Top selling work items of a period (RM), keyed by item description. */
export function itemSales(
  jobs: ItemSalesJob[],
  perJob: Array<{ id: string; collected: number }>
): Map<string, { quantity: number; sales: number }>;
export function operatingExpenses(p: {
  expenses: Array<{ amount: number; voidedAt?: Date | string | null }>;
  vouchers: Array<{ amount: number; voidedAt?: Date | string | null; supplierInvoiceId?: string | null }>;
  supplierCharges?: Array<{ total: number }>;
  /** Tax on supplier invoices dated in the period (a cost the workshop cannot claim back). */
  supplierTax?: Array<{ taxAmount: number; voidedAt?: Date | string | null }>;
}): { expenses: number; vouchers: number; supplierCharges: number; supplierTax: number; total: number };
