import test from "node:test";
import assert from "node:assert/strict";
import { archiveCheck, archivedWhere, archivedOnInvoice, OPEN_JOB_STATUSES } from "../src/lib/money-inventory.mjs";

test("an item with stock on hand (or parts owed) cannot be archived", () => {
  const r = archiveCheck({ quantityOnHand: 3 }, []);
  assert.equal(r.ok, false);
  assert.equal(r.code, "STOCK_NOT_ZERO");
  assert.match(r.error, /Stock on hand is 3/);
  assert.equal(archiveCheck({ quantityOnHand: -1 }, []).code, "STOCK_NOT_ZERO");
});

test("an item on open quotations cannot be archived; the jobs are named", () => {
  const r = archiveCheck({ quantityOnHand: 0 }, [{ orderNumber: "WO1" }, { orderNumber: "WO2" }, { orderNumber: "WO1" }]);
  assert.equal(r.ok, false);
  assert.equal(r.code, "OPEN_QUOTATIONS");
  assert.match(r.error, /WO1, WO2\./);
  const many = archiveCheck({ quantityOnHand: 0 }, Array.from({ length: 7 }, (_, i) => ({ orderNumber: `WO${i}` })));
  assert.match(many.error, /\(\+2 more\)/);
});

test("zero stock and no open quotation: can be archived (once)", () => {
  assert.deepEqual(archiveCheck({ quantityOnHand: 0.0001 }, []), { ok: true });
  assert.equal(archiveCheck({ quantityOnHand: 0, archivedAt: new Date() }, []).code, "ALREADY_ARCHIVED");
});

test("lists hide archived items unless asked", () => {
  assert.deepEqual(archivedWhere("active"), { archivedAt: null });
  assert.deepEqual(archivedWhere("all"), {});
  assert.deepEqual(archivedWhere("archived"), { archivedAt: { not: null } });
});

test("a job marked Completed but not invoiced yet still blocks archiving (its parts leave stock at invoicing)", () => {
  // The API asks for jobs with a status in OPEN_JOB_STATUSES and no invoice number yet.
  for (const st of ["DRAFT", "QUOTED", "CONFIRMED", "IN_PROGRESS", "COMPLETED"]) assert.ok(OPEN_JOB_STATUSES.includes(st), st);
  assert.ok(!OPEN_JOB_STATUSES.includes("CANCELLED"));
  const uninvoicedCompleted = [{ orderNumber: "WO1", status: "COMPLETED", invoiceNumber: null }];
  const open = uninvoicedCompleted.filter((j) => OPEN_JOB_STATUSES.includes(j.status) && !j.invoiceNumber);
  const r = archiveCheck({ quantityOnHand: 0 }, open);
  assert.equal(r.code, "OPEN_QUOTATIONS");
  assert.match(r.error, /not yet invoiced: WO1\./);
});

test("invoicing a job that uses an archived part waits for the boss to restore it", () => {
  const inventory = [
    { id: "A", name: "Oil filter", archivedAt: new Date() },
    { id: "B", name: "Brake pad", archivedAt: null },
  ];
  const plan = [
    { inventoryItemId: "A", name: "Oil filter", outstanding: 1 },
    { inventoryItemId: "B", name: "Brake pad", outstanding: 2 },
  ];
  assert.match(archivedOnInvoice(plan, inventory), /archived in Inventory: Oil filter\. Ask the boss to restore/);
  // Already taken off stock earlier (nothing outstanding), or not archived: no problem.
  assert.equal(archivedOnInvoice([{ inventoryItemId: "A", name: "Oil filter", outstanding: 0 }], inventory), null);
  assert.equal(archivedOnInvoice([plan[1]], inventory), null);
});
