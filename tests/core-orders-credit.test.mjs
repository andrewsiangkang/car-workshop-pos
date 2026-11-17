import test from "node:test";
import assert from "node:assert/strict";
import { refundLimits, computeCreditNote, splitLeft, isSaneAmount, MAX_INPUT_AMOUNT } from "../src/lib/credit-calc.mjs";
import { computeTotals, computeTotalsV0329 } from "../src/lib/tax-core.mjs";
import { creditNoteItemLines } from "../src/lib/einvoice2-ubl.mjs";

// ---- Refund limits after cash rounding (review: total 100.02, rounding -0.02, paid 100.00) ----

const rounded = { totalAmount: 100.02, creditedAmount: 0, paidAmount: 100.0, roundingAdjustment: -0.02 };

test("a bill rounded down at payment can be fully credited and everything paid refunded", () => {
  const r = refundLimits({ ...rounded, amount: 100.02, refundAmount: 100.0 });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.maxCredit, 100.02);
  assert.equal(r.minRefund, 100.0);
  assert.equal(r.maxRefund, 100.0);
  assert.equal(r.newCredited, 100.02);
  assert.equal(r.newPaid, 0);
  assert.equal(r.dueAfter, 0);
});

test("the old rule rejected both refund amounts for that bill", () => {
  // Before: newPaid must be <= total + rounding - newCredited = -0.02, which no refund can reach.
  const oldDue = 100.02 + -0.02 - 100.02;
  assert.ok(100.0 - 100.0 > oldDue + 0.005);
  assert.equal(refundLimits({ ...rounded, amount: 100.02, refundAmount: 100.02 }).error, "Cannot refund more than was paid (RM 100.00)");
  assert.match(refundLimits({ ...rounded, amount: 100.02, refundAmount: 99.99 }).error, /Refund at least RM 100\.00/);
});

test("partial credits on a rounded-down bill still add up", () => {
  const first = refundLimits({ ...rounded, amount: 50.02, refundAmount: 50.02 });
  assert.equal(first.ok, true, first.error);
  assert.equal(first.minRefund, 50.02);
  assert.equal(first.dueAfter, 49.98);
  const second = refundLimits({ totalAmount: 100.02, creditedAmount: 50.02, paidAmount: 49.98, roundingAdjustment: -0.02, amount: 50.0, refundAmount: 49.98 });
  assert.equal(second.ok, true, second.error);
  assert.equal(second.newPaid, 0);
});

test("a bill rounded up at payment refunds the extra sen on a full credit", () => {
  const r = refundLimits({ totalAmount: 100.03, creditedAmount: 0, paidAmount: 100.05, roundingAdjustment: 0.02, amount: 100.03, refundAmount: 100.05 });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.minRefund, 100.05);
  assert.equal(r.maxRefund, 100.05);
});

test("ordinary limits still hold", () => {
  const base = { totalAmount: 100, creditedAmount: 0, paidAmount: 100, roundingAdjustment: 0 };
  assert.equal(refundLimits({ ...base, amount: 30, refundAmount: 30 }).ok, true);
  assert.equal(
    refundLimits({ ...base, amount: 30, refundAmount: 10 }).error,
    "Customer would have paid RM 20.00 too much. Refund at least RM 30.00."
  );
  assert.equal(refundLimits({ ...base, amount: 30, refundAmount: 40 }).error, "Refund cannot be more than the credit amount");
  assert.equal(refundLimits({ ...base, amount: 100.01, refundAmount: 0 }).error, "Maximum that can still be credited is RM 100.00");
  const unpaid = refundLimits({ ...base, paidAmount: 0, amount: 30 });
  assert.equal(unpaid.ok, true);
  assert.equal(unpaid.minRefund, 0);
  assert.equal(unpaid.maxRefund, 0);
});

// ---- Credit-note SST follows the invoice's tax scope (review H8) ----

/** Build an invoice the way generate_invoice does (computeTotals at the invoice's rate / scope). */
function invoice(items, discount, taxRate, taxScope) {
  const t = computeTotals(items, discount, taxRate, taxScope);
  return { items, discount, taxRate, taxScope, totalAmount: t.totalAmount, taxAmount: t.taxAmount };
}

const labourOnly = invoice(
  [
    { id: "L", type: "LABOR", quantity: 1, total: 100 },
    { id: "P", type: "PART", quantity: 1, total: 900 },
  ],
  0, 8, "LABOR"
);

test("labour-only SST: crediting a returned RM900 part credits no SST (pro-rata gave RM7.14)", () => {
  assert.equal(labourOnly.totalAmount, 1008);
  assert.equal(labourOnly.taxAmount, 8);
  const cn = computeCreditNote({ invoice: labourOnly, creditedAmount: 0, creditedTax: 0, mode: "lines", lines: [{ itemId: "P", quantity: 1 }] });
  assert.equal(cn.ok, true, cn.error);
  assert.equal(cn.amount, 900);
  assert.equal(cn.taxAmount, 0);
  assert.equal(cn.lines[0].net, 900);
});

test("labour-only SST: a plain amount must be split (or cover everything left)", () => {
  const plain = computeCreditNote({ invoice: labourOnly, creditedAmount: 0, creditedTax: 0, mode: "amount", amount: 900 });
  assert.equal(plain.ok, false);
  assert.equal(plain.code, "SPLIT_REQUIRED");
  const split = computeCreditNote({ invoice: labourOnly, creditedAmount: 0, creditedTax: 0, mode: "split", split: { labor: 50, parts: 900 } });
  assert.equal(split.ok, true, split.error);
  assert.equal(split.amount, 954);
  assert.equal(split.taxAmount, 4);
  const all = computeCreditNote({ invoice: labourOnly, creditedAmount: 0, creditedTax: 0, mode: "amount", amount: 1008 });
  assert.equal(all.ok, true, all.error);
  assert.equal(all.taxAmount, 8);
});

test("SST on everything: an amount-only credit keeps the pro-rata SST", () => {
  const inv = invoice([{ id: "A", type: "PART", quantity: 1, total: 1000 }], 0, 8, "ALL");
  const cn = computeCreditNote({ invoice: inv, creditedAmount: 0, creditedTax: 0, mode: "amount", amount: 540 });
  assert.equal(cn.ok, true, cn.error);
  assert.equal(cn.taxAmount, 40);
});

test("credited lines carry their share of the invoice discount and the last one closes the invoice", () => {
  const inv = invoice(
    [
      { id: "P", type: "PART", quantity: 1, total: 100 },
      { id: "L", type: "LABOR", quantity: 1, total: 50 },
    ],
    15, 6, "ALL"
  );
  assert.equal(inv.totalAmount, 143.1);
  const first = computeCreditNote({ invoice: inv, creditedAmount: 0, creditedTax: 0, mode: "lines", lines: [{ itemId: "P", quantity: 1 }] });
  assert.equal(first.ok, true, first.error);
  assert.equal(first.amount, 95.4);
  assert.equal(first.taxAmount, 5.4);
  const last = computeCreditNote({
    invoice: inv, creditedAmount: first.amount, creditedTax: first.taxAmount, creditedQty: { P: 1 },
    mode: "lines", lines: [{ itemId: "L", quantity: 1 }],
  });
  assert.equal(last.ok, true, last.error);
  assert.equal(last.amount, 47.7);
  assert.equal(last.taxAmount, 2.7);
  assert.equal(last.closesInvoice, true);
});

test("partial quantities credited one by one add up exactly to the invoice", () => {
  const inv = invoice([{ id: "P", type: "PART", quantity: 3, total: 30 }], 1, 6, "ALL");
  let credited = 0;
  let tax = 0;
  for (let n = 0; n < 3; n++) {
    const cn = computeCreditNote({ invoice: inv, creditedAmount: credited, creditedTax: tax, creditedQty: { P: n }, mode: "lines", lines: [{ itemId: "P", quantity: 1 }] });
    assert.equal(cn.ok, true, cn.error);
    credited = Math.round((credited + cn.amount) * 100) / 100;
    tax = Math.round((tax + cn.taxAmount) * 100) / 100;
  }
  assert.equal(credited, inv.totalAmount);
  assert.equal(tax, inv.taxAmount);
});

test("cannot credit more of a line than is left on it", () => {
  const inv = invoice([{ id: "P", type: "PART", quantity: 2, total: 20 }], 0, 0, "ALL");
  const cn = computeCreditNote({ invoice: inv, creditedAmount: 10, creditedTax: 0, creditedQty: { P: 1 }, mode: "lines", lines: [{ itemId: "P", quantity: 2 }] });
  assert.equal(cn.ok, false);
  assert.equal(cn.error, "Credited quantity is more than what is left on the invoice line");
});

// ---- Split mode never credits more labour / parts than the invoice has (review round 2) ----

test("split: labour above the invoice's labour is refused (was 162 with SST 8, net 154)", () => {
  const cn = computeCreditNote({ invoice: labourOnly, creditedAmount: 0, creditedTax: 0, mode: "split", split: { labor: 150, parts: 0 } });
  assert.equal(cn.ok, false);
  assert.equal(cn.error, "Labour amount is more than the labour still to be credited on this invoice");
  const parts = computeCreditNote({ invoice: labourOnly, creditedAmount: 0, creditedTax: 0, mode: "split", split: { labor: 0, parts: 900.01 } });
  assert.equal(parts.error, "Parts amount is more than the parts still to be credited on this invoice");
});

test("split: labour already credited by an earlier split note (SST used up) is refused", () => {
  const first = computeCreditNote({ invoice: labourOnly, creditedAmount: 0, creditedTax: 0, mode: "split", split: { labor: 100, parts: 0 } });
  assert.equal(first.ok, true, first.error);
  assert.equal(first.amount, 108);
  assert.equal(first.taxAmount, 8);
  const again = computeCreditNote({ invoice: labourOnly, creditedAmount: 108, creditedTax: 8, mode: "split", split: { labor: 100, parts: 0 } });
  assert.equal(again.ok, false);
  // Parts are still fine.
  const parts = computeCreditNote({ invoice: labourOnly, creditedAmount: 108, creditedTax: 8, mode: "split", split: { labor: 0, parts: 900 } });
  assert.equal(parts.ok, true, parts.error);
  assert.equal(parts.amount, 900);
  assert.equal(parts.closesInvoice, true);
});

test("split: labour credited line by line comes off what is left", () => {
  const byLine = computeCreditNote({ invoice: labourOnly, creditedAmount: 108, creditedTax: 8, creditedQty: { L: 1 }, mode: "split", split: { labor: 1, parts: 0 } });
  assert.equal(byLine.ok, false);
  assert.equal(byLine.error, "Labour amount is more than the labour still to be credited on this invoice");
});

test("split: amount minus SST always equals labour + parts typed", () => {
  const cases = [
    { labor: 50, parts: 900 },
    { labor: 33.33, parts: 0 },
    { labor: 0.06, parts: 0.01 },
    { labor: 99.99, parts: 899.99 },
  ];
  for (const s of cases) {
    const cn = computeCreditNote({ invoice: labourOnly, creditedAmount: 0, creditedTax: 0, mode: "split", split: s });
    assert.equal(cn.ok, true, cn.error);
    assert.equal(Math.round((cn.amount - cn.taxAmount) * 100), Math.round((s.labor + s.parts) * 100), JSON.stringify(s));
  }
  // Two labour lines rounded separately: crediting all labour as one figure is not refused.
  const twoLabour = invoice(
    [
      { id: "L1", type: "LABOR", quantity: 1, total: 0.06 },
      { id: "L2", type: "LABOR", quantity: 1, total: 0.06 },
      { id: "P", type: "PART", quantity: 1, total: 10 },
    ],
    0, 8, "LABOR"
  );
  assert.equal(twoLabour.taxAmount, 0); // 0.0048 + 0.0048, each rounds to 0
  const cn = computeCreditNote({ invoice: twoLabour, creditedAmount: 0, creditedTax: 0, mode: "split", split: { labor: 0.12, parts: 0 } });
  assert.equal(cn.ok, true, cn.error);
  assert.equal(cn.taxAmount, 0); // capped at the SST that exists
  assert.equal(cn.amount, 0.12); // and the amount follows, so amount − SST = 0.12
});

test("split: what is left to credit (shown beside the boxes)", () => {
  assert.deepEqual(splitLeft({ invoice: labourOnly, creditedAmount: 0, creditedTax: 0 }), { labor: 100, parts: 900 });
  // After a split note that took all the labour: SST left is 0, so no labour is left.
  assert.deepEqual(splitLeft({ invoice: labourOnly, creditedAmount: 108, creditedTax: 8 }), { labor: 0, parts: 900 });
  // After crediting the part line: parts left 0.
  assert.deepEqual(splitLeft({ invoice: labourOnly, creditedAmount: 900, creditedTax: 0, creditedQty: { P: 1 } }), { labor: 100, parts: 0 });
  // Discount comes off: 10% on 100 labour + 900 parts.
  const disc = invoice(
    [
      { id: "L", type: "LABOR", quantity: 1, total: 100 },
      { id: "P", type: "PART", quantity: 1, total: 900 },
    ],
    100, 8, "LABOR"
  );
  assert.deepEqual(splitLeft({ invoice: disc, creditedAmount: 0, creditedTax: 0 }), { labor: 90, parts: 810 });
});

// ---- A pasted huge number gives an error instead of crashing the page / a 500 ----

test("huge typed amounts are refused, never thrown", () => {
  const huge = "999999999999999";
  assert.equal(isSaneAmount(huge), false);
  assert.equal(isSaneAmount(""), true);
  assert.equal(isSaneAmount(MAX_INPUT_AMOUNT), true);
  assert.equal(isSaneAmount("Infinity"), false);
  const base = { totalAmount: 100, creditedAmount: 0, paidAmount: 100, roundingAdjustment: 0 };
  assert.doesNotThrow(() => refundLimits({ ...base, amount: 10, refundAmount: huge }));
  const r = refundLimits({ ...base, amount: 10, refundAmount: huge });
  assert.equal(r.ok, false);
  assert.equal(r.error, "Amount is too large");
  assert.equal(refundLimits({ ...base, amount: Number(huge), refundAmount: 0 }).error, "Amount is too large");
  for (const p of [
    { mode: "split", split: { labor: huge, parts: 0 } },
    { mode: "split", split: { labor: 0, parts: huge } },
    { mode: "amount", amount: huge },
  ]) {
    const inv = p.mode === "amount" ? invoice([{ id: "A", type: "PART", quantity: 1, total: 100 }], 0, 0, "ALL") : labourOnly;
    let cn;
    assert.doesNotThrow(() => { cn = computeCreditNote({ invoice: inv, creditedAmount: 0, creditedTax: 0, ...p }); });
    assert.equal(cn.ok, false);
    assert.equal(cn.error, "Amount is too large");
  }
  // A huge quantity is simply more than is left on the line.
  const q = computeCreditNote({ invoice: labourOnly, creditedAmount: 0, creditedTax: 0, mode: "lines", lines: [{ itemId: "P", quantity: 1e20 }] });
  assert.equal(q.ok, false);
});

// ---- Invoices issued under v0.3.29 (older rounding) are credited the way they were issued ----

/** An invoice as v0.3.29 issued it: SST and total stored with that version's rounding. */
function invoiceV0329(items, discount, taxRate, taxScope) {
  const t = computeTotalsV0329(items, discount, taxRate, taxScope);
  return { items, discount, taxRate, taxScope, totalAmount: t.totalAmount, taxAmount: t.taxAmount };
}

/** What the credit note's e-Invoice (and its print-out) itemises, or null for one summary row. */
const itemised = (cn, taxRate) =>
  creditNoteItemLines({
    amount: cn.amount,
    taxAmount: cn.taxAmount,
    taxRate,
    lines: cn.lines.map((l) => ({ ...l, description: l.itemId, unitPrice: l.total / l.quantity })),
  });

// RM 36.25 labour at 6%: v0.3.29 stored SST 2.17 / total 38.42; today's half-up rounding gives 2.18 / 38.43.
const oldLabour = invoiceV0329([{ id: "L", type: "LABOR", quantity: 1, total: 36.25 }], 0, 6, "LABOR");

test("v0.3.29 invoice: a full credit by amount, by split or by lines credits exactly its stored total and SST", () => {
  assert.equal(oldLabour.totalAmount, 38.42);
  assert.equal(oldLabour.taxAmount, 2.17);
  assert.equal(computeTotals(oldLabour.items, 0, 6, "LABOR").taxAmount, 2.18); // today's rounding differs
  // Shown beside the split boxes: all of the labour (the SST 2.17 / 6% estimate gave 36.17).
  assert.deepEqual(splitLeft({ invoice: oldLabour, creditedAmount: 0, creditedTax: 0 }), { labor: 36.25, parts: 0 });
  for (const p of [
    { mode: "amount", amount: 38.42 },
    { mode: "split", split: { labor: 36.25, parts: 0 } },
    { mode: "lines", lines: [{ itemId: "L", quantity: 1 }] },
  ]) {
    const cn = computeCreditNote({ invoice: oldLabour, creditedAmount: 0, creditedTax: 0, ...p });
    assert.equal(cn.ok, true, `${p.mode}: ${cn.error}`);
    assert.equal(cn.amount, 38.42, p.mode);
    assert.equal(cn.taxAmount, 2.17, p.mode);
    assert.equal(cn.closesInvoice, true, p.mode);
    // Paid 38.40 after cash rounding: fully credited, everything paid refunded, nothing due.
    const r = refundLimits({ totalAmount: 38.42, creditedAmount: 0, paidAmount: 38.4, roundingAdjustment: -0.02, amount: cn.amount, refundAmount: 38.4 });
    assert.equal(r.ok, true, `${p.mode}: ${r.error}`);
    assert.equal(r.fullyCredited, true, p.mode);
    assert.equal(r.dueAfter, 0, p.mode);
  }
  // By lines: the credited line carries the SST it had on the invoice, so the note is itemised for LHDN.
  const byLines = computeCreditNote({ invoice: oldLabour, creditedAmount: 0, creditedTax: 0, mode: "lines", lines: [{ itemId: "L", quantity: 1 }] });
  assert.deepEqual(byLines.lines.map((l) => [l.net, l.taxAmount]), [[36.25, 2.17]]);
  assert.deepEqual(itemised(byLines, 6)?.[0].parts, [{ base: 36.25, tax: 2.17, rate: 6 }]);
});

test("v0.3.29 invoice: partial line credits use each line's issue-time SST and stay itemised", () => {
  const inv = invoiceV0329(
    [
      { id: "L", type: "LABOR", quantity: 1, total: 36.25 },
      { id: "P", type: "PART", quantity: 2, total: 20 },
    ],
    0, 6, "ALL"
  );
  assert.equal(inv.totalAmount, 59.62);
  assert.equal(inv.taxAmount, 3.37);
  let credited = 0;
  let tax = 0;
  const creditedQty = {};
  const steps = [
    { pick: { itemId: "L", quantity: 1 }, amount: 38.42, taxAmount: 2.17, closes: false }, // today's rounding: 38.43 / 2.18
    { pick: { itemId: "P", quantity: 1 }, amount: 10.6, taxAmount: 0.6, closes: false },
    { pick: { itemId: "P", quantity: 1 }, amount: 10.6, taxAmount: 0.6, closes: true },
  ];
  for (const s of steps) {
    const cn = computeCreditNote({ invoice: inv, creditedAmount: credited, creditedTax: tax, creditedQty: { ...creditedQty }, mode: "lines", lines: [s.pick] });
    assert.equal(cn.ok, true, cn.error);
    assert.equal(cn.amount, s.amount, s.pick.itemId);
    assert.equal(cn.taxAmount, s.taxAmount, s.pick.itemId);
    assert.equal(cn.closesInvoice, s.closes, s.pick.itemId);
    // The rows add up to the note's own net and SST: what creditNoteItemLines checks before LHDN gets them.
    const rows = itemised(cn, 6);
    assert.ok(rows, `${s.pick.itemId} itemised`);
    assert.equal(rows.reduce((sum, r) => sum + Math.round(r.parts[0].tax * 100), 0), Math.round(cn.taxAmount * 100));
    credited = Math.round((credited + cn.amount) * 100) / 100;
    tax = Math.round((tax + cn.taxAmount) * 100) / 100;
    creditedQty[s.pick.itemId] = (creditedQty[s.pick.itemId] || 0) + s.pick.quantity;
  }
  assert.equal(credited, inv.totalAmount);
  assert.equal(tax, inv.taxAmount);
  assert.equal(refundLimits({ totalAmount: inv.totalAmount, creditedAmount: credited, paidAmount: 0, amount: 0.01 }).maxCredit, 0);
});

test("an invoice issued with today's rounding is credited as before", () => {
  const inv = invoice([{ id: "L", type: "LABOR", quantity: 1, total: 36.25 }], 0, 6, "LABOR");
  assert.equal(inv.totalAmount, 38.43);
  assert.equal(inv.taxAmount, 2.18);
  const byLines = computeCreditNote({ invoice: inv, creditedAmount: 0, creditedTax: 0, mode: "lines", lines: [{ itemId: "L", quantity: 1 }] });
  assert.equal(byLines.amount, 38.43);
  assert.equal(byLines.taxAmount, 2.18);
  assert.deepEqual(byLines.lines.map((l) => [l.net, l.taxAmount]), [[36.25, 2.18]]);
  assert.ok(itemised(byLines, 6));
  const split = computeCreditNote({ invoice: inv, creditedAmount: 0, creditedTax: 0, mode: "split", split: { labor: 36.25, parts: 0 } });
  assert.equal(split.amount, 38.43);
  assert.equal(split.taxAmount, 2.18);
  // A partial split keeps today's rounding too.
  const half = invoice([{ id: "L", type: "LABOR", quantity: 2, total: 72.5 }], 0, 6, "LABOR");
  const part = computeCreditNote({ invoice: half, creditedAmount: 0, creditedTax: 0, mode: "split", split: { labor: 36.25, parts: 0 } });
  assert.equal(part.taxAmount, 2.18);
  // Labour 36.24: SST 2.17 rounds down; all of the labour is still shown as left (the estimate gave 36.17).
  const down = invoice([{ id: "L", type: "LABOR", quantity: 1, total: 36.24 }], 0, 6, "LABOR");
  assert.deepEqual(splitLeft({ invoice: down, creditedAmount: 0, creditedTax: 0 }), { labor: 36.24, parts: 0 });
});

// ---- Labour-only SST: what earlier split notes took of each type is not credited again (review round 4) ----

// Pads 120 + oil 80 (parts) + labour 100, SST 8% on labour only: total 308.
const twoParts = invoice(
  [
    { id: "P1", type: "PART", quantity: 1, total: 120 },
    { id: "P2", type: "PART", quantity: 1, total: 80 },
    { id: "L", type: "LABOR", quantity: 1, total: 100 },
  ],
  0, 8, "LABOR"
);
// Brake pads 200 + labour 100, SST 8% on labour only: total 308.
const padsLabour = invoice(
  [
    { id: "P", type: "PART", quantity: 1, total: 200 },
    { id: "L", type: "LABOR", quantity: 1, total: 100 },
  ],
  0, 8, "LABOR"
);

test("split, labour-only SST: parts taken by an earlier split note are not offered or credited again", () => {
  assert.deepEqual([twoParts.totalAmount, twoParts.taxAmount], [308, 8]);
  const first = computeCreditNote({ invoice: twoParts, creditedAmount: 0, creditedTax: 0, mode: "split", split: { labor: 0, parts: 120 } });
  assert.deepEqual([first.amount, first.taxAmount], [120, 0]);
  const after = { invoice: twoParts, creditedAmount: 120, creditedTax: 0 };
  // Only 80 of the parts is left (was shown as 180, and a split of 180 parts was accepted).
  assert.deepEqual(splitLeft(after), { labor: 100, parts: 80 });
  const over = computeCreditNote({ ...after, mode: "split", split: { labor: 0, parts: 180 } });
  assert.equal(over.ok, false);
  assert.equal(over.code, "SPLIT_OVER_LIMIT");
  assert.equal(over.error, "Parts amount is more than the parts still to be credited on this invoice");
  // What is shown as left can be credited, and closes the invoice.
  const rest = computeCreditNote({ ...after, mode: "split", split: { labor: 100, parts: 80 } });
  assert.equal(rest.ok, true, rest.error);
  assert.deepEqual([rest.amount, rest.taxAmount, rest.closesInvoice], [188, 8, true]);

  // Pads 200 credited by split: a second split of parts is refused, the labour is still fine.
  const padsDone = { invoice: padsLabour, creditedAmount: 200, creditedTax: 0 };
  assert.deepEqual(splitLeft(padsDone), { labor: 100, parts: 0 });
  assert.equal(computeCreditNote({ ...padsDone, mode: "split", split: { labor: 0, parts: 100 } }).code, "SPLIT_OVER_LIMIT");
  const labour = computeCreditNote({ ...padsDone, mode: "split", split: { labor: 100, parts: 0 } });
  assert.equal(labour.ok, true, labour.error);
  assert.deepEqual([labour.amount, labour.taxAmount, labour.closesInvoice], [108, 8, true]);
  // ... and so is the labour line by line.
  const byLine = computeCreditNote({ ...padsDone, mode: "lines", lines: [{ itemId: "L", quantity: 1 }] });
  assert.equal(byLine.ok, true, byLine.error);
  assert.deepEqual([byLine.amount, byLine.taxAmount], [108, 8]);
});

test("lines, labour-only SST: a labour line whose labour a split note already credited is refused", () => {
  // All the labour credited by split (108 / SST 8): crediting the labour line again was accepted
  // as 108 with SST 0 while its line said SST 8.
  const labourDone = { invoice: padsLabour, creditedAmount: 108, creditedTax: 8 };
  const again = computeCreditNote({ ...labourDone, mode: "lines", lines: [{ itemId: "L", quantity: 1 }] });
  assert.equal(again.ok, false);
  assert.equal(again.code, "SPLIT_OVER_LIMIT");
  assert.equal(again.error, "Labour amount is more than the labour still to be credited on this invoice");
  // Half the labour by split (54 / SST 4): the whole labour line is more than is left.
  const half = computeCreditNote({ invoice: padsLabour, creditedAmount: 54, creditedTax: 4, mode: "lines", lines: [{ itemId: "L", quantity: 1 }] });
  assert.equal(half.code, "SPLIT_OVER_LIMIT");
  // The pads can still be returned by line, and that closes the invoice.
  const pads = computeCreditNote({ ...labourDone, mode: "lines", lines: [{ itemId: "P", quantity: 1 }] });
  assert.equal(pads.ok, true, pads.error);
  assert.deepEqual([pads.amount, pads.taxAmount, pads.closesInvoice], [200, 0, true]);
});

test("split: crediting the 'left to credit' figures closes the invoice exactly, with all its SST", () => {
  // Two labour lines of 10.07 carry SST 0.81 each (1.62); SST on 20.14 as one figure is 1.61.
  const inv = invoice(
    [
      { id: "P", type: "PART", quantity: 1, total: 200 },
      { id: "L1", type: "LABOR", quantity: 1, total: 10.07 },
      { id: "L2", type: "LABOR", quantity: 1, total: 10.07 },
    ],
    0, 8, "LABOR"
  );
  assert.deepEqual([inv.totalAmount, inv.taxAmount], [221.76, 1.62]);
  const left = splitLeft({ invoice: inv, creditedAmount: 0, creditedTax: 0 });
  assert.deepEqual(left, { labor: 20.14, parts: 200 });
  const cn = computeCreditNote({ invoice: inv, creditedAmount: 0, creditedTax: 0, mode: "split", split: left });
  assert.equal(cn.ok, true, cn.error);
  // Was 221.75 / 1.61, leaving 1 sen of SST that nothing could credit.
  assert.deepEqual([cn.amount, cn.taxAmount, cn.closesInvoice], [221.76, 1.62, true]);
  assert.equal(Math.round((cn.amount - cn.taxAmount) * 100), 22014);
});

test("lines, labour-only SST: a part line whose parts a split note already credited is refused", () => {
  // Split parts 50, then the pads line: was accepted, crediting RM 250 of parts on RM 200.
  const after50 = { invoice: padsLabour, creditedAmount: 50, creditedTax: 0 };
  const pads50 = computeCreditNote({ ...after50, mode: "lines", lines: [{ itemId: "P", quantity: 1 }] });
  assert.equal(pads50.ok, false);
  assert.equal(pads50.code, "SPLIT_OVER_LIMIT");
  assert.equal(pads50.error, "Parts amount is more than the parts still to be credited on this invoice");
  // Split parts 104, then the pads line: refused (the labour line then closed the invoice as 4.00 / SST 8.00).
  const pads104 = computeCreditNote({ invoice: padsLabour, creditedAmount: 104, creditedTax: 0, mode: "lines", lines: [{ itemId: "P", quantity: 1 }] });
  assert.equal(pads104.code, "SPLIT_OVER_LIMIT");
  // No earlier notes: the pads line is fine.
  const pads = computeCreditNote({ invoice: padsLabour, creditedAmount: 0, creditedTax: 0, mode: "lines", lines: [{ itemId: "P", quantity: 1 }] });
  assert.equal(pads.ok, true, pads.error);
  assert.deepEqual([pads.amount, pads.taxAmount, pads.closesInvoice], [200, 0, false]);
  // Split parts 120 on P1 120 + P2 80: P1 by line is refused, P2 is fine.
  const after120 = { invoice: twoParts, creditedAmount: 120, creditedTax: 0 };
  assert.equal(computeCreditNote({ ...after120, mode: "lines", lines: [{ itemId: "P1", quantity: 1 }] }).code, "SPLIT_OVER_LIMIT");
  const p2 = computeCreditNote({ ...after120, mode: "lines", lines: [{ itemId: "P2", quantity: 1 }] });
  assert.equal(p2.ok, true, p2.error);
  assert.deepEqual([p2.amount, p2.taxAmount], [80, 0]);
  // Labour split first, then the pads line: still fine.
  const labourFirst = computeCreditNote({ invoice: padsLabour, creditedAmount: 108, creditedTax: 8, mode: "lines", lines: [{ itemId: "P", quantity: 1 }] });
  assert.equal(labourFirst.ok, true, labourFirst.error);
});

/** Credit one unit of item `id` per note, `n` times; returns the notes. */
function creditUnits(inv, id, n) {
  const notes = [];
  let amount = 0;
  let tax = 0;
  for (let i = 0; i < n; i++) {
    const cn = computeCreditNote({ invoice: inv, creditedAmount: amount, creditedTax: tax, creditedQty: { [id]: i }, mode: "lines", lines: [{ itemId: id, quantity: 1 }] });
    assert.equal(cn.ok, true, `unit ${i + 1}: ${cn.error}`);
    notes.push(cn);
    amount = Math.round((amount + cn.amount) * 100) / 100;
    tax = Math.round((tax + cn.taxAmount) * 100) / 100;
  }
  return { notes, amount, tax };
}

test("lines, labour-only SST: a labour line credited one hour at a time adds up to its SST, last hour not refused", () => {
  const inv = invoice(
    [
      { id: "P", type: "PART", quantity: 1, total: 200 },
      { id: "L", type: "LABOR", quantity: 4, total: 145 },
    ],
    0, 6, "LABOR"
  );
  assert.deepEqual([inv.totalAmount, inv.taxAmount], [353.7, 8.7]);
  const r = creditUnits(inv, "L", 4);
  assert.deepEqual(r.notes.map((n) => [n.amount, n.taxAmount]), [[38.43, 2.18], [38.42, 2.17], [38.43, 2.18], [38.42, 2.17]]);
  assert.deepEqual([r.amount, r.tax], [153.7, 8.7]);
  // Each note's lines match its header, so the e-Invoice stays itemised.
  for (const n of r.notes) assert.notEqual(itemised(n, 6), null);

  // 4 x 20.09 at 6% + pads 50 (SST 4.82): the 4th hour was refused (1.21 > 1.19 + 0.01).
  const inv2 = invoice(
    [
      { id: "L", type: "LABOR", quantity: 4, total: 80.36 },
      { id: "P", type: "PART", quantity: 1, total: 50 },
    ],
    0, 6, "LABOR"
  );
  assert.equal(inv2.taxAmount, 4.82);
  assert.equal(creditUnits(inv2, "L", 4).tax, 4.82);

  // With a discount: pads 200 + 4 x 50 labour, discount 10.
  const inv3 = invoice(
    [
      { id: "P", type: "PART", quantity: 1, total: 200 },
      { id: "L", type: "LABOR", quantity: 4, total: 200 },
    ],
    10, 6, "LABOR"
  );
  const r3 = creditUnits(inv3, "L", 4);
  assert.deepEqual([r3.amount, r3.tax], [206.7, 11.7]);
});
