export type PayRow = {
  amount: number;
  method: string;
  tendered?: number | null;
  changeGiven?: number | null;
};
export type MethodLine = { method: string; sales: number; refunds: number; net: number; count: number };
export type ShiftSummary = {
  openingFloat: number;
  cashReceived: number; // handed over by customers
  changeGiven: number; // given back to customers
  cashSales: number; // received - change (what actually stays in the drawer)
  cashRefunds: number; // paid out to customers
  cashPayouts: number; // vouchers paid in cash out of the drawer
  expectedCash: number;
  methods: MethodLine[];
  paymentCount: number;
};
export type VarianceKind = "short" | "over" | "balanced";
export type Breakdown = Record<string, number>;
export type Reconciled = Record<string, { by: string; at: string }>;
export type Denom = { key: string; value: number; label: string; kind: "note" | "coin" };

export function computeSummary(openingFloat: number, rows: PayRow[], cashPayouts?: number): ShiftSummary;
export function varianceOf(counted: number, expected: number): number;
export function varianceKind(v: number): VarianceKind;
export function myDay(d: Date | string): string;
export const DENOMS: Denom[];
export function parseBreakdown(v: unknown): Breakdown | null;
export function breakdownTotal(b: Breakdown): number;
export function breakdownFromInputs(inputs: Record<string, string>): Breakdown;
export function depositOf(counted: number, floatKept: number): number;
export const NON_CASH_METHODS: string[];
export function parseReconciled(raw: string | null | undefined): Reconciled;
export function estimatePartsCost(jobs: Array<{ totalAmount: number; paidInShift: number; partsCost: number }>): number;
export function collectedTotals(summary: ShiftSummary): { totalCollected: number; nonCashCollected: number };

export const SNAPSHOT_VERSION: number;
export type SnapshotPayout = { id: string; number: string; payee: string; purpose: string | null; amount: number };
export type ClosingSnapshot = {
  v: number;
  at: string | null;
  summary: ShiftSummary;
  totalCollected: number;
  nonCashCollected: number;
  drawerPayouts: SnapshotPayout[];
  otherVouchers: { count: number; total: number };
  partsCost: number;
};
export function buildClosingSnapshot(p: {
  summary: ShiftSummary;
  drawerPayouts: Array<{ id: string; number: string; payee: string; purpose?: string | null; amount: number }>;
  otherVouchers: Array<{ amount: number }>;
  partsCost: number;
  at?: Date;
}): ClosingSnapshot;
export function readClosingSnapshot(raw: string | null | undefined): ClosingSnapshot | null;
