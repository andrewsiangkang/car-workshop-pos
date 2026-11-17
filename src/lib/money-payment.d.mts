export function cashRoundingCents(cents: number): number;
export type CashRoundingPlan = {
  ok: boolean;
  error: string | null;
  settles: boolean;
  totalCents: number;
  cashCents: number;
  nonCashCents: number;
  adjustmentCents: number;
  roundedRow: number;
  amounts: number[];
  paidCents: number;
};
export function planCashRounding(p: {
  remainingCents: number;
  rows: Array<{ method: string; amountCents: number }>;
  rounding?: boolean;
}): CashRoundingPlan;
