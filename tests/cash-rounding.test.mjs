import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { refundLimits, amountDueCents } from "../src/lib/credit-calc.mjs";
import { cashRoundingCents, planCashRounding } from "../src/lib/money-payment.mjs";

const schema = fs.readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const upgrade = fs.readFileSync(new URL("../src/lib/schema-upgrade.ts", import.meta.url), "utf8");
const receipt = fs.readFileSync(new URL("../src/components/documents/DocumentLayout.tsx", import.meta.url), "utf8");

test("BNM table: 1,2 → down; 3,4 → up to 5; 6,7 → down to 5; 8,9 → up to 10", () => {
  const want = { 0: 0, 1: -1, 2: -2, 3: 2, 4: 1, 5: 0, 6: -1, 7: -2, 8: 2, 9: 1 };
  for (const [d, adj] of Object.entries(want)) assert.equal(cashRoundingCents(10000 + Number(d)), adj, `last digit ${d}`);
  assert.equal(cashRoundingCents(3), 2);
});

test("cash paying the whole bill is rounded to the nearest 5 sen", () => {
  const p = planCashRounding({ remainingCents: 10003, rows: [{ method: "CASH", amountCents: 10003 }] });
  assert.equal(p.ok, true);
  assert.equal(p.adjustmentCents, 2);
  assert.equal(p.paidCents, 10005);
  assert.deepEqual(p.amounts, [10005]);
  const down = planCashRounding({ remainingCents: 10002, rows: [{ method: "CASH", amountCents: 10002 }] });
  assert.equal(down.adjustmentCents, -2);
  assert.equal(down.paidCents, 10000);
});

test("card, TNG, transfer and other are never rounded", () => {
  for (const method of ["CARD", "TNG", "TRANSFER", "OTHER"]) {
    const p = planCashRounding({ remainingCents: 10003, rows: [{ method, amountCents: 10003 }] });
    assert.equal(p.ok, true);
    assert.equal(p.adjustmentCents, 0, method);
    assert.equal(p.roundedRow, -1);
    assert.equal(p.paidCents, 10003);
  }
});

test("split payment: only the cash part is rounded, whatever the row order", () => {
  // RM100.03 = card 50.00 (first row) + cash 50.03 → cash 50.05, card stays 50.00.
  const p = planCashRounding({
    remainingCents: 10003,
    rows: [{ method: "CARD", amountCents: 5000 }, { method: "CASH", amountCents: 5003 }],
  });
  assert.equal(p.adjustmentCents, 2);
  assert.equal(p.roundedRow, 1);
  assert.deepEqual(p.amounts, [5000, 5005]);
  assert.equal(p.cashCents, 5003);
  assert.equal(p.nonCashCents, 5000);
  // The card part decides nothing: cash 50.00 exactly needs no rounding even though the bill ends in 3.
  const none = planCashRounding({
    remainingCents: 10003,
    rows: [{ method: "TNG", amountCents: 5003 }, { method: "CASH", amountCents: 5000 }],
  });
  assert.equal(none.adjustmentCents, 0);
  assert.deepEqual(none.amounts, [5003, 5000]);
});

test("several cash rows: the cash total is rounded on the largest cash row", () => {
  const p = planCashRounding({
    remainingCents: 3007,
    rows: [{ method: "CASH", amountCents: 1000 }, { method: "CARD", amountCents: 5 }, { method: "CASH", amountCents: 2002 }],
  });
  assert.equal(p.cashCents, 3002);
  assert.equal(p.adjustmentCents, -2);
  assert.equal(p.roundedRow, 2);
  assert.deepEqual(p.amounts, [1000, 5, 2000]);
});

test("rounding is decided only when the payment settles the whole balance", () => {
  const part = planCashRounding({ remainingCents: 10003, rows: [{ method: "CASH", amountCents: 5003 }] });
  assert.equal(part.ok, true);
  assert.equal(part.settles, false);
  assert.equal(part.adjustmentCents, 0);
  const over = planCashRounding({ remainingCents: 10003, rows: [{ method: "CASH", amountCents: 10008 }] });
  assert.equal(over.ok, false);
  const off = planCashRounding({ remainingCents: 10003, rows: [{ method: "CASH", amountCents: 10003 }], rounding: false });
  assert.equal(off.adjustmentCents, 0);
});

test("a cash part of 1–2 sen cannot round to a zero payment", () => {
  const p = planCashRounding({
    remainingCents: 10002,
    rows: [{ method: "CARD", amountCents: 10000 }, { method: "CASH", amountCents: 2 }],
  });
  assert.equal(p.ok, false);
  assert.match(p.error, /RM 0\.00/);
});

test("rounding adjustment persists on work order and prints on receipt", () => {
  assert.match(schema, /roundingAdjustment Float/);
  assert.ok(upgrade.includes('column: "roundingAdjustment"'));
  assert.ok(receipt.includes("Cash Rounding (nearest RM0.05)"));
  assert.ok(receipt.includes("Total Paid after Cash Rounding"));
});

test("credit notes and amount due stay consistent with cash-only rounding", () => {
  // Cash bill 100.02 paid as 100.00 (rounding -0.02): nothing due, fully creditable, refund at most what was paid.
  assert.equal(amountDueCents({ totalAmount: 100.02, roundingAdjustment: -0.02, creditedAmount: 0, paidAmount: 100 }), 0);
  assert.equal(refundLimits({ totalAmount: 100.02, creditedAmount: 0, paidAmount: 100, roundingAdjustment: -0.02, amount: 100.02, refundAmount: 100 }).ok, true);
  assert.equal(refundLimits({ totalAmount: 100.02, creditedAmount: 0, paidAmount: 100, roundingAdjustment: -0.02, amount: 100.02, refundAmount: 100.02 }).ok, false);
  // Same bill paid by card: no rounding on record, the exact 100.02 is paid and can be refunded.
  const card = planCashRounding({ remainingCents: 10002, rows: [{ method: "CARD", amountCents: 10002 }] });
  const rounding = card.adjustmentCents / 100;
  assert.equal(rounding, 0);
  assert.equal(amountDueCents({ totalAmount: 100.02, roundingAdjustment: rounding, creditedAmount: 0, paidAmount: card.paidCents / 100 }), 0);
  assert.equal(refundLimits({ totalAmount: 100.02, creditedAmount: 0, paidAmount: 100.02, roundingAdjustment: rounding, amount: 100.02, refundAmount: 100.02 }).ok, true);
  // Split 100.03 = card 50 + cash 50.03 → rounding +0.02 on record; paid 100.05; a full credit refunds all 100.05.
  const split = planCashRounding({ remainingCents: 10003, rows: [{ method: "CARD", amountCents: 5000 }, { method: "CASH", amountCents: 5003 }] });
  const paid = { totalAmount: 100.03, roundingAdjustment: split.adjustmentCents / 100, creditedAmount: 0, paidAmount: split.paidCents / 100 };
  assert.equal(amountDueCents(paid), 0);
  const r = refundLimits({ ...paid, amount: 100.03, refundAmount: 100.05 });
  assert.equal(r.ok, true, r.error);
  assert.equal(amountDueCents({ ...paid, creditedAmount: r.newCredited, paidAmount: r.newPaid }), 0);
});

test("amount due: a fully credited invoice owes nothing, even with a positive cash rounding on record", () => {
  // RM100.03 paid in cash as 100.05 (rounding +0.02); fully credited with the whole 100.05 refunded.
  const paid = { totalAmount: 100.03, roundingAdjustment: 0.02, creditedAmount: 0, paidAmount: 100.05 };
  assert.equal(amountDueCents(paid), 0);
  const r = refundLimits({ ...paid, amount: 100.03, refundAmount: 100.05 });
  assert.equal(r.ok, true, r.error);
  // after the credit note the route stores creditedAmount and paidAmount; roundingAdjustment stays
  assert.equal(amountDueCents({ ...paid, creditedAmount: r.newCredited, paidAmount: r.newPaid }), 0);
  // the refundLimits rule and the amount-due rule agree
  assert.equal(r.dueAfter, 0);
  // partial credit: still owes total + rounding - credited - paid
  assert.equal(amountDueCents({ totalAmount: 100.03, roundingAdjustment: 0, creditedAmount: 50, paidAmount: 0 }), 5003);
  assert.equal(amountDueCents({ totalAmount: 100.03, roundingAdjustment: 0.02, creditedAmount: 50, paidAmount: 20 }), 3005);
  // never negative
  assert.equal(amountDueCents({ totalAmount: 10, roundingAdjustment: 0, creditedAmount: 0, paidAmount: 20 }), 0);
});
