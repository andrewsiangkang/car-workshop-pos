import test from "node:test";
import assert from "node:assert/strict";
import {
  computeSummary, varianceOf, varianceKind, depositOf, parseBreakdown, breakdownTotal, breakdownFromInputs,
  estimatePartsCost, collectedTotals, buildClosingSnapshot, readClosingSnapshot, parseReconciled, myDay,
} from "../src/lib/money-counter.mjs";

const day = [
  { amount: 100.05, method: "CASH", tendered: 150, changeGiven: 49.95 },
  { amount: 50, method: "CARD" },
  { amount: 20, method: "CASH" }, // older payment without a "received" figure: exact money
  { amount: -30, method: "CASH" }, // cash refund
  { amount: 80.03, method: "TNG" },
  { amount: -10, method: "CARD" }, // card refund: never touches the drawer
];

test("expected cash = float + cash sales − cash refunds − drawer payouts; non-cash stays out", () => {
  const s = computeSummary(200, day, 45.5);
  assert.equal(s.cashReceived, 170);
  assert.equal(s.changeGiven, 49.95);
  assert.equal(s.cashSales, 120.05);
  assert.equal(s.cashRefunds, 30);
  assert.equal(s.cashPayouts, 45.5);
  assert.equal(s.expectedCash, 244.55); // 200 + 120.05 − 30 − 45.5
  assert.equal(s.paymentCount, 6);
  assert.deepEqual(s.methods.map((m) => m.method), ["CASH", "CARD", "TNG"]);
  const card = s.methods.find((m) => m.method === "CARD");
  assert.deepEqual([card.sales, card.refunds, card.net, card.count], [50, 10, 40, 2]);
});

test("collected totals: all methods net of refunds, and the part never in the drawer", () => {
  const t = collectedTotals(computeSummary(200, day, 0));
  assert.equal(t.totalCollected, 210.08); // 90.05 cash + 40 card + 80.03 TNG
  assert.equal(t.nonCashCollected, 120.03);
});

test("variance: short, over, balanced to the sen", () => {
  assert.equal(varianceOf(240, 244.55), -4.55);
  assert.equal(varianceKind(varianceOf(240, 244.55)), "short");
  assert.equal(varianceKind(varianceOf(250, 244.55)), "over");
  assert.equal(varianceKind(varianceOf(244.55, 244.55)), "balanced");
  assert.equal(varianceKind(0.004), "balanced");
});

test("denomination count: whole sen, unknown notes or fractions refused", () => {
  const b = parseBreakdown({ "100": 2, "50": "1", "0.05": 3, "0.1": "" });
  assert.deepEqual(b, { "100": 2, "50": 1, "0.05": 3 });
  assert.equal(breakdownTotal(b), 250.15);
  assert.equal(breakdownTotal({ "0.1": 3, "0.2": 1 }), 0.5);
  assert.equal(parseBreakdown({ "3": 1 }), null);
  assert.equal(parseBreakdown({ "10": 1.5 }), null);
  assert.equal(parseBreakdown({ "10": -1 }), null);
  assert.equal(parseBreakdown([1, 2]), null);
  assert.deepEqual(breakdownFromInputs({ "20": "4", "5": "x", "1": "0" }), { "20": 4 });
});

test("deposit = counted − float kept (costs are not deducted)", () => {
  assert.equal(depositOf(244.55, 200), 44.55);
  assert.equal(depositOf(150.1, 150.1), 0);
});

test("parts cost estimate is prorated by what was paid in the session", () => {
  assert.equal(
    estimatePartsCost([
      { totalAmount: 200, paidInShift: 100, partsCost: 80 }, // half paid → 40
      { totalAmount: 100, paidInShift: 150, partsCost: 30 }, // capped at all of it → 30
      { totalAmount: 100, paidInShift: -50, partsCost: 30 }, // refund session → nothing
    ]),
    70
  );
});

test("closing snapshot round-trips and freezes the day", () => {
  const summary = computeSummary(200, day, 45.5);
  const snap = buildClosingSnapshot({
    summary,
    drawerPayouts: [{ id: "v1", number: "PV20261114001", payee: "TNB", purpose: "Electricity", amount: 45.5 }],
    otherVouchers: [{ amount: 300 }, { amount: 20.25 }],
    partsCost: 12.345,
    at: new Date("2026-11-14T10:00:00Z"),
  });
  const back = readClosingSnapshot(JSON.stringify(snap));
  assert.ok(back);
  assert.deepEqual(back.summary, summary);
  assert.equal(back.totalCollected, 210.08);
  assert.equal(back.nonCashCollected, 120.03);
  assert.deepEqual(back.drawerPayouts, [{ id: "v1", number: "PV20261114001", payee: "TNB", purpose: "Electricity", amount: 45.5 }]);
  assert.deepEqual(back.otherVouchers, { count: 2, total: 320.25 });
  assert.equal(back.partsCost, 12.35);
  assert.equal(back.at, "2026-11-14T10:00:00.000Z");
  // A voucher voided later does not touch the stored figures: the snapshot is all the report needs.
  assert.equal(back.summary.expectedCash, 244.55);
});

test("a missing or damaged snapshot means 'use live figures' (days closed before v0.3.30)", () => {
  assert.equal(readClosingSnapshot(null), null);
  assert.equal(readClosingSnapshot(""), null);
  assert.equal(readClosingSnapshot("{not json"), null);
  assert.equal(readClosingSnapshot(JSON.stringify({ v: 99, summary: {} })), null);
  const snap = buildClosingSnapshot({ summary: computeSummary(0, [], 0), drawerPayouts: [], otherVouchers: [], partsCost: 0 });
  const broken = { ...snap, summary: { ...snap.summary, expectedCash: "lots" } };
  assert.equal(readClosingSnapshot(JSON.stringify(broken)), null);
});

test("reconciled ticks: only known non-cash methods with who / when", () => {
  assert.deepEqual(parseReconciled('{"CARD":{"by":"Boss","at":"2026-11-14"},"CASH":{"by":"x","at":"y"},"TNG":{"by":1}}'), {
    CARD: { by: "Boss", at: "2026-11-14" },
  });
  assert.deepEqual(parseReconciled("oops"), {});
});

test("counter day follows Malaysia time", () => {
  assert.equal(myDay(new Date("2026-11-13T16:30:00Z")), "2026-11-14"); // 00:30 in KL
  assert.equal(myDay("2026-11-14T15:59:00Z"), "2026-11-14"); // 23:59 in KL
});
