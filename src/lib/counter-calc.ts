import { money } from "@/lib/tax";

/**
 * Pure counter (cash drawer) maths. No database here, so the browser can use it too.
 *
 * Expected cash in the drawer at close
 *   = opening float
 *   + CASH payments        (amount applied to the bill = cash handed over minus change given back)
 *   - CASH refunds         (refunds are stored as negative payments)
 *   - CASH paid out        (payment vouchers paid from the drawer: suppliers, rent, small purchases)
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
  cashPayouts: number; // vouchers paid in cash out of the drawer
  expectedCash: number;
  methods: MethodLine[];
  paymentCount: number;
};

const ORDER = ["CASH", "CARD", "TRANSFER", "TNG", "OTHER"];

export function computeSummary(openingFloat: number, rows: PayRow[], cashPayouts = 0): ShiftSummary {
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
    cashPayouts: money(cashPayouts),
    expectedCash: money(openingFloat + cashSales - cashRefunds - cashPayouts),
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

/**
 * Notes and coins used for the denomination count (Malaysian ringgit).
 * Keys are the face value as text, so they can be stored as JSON: {"100": 3, "50": 1, ...}
 */
export const DENOMS: Array<{ key: string; value: number; label: string; kind: "note" | "coin" }> = [
  { key: "100", value: 100, label: "RM100", kind: "note" },
  { key: "50", value: 50, label: "RM50", kind: "note" },
  { key: "20", value: 20, label: "RM20", kind: "note" },
  { key: "10", value: 10, label: "RM10", kind: "note" },
  { key: "5", value: 5, label: "RM5", kind: "note" },
  { key: "1", value: 1, label: "RM1", kind: "note" },
  { key: "0.5", value: 0.5, label: "50 sen", kind: "coin" },
  { key: "0.2", value: 0.2, label: "20 sen", kind: "coin" },
  { key: "0.1", value: 0.1, label: "10 sen", kind: "coin" },
  { key: "0.05", value: 0.05, label: "5 sen", kind: "coin" },
];

export type Breakdown = Record<string, number>;

/** Checks an untrusted object: only known face values, whole-number counts. Returns null if it is not valid. */
export function parseBreakdown(v: unknown): Breakdown | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: Breakdown = {};
  for (const d of DENOMS) {
    const raw = (v as Record<string, unknown>)[d.key];
    if (raw === undefined || raw === null || raw === "") continue;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > 1000000) return null;
    if (n > 0) out[d.key] = n;
  }
  for (const k of Object.keys(v as object)) if (!DENOMS.some((d) => d.key === k)) return null;
  return out;
}

/** Total value of a count, in whole sen so there is no floating point drift. */
export function breakdownTotal(b: Breakdown): number {
  let sen = 0;
  for (const d of DENOMS) sen += Math.round(d.value * 100) * (b[d.key] ?? 0);
  return sen / 100;
}

/** Text boxes -> counts (blank or invalid = 0). */
export function breakdownFromInputs(inputs: Record<string, string>): Breakdown {
  const out: Breakdown = {};
  for (const d of DENOMS) {
    const n = parseInt(inputs[d.key] ?? "", 10);
    if (Number.isFinite(n) && n > 0) out[d.key] = n;
  }
  return out;
}

/** Cash to bank in = cash counted - float kept in the drawer for tomorrow. Costs are NOT deducted here. */
export function depositOf(counted: number, floatKept: number) {
  return money(counted - floatKept);
}

/** Payment methods that never enter the drawer and must be checked against the card terminal / TNG / bank. */
export const NON_CASH_METHODS = ["CARD", "TRANSFER", "TNG", "OTHER"];

export type Reconciled = Record<string, { by: string; at: string }>;

/** Reads the stored JSON of ticked methods; anything unexpected = nothing ticked. */
export function parseReconciled(raw: string | null | undefined): Reconciled {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    const out: Reconciled = {};
    for (const m of NON_CASH_METHODS) {
      const e = v?.[m];
      if (e && typeof e.by === "string" && typeof e.at === "string") out[m] = { by: e.by, at: e.at };
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Rough cost of the parts sold in a session: for each job paid during the session, the parts
 * cost (cost price x quantity) times the share of the job that was paid in this session.
 * An ESTIMATE: labour cost, partial payments across days and stock bought later are not tracked.
 */
export function estimatePartsCost(
  jobs: Array<{ totalAmount: number; paidInShift: number; partsCost: number }>
) {
  let cost = 0;
  for (const j of jobs) {
    if (j.totalAmount <= 0 || j.paidInShift <= 0) continue;
    cost += j.partsCost * Math.min(1, j.paidInShift / j.totalAmount);
  }
  return money(cost);
}
