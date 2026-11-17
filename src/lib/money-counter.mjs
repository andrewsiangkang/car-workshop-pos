// Pure counter (cash drawer) maths, shared by the browser, the server and node tests.
// src/lib/counter-calc.ts re-exports everything here with its types.
//
// Expected cash in the drawer at close
//   = opening float
//   + CASH payments        (amount applied to the bill = cash handed over minus change given back)
//   - CASH refunds         (refunds are stored as negative payments)
//   - CASH paid out        (payment vouchers paid from the drawer: suppliers, rent, small purchases)
// Card / Touch 'n Go / bank transfer never enter the drawer, so they are listed separately and
// are NOT part of the shortage / overage.
// Variance = counted cash - expected cash.  Negative = SHORT, positive = OVER.
// 【中文】收银柜计算（纯函数）：应有现金 = 开柜零钱 + 现金收款 − 现金退款 − 从钱柜付出的凭证；刷卡 / TNG / 转账不进钱柜，不算短款或长款。
import { roundMoney, toCents } from "./money-core.mjs";
import { myDateKey } from "./money-time.mjs";

const money = (n) => roundMoney(Number(n) || 0);
const ORDER = ["CASH", "CARD", "TRANSFER", "TNG", "OTHER"];

/**
 * Cash / non-cash breakdown and expected drawer cash of one counter session.
 * @param {number} openingFloat
 * @param {Array<{ amount: number; method: string; tendered?: number | null; changeGiven?: number | null }>} rows
 * @param {number} [cashPayouts]
 */
export function computeSummary(openingFloat, rows, cashPayouts = 0) {
  let cashReceived = 0;
  let changeGiven = 0;
  let cashSales = 0;
  let cashRefunds = 0;
  const by = new Map();

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
export function varianceOf(counted, expected) {
  return money(counted - expected);
}

export function varianceKind(v) {
  if (v <= -0.005) return "short";
  if (v >= 0.005) return "over";
  return "balanced";
}

/** Malaysia calendar day (UTC+8) as YYYY-MM-DD, whatever the PC's time zone is. */
export function myDay(d) {
  return myDateKey(d);
}

/**
 * Notes and coins used for the denomination count (Malaysian ringgit).
 * Keys are the face value as text, so they can be stored as JSON: {"100": 3, "50": 1, ...}
 */
export const DENOMS = [
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

/** Checks an untrusted object: only known face values, whole-number counts. Returns null if it is not valid. */
export function parseBreakdown(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out = {};
  for (const d of DENOMS) {
    const raw = v[d.key];
    if (raw === undefined || raw === null || raw === "") continue;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > 1000000) return null;
    if (n > 0) out[d.key] = n;
  }
  for (const k of Object.keys(v)) if (!DENOMS.some((d) => d.key === k)) return null;
  return out;
}

/** Total value of a count, in whole sen so there is no floating point drift. */
export function breakdownTotal(b) {
  let sen = 0;
  for (const d of DENOMS) sen += Math.round(d.value * 100) * (b[d.key] ?? 0);
  return sen / 100;
}

/** Text boxes -> counts (blank or invalid = 0). */
export function breakdownFromInputs(inputs) {
  const out = {};
  for (const d of DENOMS) {
    const n = parseInt(inputs[d.key] ?? "", 10);
    if (Number.isFinite(n) && n > 0) out[d.key] = n;
  }
  return out;
}

/** Cash to bank in = cash counted - float kept in the drawer for tomorrow. Costs are NOT deducted here. */
export function depositOf(counted, floatKept) {
  return money(counted - floatKept);
}

/** Payment methods that never enter the drawer and must be checked against the card terminal / TNG / bank. */
export const NON_CASH_METHODS = ["CARD", "TRANSFER", "TNG", "OTHER"];

/** Reads the stored JSON of ticked methods; anything unexpected = nothing ticked. */
export function parseReconciled(raw) {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    const out = {};
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
export function estimatePartsCost(jobs) {
  let cost = 0;
  for (const j of jobs) {
    if (j.totalAmount <= 0 || j.paidInShift <= 0) continue;
    cost += j.partsCost * Math.min(1, j.paidInShift / j.totalAmount);
  }
  return money(cost);
}

/** Total collected (all methods, net of refunds) and the part that never entered the drawer. */
export function collectedTotals(summary) {
  let all = 0;
  let nonCash = 0;
  for (const m of summary.methods) {
    all += toCents(m.net);
    if (m.method !== "CASH") nonCash += toCents(m.net);
  }
  return { totalCollected: all / 100, nonCashCollected: nonCash / 100 };
}

// ---------------------------------------------------------------------------------------------
// Closing snapshot: the settlement as it was when the counter was closed (CashShift.closingSnapshot).
// A voucher voided later, a credit note returning parts, etc. never change a closed day's report.
// 【中文】关柜快照：关柜那一刻的结算数字。之后作废凭证、退款单退回零件等，都不会改变已关柜那一天的报表。

export const SNAPSHOT_VERSION = 1;

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v) => (typeof v === "string" ? v : null);

/**
 * @param {{ summary: ReturnType<typeof computeSummary>;
 *   drawerPayouts: Array<{ id: string; number: string; payee: string; purpose?: string | null; amount: number }>;
 *   otherVouchers: Array<{ amount: number }>;
 *   partsCost: number; at?: Date }} p
 */
// 【中文】生成关柜快照（JSON 可直接保存）。
export function buildClosingSnapshot(p) {
  const totals = collectedTotals(p.summary);
  return {
    v: SNAPSHOT_VERSION,
    at: (p.at instanceof Date ? p.at : new Date()).toISOString(),
    summary: p.summary,
    totalCollected: totals.totalCollected,
    nonCashCollected: totals.nonCashCollected,
    drawerPayouts: p.drawerPayouts.map((v) => ({
      id: String(v.id),
      number: String(v.number),
      payee: String(v.payee),
      purpose: v.purpose ? String(v.purpose) : null,
      amount: money(v.amount),
    })),
    otherVouchers: {
      count: p.otherVouchers.length,
      total: money(p.otherVouchers.reduce((t, v) => t + (Number(v.amount) || 0), 0)),
    },
    partsCost: money(p.partsCost),
  };
}

/**
 * Reads a stored snapshot. Anything missing or malformed = null (the report then falls back to
 * live figures, as for days closed before v0.3.30).
 * @param {string | null | undefined} raw
 */
// 【中文】读取关柜快照；格式不对就返回 null（报表改用实时数字，跟 v0.3.30 之前关柜的日子一样）。
export function readClosingSnapshot(raw) {
  if (!raw) return null;
  let v;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object" || v.v !== SNAPSHOT_VERSION || !v.summary || typeof v.summary !== "object") return null;
  const s = v.summary;
  const keys = ["openingFloat", "cashReceived", "changeGiven", "cashSales", "cashRefunds", "cashPayouts", "expectedCash", "paymentCount"];
  if (keys.some((k) => num(s[k]) === null) || !Array.isArray(s.methods)) return null;
  const methods = [];
  for (const m of s.methods) {
    if (!m || str(m.method) === null || [m.sales, m.refunds, m.net, m.count].some((x) => num(x) === null)) return null;
    methods.push({ method: m.method, sales: m.sales, refunds: m.refunds, net: m.net, count: m.count });
  }
  const payouts = [];
  for (const d of Array.isArray(v.drawerPayouts) ? v.drawerPayouts : []) {
    if (!d || str(d.id) === null || str(d.number) === null || num(d.amount) === null) return null;
    payouts.push({ id: d.id, number: d.number, payee: str(d.payee) ?? "", purpose: str(d.purpose), amount: d.amount });
  }
  const summary = {
    openingFloat: s.openingFloat,
    cashReceived: s.cashReceived,
    changeGiven: s.changeGiven,
    cashSales: s.cashSales,
    cashRefunds: s.cashRefunds,
    cashPayouts: s.cashPayouts,
    expectedCash: s.expectedCash,
    methods,
    paymentCount: s.paymentCount,
  };
  const totals = collectedTotals(summary);
  return {
    v: SNAPSHOT_VERSION,
    at: str(v.at),
    summary,
    totalCollected: totals.totalCollected,
    nonCashCollected: totals.nonCashCollected,
    drawerPayouts: payouts,
    otherVouchers: {
      count: num(v.otherVouchers?.count) ?? 0,
      total: num(v.otherVouchers?.total) ?? 0,
    },
    partsCost: num(v.partsCost) ?? 0,
  };
}
