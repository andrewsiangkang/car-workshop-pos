import test from "node:test";
import assert from "node:assert/strict";
import { planPriceRestore, auditShowsPriceEdit } from "../src/lib/money-stock-prices.mjs";

const item = (over = {}) => ({ id: "I1", name: "Oil filter", costPrice: 12, sellingPrice: 25, ...over });

test("void puts back the cost and selling price the invoice overwrote", () => {
  const [p] = planPriceRestore({
    lines: [{ inventoryItemId: "I1", unitCost: 12, prevCostPrice: 10, prevSellingPrice: 20 }],
    items: [item()],
  });
  assert.equal(p.cost.action, "restore");
  assert.equal(p.cost.to, 10);
  assert.equal(p.selling.action, "restore");
  assert.equal(p.selling.to, 20);
});

test("a selling price the invoice never set is left alone", () => {
  const [p] = planPriceRestore({
    lines: [{ inventoryItemId: "I1", unitCost: 12, prevCostPrice: 10, prevSellingPrice: null }],
    items: [item()],
  });
  assert.equal(p.cost.action, "restore");
  assert.equal(p.selling.action, "none");
  assert.equal(p.selling.reason, "not_changed_by_invoice");
});

test("prices changed by a later invoice or by hand are kept, with the reason", () => {
  const lines = [{ inventoryItemId: "I1", unitCost: 12, prevCostPrice: 10, prevSellingPrice: 20 }];
  const [later] = planPriceRestore({ lines, items: [item()], changedLater: ["I1"] });
  assert.equal(later.cost.action, "keep");
  assert.equal(later.cost.reason, "changed_later");
  assert.equal(later.selling.action, "keep");
  const [since] = planPriceRestore({ lines, items: [item({ costPrice: 13 })] });
  assert.equal(since.cost.action, "keep");
  assert.equal(since.cost.reason, "changed_since");
  assert.equal(since.selling.action, "keep");
});

test("item created by the invoice (or an invoice from before v0.3.30) has nothing to put back", () => {
  const [p] = planPriceRestore({
    lines: [{ inventoryItemId: "I1", unitCost: 12, prevCostPrice: null, prevSellingPrice: null }],
    items: [item()],
  });
  assert.equal(p.cost.action, "none");
  assert.equal(p.selling.action, "none");
});

test("two lines for the same item: back to the price before the first, checked against the last", () => {
  const lines = [
    { inventoryItemId: "I1", unitCost: 11, prevCostPrice: 10, prevSellingPrice: null },
    { inventoryItemId: "I1", unitCost: 12, prevCostPrice: 11, prevSellingPrice: 22 },
    { inventoryItemId: null, unitCost: 30, prevCostPrice: null, prevSellingPrice: null }, // delivery charge
  ];
  const plan = planPriceRestore({ lines, items: [item()] });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].cost.to, 10);
  assert.equal(plan[0].selling.to, 22);
});

test("inventory edit audit entries: which ones changed a price", () => {
  assert.equal(auditShowsPriceEdit(JSON.stringify({ changedFields: ["name"], before: { name: "a" }, after: { name: "b" } })), false);
  assert.equal(auditShowsPriceEdit(JSON.stringify({ before: { sellingPrice: 20 }, after: { sellingPrice: 22 } })), true);
  // Old entries listed every field the form sent: treated as a change to be safe.
  assert.equal(auditShowsPriceEdit(JSON.stringify({ changedFields: ["name", "sellingPrice"] })), true);
  assert.equal(auditShowsPriceEdit(null), false);
  assert.equal(auditShowsPriceEdit('{"changedFields":["costPrice"'), true);
});
