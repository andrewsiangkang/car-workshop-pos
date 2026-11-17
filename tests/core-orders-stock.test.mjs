import test from "node:test";
import assert from "node:assert/strict";
import { planInvoiceStock, returnableQty, neededByItem, roundQty } from "../src/lib/stock-calc.mjs";

const inv = (id, quantityOnHand, name = id) => ({ id, quantityOnHand, name, sku: null });
const part = (inventoryItemId, quantity) => ({ type: "PART", quantity, inventoryItemId });

test("a new job (nothing taken at quote time) takes the full line quantity at invoice", () => {
  const [p] = planInvoiceStock([part("oil", 4)], [], [inv("oil", 10)]);
  assert.equal(p.outstanding, 4);
  assert.equal(p.alreadyTaken, 0);
  assert.equal(p.short, 0);
});

test("an older job that took only part of the stock at quote time takes just the rest", () => {
  // v0.3.28 quote: needed 4, only 1 on hand -> took 1 and wrote "short 3" in a note.
  const moves = [{ inventoryItemId: "pad", quantity: -1 }];
  const [p] = planInvoiceStock([part("pad", 4)], moves, [inv("pad", 6)]);
  assert.equal(p.alreadyTaken, 1);
  assert.equal(p.outstanding, 3);
  assert.equal(p.short, 0);
});

test("an older job that already took everything at quote time takes nothing more", () => {
  const moves = [{ inventoryItemId: "pad", quantity: -2 }];
  const [p] = planInvoiceStock([part("pad", 2)], moves, [inv("pad", 0)]);
  assert.equal(p.outstanding, 0);
  assert.equal(p.short, 0);
});

test("a cancelled-and-returned movement counts as given back", () => {
  const moves = [{ inventoryItemId: "pad", quantity: -2 }, { inventoryItemId: "pad", quantity: 2 }];
  const [p] = planInvoiceStock([part("pad", 2)], moves, [inv("pad", 5)]);
  assert.equal(p.outstanding, 2);
});

test("short stock is reported; negative on-hand means everything is short", () => {
  const [a] = planInvoiceStock([part("belt", 3)], [], [inv("belt", 1)]);
  assert.equal(a.outstanding, 3);
  assert.equal(a.short, 2);
  const [b] = planInvoiceStock([part("belt", 3)], [], [inv("belt", -2)]);
  assert.equal(b.short, 3);
});

test("lines of the same item are added up; labour, unlinked and deleted items are ignored", () => {
  const items = [
    part("oil", 1),
    part("oil", 2.5),
    { type: "LABOR", quantity: 1, inventoryItemId: "oil" },
    { type: "PART", quantity: 7, inventoryItemId: null },
    part("gone", 1),
  ];
  assert.deepEqual([...neededByItem(items)], [["oil", 3.5], ["gone", 1]]);
  const plan = planInvoiceStock(items, [], [inv("oil", 10)]);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].outstanding, 3.5);
});

test("fractional quantities do not drift", () => {
  assert.equal(roundQty(0.1 + 0.2), 0.3);
  const [p] = planInvoiceStock([part("oil", 0.1), part("oil", 0.2)], [], [inv("oil", 0.3)]);
  assert.equal(p.outstanding, 0.3);
  assert.equal(p.short, 0);
});

test("a credit note can only put back what the job still holds", () => {
  const moves = [
    { inventoryItemId: "pad", quantity: -3 },
    { inventoryItemId: "pad", quantity: 1 }, // returned on an earlier credit note
    { inventoryItemId: "oil", quantity: -1 },
  ];
  assert.equal(returnableQty(moves, "pad"), 2);
  assert.equal(returnableQty(moves, "oil"), 1);
  assert.equal(returnableQty(moves, "belt"), 0);
});

test("stock in is always allowed, even while parts are owed (on-hand below zero)", async () => {
  const { stockChangeAllowed } = await import("../src/lib/stock-calc.mjs");
  assert.equal(stockChangeAllowed(-3, 2), true); // partial delivery of owed parts: -3 + 2 = -1
  assert.equal(stockChangeAllowed(-3, 3), true);
  assert.equal(stockChangeAllowed(0, 5), true);
  // Reductions still may not go below zero.
  assert.equal(stockChangeAllowed(2, -3), false);
  assert.equal(stockChangeAllowed(-1, -1), false);
  assert.equal(stockChangeAllowed(0.3, -0.1 - 0.2), true); // float noise is not a shortage
  assert.equal(stockChangeAllowed(5, -5), true);
});
