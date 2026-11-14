import test from "node:test";
import assert from "node:assert/strict";
import { jobProfit, returnedStockCost, sstCollected } from "../src/lib/order-profit.mjs";
import { computeCreditNote, refundLimits } from "../src/lib/credit-calc.mjs";

const part = (id, costPrice, quantity) => ({ id, costPrice, quantity });

test("a part fully credited and put back on the shelf leaves 0 profit, not minus its cost", () => {
  // Part costs 60, sold for 100 (no SST), fully credited with "Return to stock".
  const p = jobProfit({
    totalAmount: 100, creditedAmount: 100, taxAmount: 0,
    items: [part("P", 60, 1)],
    creditNotes: [{ taxAmount: 0, lines: [{ workOrderItemId: "P", returnedToStock: 1 }] }],
  });
  assert.equal(p.partsCost, 60);
  assert.equal(p.returnedCost, 60);
  assert.equal(p.netCost, 0);
  assert.equal(p.grossProfit, 0);
});

test("a credited part NOT returned to stock is still a cost", () => {
  const p = jobProfit({
    totalAmount: 100, creditedAmount: 100, taxAmount: 0,
    items: [part("P", 60, 1)],
    creditNotes: [{ taxAmount: 0, lines: [{ workOrderItemId: "P", returnedToStock: 0 }] }],
  });
  assert.equal(p.grossProfit, -60);
});

test("partial returns, SST and several lines", () => {
  // 3 pads at cost 33.33 sold 50 each + labour 100; SST 8% on all = 20; total 270.
  // Credit 1 pad returned to stock: 54 incl. SST 4.
  const p = jobProfit({
    totalAmount: 270, creditedAmount: 54, taxAmount: 20,
    items: [part("P", 33.33, 3), part("L", 0, 1)],
    creditNotes: [{ taxAmount: 4, lines: [{ workOrderItemId: "P", returnedToStock: 1 }] }],
  });
  assert.equal(p.partsCost, 99.99);
  assert.equal(p.returnedCost, 33.33);
  assert.equal(p.netCost, 66.66);
  // (270 - 54) - (20 - 4) - 66.66 = 133.34
  assert.equal(p.grossProfit, 133.34);
});

test("lines without a job line (or unknown ones) add no returned cost", () => {
  assert.equal(returnedStockCost([part("P", 10, 2)], [{ lines: [{ workOrderItemId: null, returnedToStock: 2 }, { workOrderItemId: "X", returnedToStock: 1 }] }]), 0);
  assert.equal(returnedStockCost([part("P", 10, 2)], [{ lines: [{ workOrderItemId: "P", returnedToStock: 0.5 }] }]), 5);
});

test("no credit notes: same as before (total − SST − cost)", () => {
  const p = jobProfit({ totalAmount: 108, creditedAmount: 0, taxAmount: 8, items: [part("P", 40, 1)], creditNotes: [] });
  assert.equal(p.grossProfit, 60);
});

test("absurd stored cost prices do not crash the page", () => {
  assert.doesNotThrow(() => jobProfit({ totalAmount: 1, creditedAmount: 0, taxAmount: 0, items: [part("P", 1e15, 100)], creditNotes: [] }));
});

test("SST collected uses the SST each credit note really credited (labour-only SST)", () => {
  // Labour-only SST 8%: labour 100 + part 900 (cost 600) = 1008, SST 8, fully paid.
  const invoice = {
    totalAmount: 1008, taxAmount: 8, taxRate: 8, taxScope: "LABOR", discount: 0,
    items: [{ id: "L", type: "LABOR", quantity: 1, total: 100 }, { id: "P", type: "PART", quantity: 1, total: 900 }],
  };
  const cn = computeCreditNote({ invoice, creditedAmount: 0, creditedTax: 0, mode: "lines", lines: [{ itemId: "P", quantity: 1 }] });
  assert.equal(cn.ok, true);
  assert.equal(cn.amount, 900);
  assert.equal(cn.taxAmount, 0);
  const lim = refundLimits({ totalAmount: 1008, creditedAmount: 0, paidAmount: 1008, amount: cn.amount, refundAmount: 900 });
  assert.equal(lim.ok, true, lim.error);
  const o = {
    totalAmount: 1008, creditedAmount: lim.newCredited, taxAmount: 8, paidAmount: lim.newPaid,
    items: [part("L", 0, 1), part("P", 600, 1)],
    creditNotes: [{ taxAmount: cn.taxAmount, lines: [{ workOrderItemId: "P", returnedToStock: 1 }] }],
  };
  // All 8 SST is still owed to Customs (the old pro-rata guess gave 0.86).
  assert.equal(sstCollected(o), 8);
  // Reports' gross profit = paid − SST − net cost agrees with the job page's jobProfit.
  const reportsGross = o.paidAmount - sstCollected(o) - (600 - returnedStockCost(o.items, o.creditNotes));
  assert.equal(Math.round(reportsGross * 100) / 100, jobProfit(o).grossProfit);
  assert.equal(jobProfit(o).grossProfit, 100);
});

test("SST collected: part payment is pro-rata, nothing when fully credited", () => {
  const base = { totalAmount: 108, creditedAmount: 0, taxAmount: 8, creditNotes: [] };
  assert.equal(sstCollected({ ...base, paidAmount: 108 }), 8);
  assert.equal(sstCollected({ ...base, paidAmount: 54 }), 4);
  assert.equal(sstCollected({ ...base, paidAmount: 200 }), 8);
  assert.equal(sstCollected({ ...base, creditedAmount: 108, paidAmount: 0, creditNotes: [{ taxAmount: 8 }] }), 0);
  // scope ALL: a pro-rata credit note leaves the matching share of SST
  assert.equal(sstCollected({ totalAmount: 216, creditedAmount: 54, taxAmount: 16, paidAmount: 162, creditNotes: [{ taxAmount: 4 }] }), 12);
});
