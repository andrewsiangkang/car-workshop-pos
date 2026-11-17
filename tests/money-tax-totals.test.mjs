import test from "node:test";
import assert from "node:assert/strict";
import { computeTotals, computeTotalsV0329, computeTotalsWithRounding, computeIssuedTotals, normaliseScope } from "../src/lib/tax-core.mjs";
import { toCents } from "../src/lib/money-core.mjs";

const part = (total) => ({ type: "PART", total });
const labour = (total) => ({ type: "LABOR", total });
const sumSen = (xs) => xs.reduce((s, x) => s + toCents(x), 0);

test("scope ALL taxes parts and labour, rounded per line; tax = sum of line taxes", () => {
  const t = computeTotals([part(100), labour(50.5)], 0, 8, "ALL");
  assert.equal(t.partsAmount, 100);
  assert.equal(t.laborAmount, 50.5);
  assert.deepEqual(t.lines.map((l) => l.tax), [8, 4.04]);
  assert.equal(t.taxAmount, 12.04);
  assert.equal(t.totalAmount, 162.54);
  assert.equal(t.taxScope, "ALL");
});

test("scope LABOR taxes only labour lines", () => {
  const t = computeTotals([part(900), labour(100)], 0, 8, "LABOR");
  assert.deepEqual(t.lines.map((l) => l.taxable), [false, true]);
  assert.equal(t.taxAmount, 8);
  assert.equal(t.totalAmount, 1008);
});

test("SST rounds half-up per line (36.25 at 6% = 2.18)", () => {
  const t = computeTotals([part(36.25)], 0, 6, "ALL");
  assert.equal(t.taxAmount, 2.18);
  assert.equal(t.totalAmount, 38.43);
  // two such lines: 2.18 + 2.18 (per line), not 4.35 on the sum
  assert.equal(computeTotals([part(36.25), labour(36.25)], 0, 6, "ALL").taxAmount, 4.36);
});

test("discount is shared by line value, remainder to the largest line, tax on the discounted amount", () => {
  const t = computeTotals([part(100), labour(50), part(50)], 10, 10, "ALL");
  assert.deepEqual(t.lines.map((l) => l.discountShare), [5, 2.5, 2.5]);
  assert.deepEqual(t.lines.map((l) => l.net), [95, 47.5, 47.5]);
  assert.equal(sumSen(t.lines.map((l) => l.discountShare)), toCents(t.discount));
  assert.equal(t.taxAmount, 19);
  assert.equal(t.totalAmount, 209);

  // 10.00 over three equal lines: 3.33 + 3.33 + 3.34 (the sen left goes to the largest = first)
  const odd = computeTotals([part(30), part(30), part(30)], 10, 0, "ALL");
  assert.equal(sumSen(odd.lines.map((l) => l.discountShare)), 1000);
  assert.deepEqual(odd.lines.map((l) => l.discountShare).sort(), [3.33, 3.33, 3.34]);
  assert.equal(odd.totalAmount, 80);
});

test("discount with labour-only SST: tax only on the labour share after discount", () => {
  const t = computeTotals([part(300), labour(100)], 40, 8, "LABOR");
  assert.deepEqual(t.lines.map((l) => l.net), [270, 90]);
  assert.equal(t.taxAmount, 7.2);
  assert.equal(t.totalAmount, 367.2);
});

test("discount is capped at the bill and never negative; rate clamped to 0–100", () => {
  assert.equal(computeTotals([part(50)], 80, 8, "ALL").discount, 50);
  assert.equal(computeTotals([part(50)], 80, 8, "ALL").totalAmount, 0);
  assert.equal(computeTotals([part(50)], -5, 0, "ALL").discount, 0);
  assert.equal(computeTotals([part(50)], 0, 150, "ALL").taxRate, 100);
  assert.equal(computeTotals([part(50)], 0, -3, "ALL").taxAmount, 0);
  assert.equal(computeTotals([], 10, 8, "ALL").totalAmount, 0);
});

test("total = parts + labour − discount + tax, to the sen, on awkward amounts", () => {
  const items = [part(19.99), labour(33.33), part(0.07), labour(12.345)];
  for (const [discount, rate, scope] of [[0, 6, "ALL"], [7.77, 8, "ALL"], [7.77, 8, "LABOR"], [3.01, 10, "LABOR"]]) {
    const t = computeTotals(items, discount, rate, scope);
    assert.equal(toCents(t.totalAmount), toCents(t.partsAmount) + toCents(t.laborAmount) - toCents(t.discount) + toCents(t.taxAmount));
    assert.equal(toCents(t.taxAmount), sumSen(t.lines.map((l) => l.tax)));
  }
});

test("unknown scope counts as ALL", () => {
  assert.equal(normaliseScope("labor"), "ALL");
  assert.equal(normaliseScope("LABOR"), "LABOR");
  assert.equal(normaliseScope(undefined), "ALL");
});

// ---- Invoices issued under v0.3.29 (older rounding) are re-computed the way they were issued ----

test("computeIssuedTotals: the stored SST decides which rounding an issued invoice used", () => {
  // RM 36.25 labour at 6%: v0.3.29 stored SST 2.17 / total 38.42; today's half-up rounding gives 2.18 / 38.43.
  const lines = [labour(36.25)];
  const old = computeIssuedTotals(lines, 0, 6, "LABOR", 2.17);
  assert.equal(old.rounding, "v0329");
  assert.equal(old.taxAmount, 2.17);
  assert.equal(old.totalAmount, 38.42);
  assert.deepEqual(old.lines.map((l) => l.tax), [2.17]);
  // Today's SST, no stored SST, or one neither rounding gives: today's rounding.
  for (const issued of [2.18, undefined, null, 2.5]) {
    const t = computeIssuedTotals(lines, 0, 6, "LABOR", issued);
    assert.equal(t.rounding, "current", String(issued));
    assert.equal(t.taxAmount, 2.18, String(issued));
  }
  // Where both roundings agree (most invoices) nothing changes.
  const plain = computeIssuedTotals([part(100), labour(50.5)], 0, 8, "ALL", 12.04);
  assert.equal(plain.rounding, "current");
  assert.deepEqual({ ...plain, rounding: undefined }, { ...computeTotals([part(100), labour(50.5)], 0, 8, "ALL"), rounding: undefined });
});

test("computeTotalsWithRounding picks the rounding by name", () => {
  const lines = [part(36.25), labour(36.25)];
  assert.deepEqual(computeTotalsWithRounding("v0329", lines, 1, 6, "ALL"), computeTotalsV0329(lines, 1, 6, "ALL"));
  assert.deepEqual(computeTotalsWithRounding("current", lines, 1, 6, "ALL"), computeTotals(lines, 1, 6, "ALL"));
  assert.equal(computeTotalsWithRounding("v0329", [part(36.25)], 0, 6, "ALL").taxAmount, 2.17);
  assert.equal(computeTotalsWithRounding("current", [part(36.25)], 0, 6, "ALL").taxAmount, 2.18);
});
