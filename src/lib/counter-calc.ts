import { money } from "@/lib/tax";

/**
 * Pure counter (cash drawer) maths. No database here, so the browser can use it too.
 *
 * Expected cash in the drawer at close
 *   = opening float
 *   + CASH payments        (amount applied to the bill = cash handed over minus change given back)
 *   - CASH refunds         (refunds are stored as negative payments)
 * Card / Touch 'n Go / bank transfer never enter the drawer, so they are listed
 * separately and are NOT part of the shortage / overage.
 *
 * Variance = counted cash - expected cash.  Negative = SHORT, positive = OVER.
 */

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
  expectedCash: number;
  methods: MethodLine[];
  paymentCount: number;
};

const ORDER = ["CASH", "CARD", "TRANSFER", "TNG", "OTHER"];

export function computeSummary(openingFloat: number, rows: PayRow[]): ShiftSummary {
  let cashReceived = 0;
  let changeGiven = 0;
  let cashSales = 0;
  let cashRefunds = 0;
  const by = new Map<string, MethodLine>();

  for (const r of rows) {
    const method = String(r.method);
    const line = by.get(method) ?? { method, sales: 0, refunds: 0, net: 0, count: 0 };
    line.count += 1;
    if (r.amount >= 0) line.sales += r.amount;
    else line.refunds += -r.amount;
    by.set(method, line);

    if (method === "CASH") {
      if (r.amount >= 0) {
        cashSales += r.amount;
        // Payments taken before this feature have no "received" figure: treat as exact money.
        cashReceived += r.tendered ?? r.amount;
        changeGiven += r.changeGiven ?? 0;
      } else {
        cashRefunds += -r.amount;
      }
    }
  }

  const methods = [...by.values()]
    .map((l) => ({ ...l, sales: money(l.sales), refunds: money(l.refunds), net: money(l.sales - l.refunds) }))
    .sort((a, b) => {
      const ia = ORDER.indexOf(a.method);
      const ib = ORDER.indexOf(b.method);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });

  return {
    openingFloat: money(openingFloat),
    cashReceived: money(cashReceived),
    changeGiven: money(changeGiven),
    cashSales: money(cashSales),
    cashRefunds: money(cashRefunds),
    expectedCash: money(openingFloat + cashSales - cashRefunds),
    methods,
    paymentCount: rows.length,
  };
}

/** counted - expected, to the sen. Negative = shortage, positive = overage. */
export function varianceOf(counted: number, expected: number) {
  return money(counted - expected);
}

export type VarianceKind = "short" | "over" | "balanced";

export function varianceKind(v: number): VarianceKind {
  if (v <= -0.005) return "short";
  if (v >= 0.005) return "over";
  return "balanced";
}

/** Malaysia calendar day (UTC+8) as YYYY-MM-DD, whatever the PC's time zone is. */
export function myDay(d: Date | string) {
  return new Date(new Date(d).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
