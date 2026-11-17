import test from "node:test";
import assert from "node:assert/strict";
import { chargesSst, printVisibility, printableSstNumber } from "../src/lib/doc-print-rules.mjs";

const HIDE_ALL = {
  showShopAddress: false, showShopPhone: false, showShopEmail: false, showTaxIds: false,
  showDocumentNumber: false, showJobNumber: false, showDocumentDate: false,
  showCustomer: false, showVehicle: false,
};

test("only invoices / receipts with SST charged count as SST invoices", () => {
  assert.equal(chargesSst({ type: "invoice", taxAmount: 6.4 }), true);
  assert.equal(chargesSst({ type: "receipt", taxAmount: 0.01 }), true);
  assert.equal(chargesSst({ type: "invoice", taxAmount: 0 }), false);
  assert.equal(chargesSst({ type: "invoice" }), false);
  assert.equal(chargesSst({ type: "quotation", taxAmount: 8 }), false);
});

test("Medium: a template cannot hide the SST number (or customer / address) on an SST invoice", () => {
  for (const type of ["invoice", "receipt"]) {
    const v = printVisibility(HIDE_ALL, { type, taxAmount: 12.5 });
    assert.equal(v.sstInvoice, true);
    assert.equal(v.sstNumber, true);
    assert.equal(v.shopAddress, true);
    assert.equal(v.customer, true);
    assert.equal(v.documentNumber, true);
    assert.equal(v.documentDate, true);
    // Not required on an SST invoice: the boss's choice stands.
    assert.equal(v.taxIds, false);
    assert.equal(v.shopPhone, false);
    assert.equal(v.shopEmail, false);
    assert.equal(v.jobNumber, false);
    assert.equal(v.vehicle, false);
  }
});

test("without SST, and on quotations, the template decides", () => {
  const noSst = printVisibility(HIDE_ALL, { type: "invoice", taxAmount: 0 });
  assert.equal(noSst.sstNumber, false);
  assert.equal(noSst.customer, false);
  assert.equal(noSst.shopAddress, false);
  const quote = printVisibility(HIDE_ALL, { type: "quotation", taxAmount: 8 });
  assert.equal(quote.sstNumber, false);
  assert.equal(quote.customer, false);
});

test("defaults show everything (no settings saved yet)", () => {
  const v = printVisibility(undefined, { type: "invoice", taxAmount: 0 });
  for (const [k, on] of Object.entries(v)) if (k !== "sstInvoice") assert.equal(on, true, k);
});

test("the NA placeholder is never printed as an SST number", () => {
  assert.equal(printableSstNumber("NA"), null);
  assert.equal(printableSstNumber(" na "), null);
  assert.equal(printableSstNumber(""), null);
  assert.equal(printableSstNumber(null), null);
  assert.equal(printableSstNumber(" W10-1808-32000001 "), "W10-1808-32000001");
});
