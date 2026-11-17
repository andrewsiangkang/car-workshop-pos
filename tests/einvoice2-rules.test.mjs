// Step 14, e-Invoice lane: refund notes (type 04), the optional TIN for Malaysian individuals,
// waiting buyer requests (H4) and the shared e-Invoice state rules.
import test from "node:test";
import assert from "node:assert/strict";
import {
  BUYER_REQUEST_ALERT_DAYS,
  buyerRequestWaiting,
  checkBuyerFields,
  checkStaffBuyerIdentity,
  creditNoteDocType,
} from "../src/lib/einvoice-rules.mjs";
import { buildInvoiceSnapshot, creditNoteBuyer, invoiceBuyer, parseDocSnapshot } from "../src/lib/doc-snapshot.mjs";
import { buyerParty } from "../src/lib/einvoice2-ids.mjs";
import { buyerProblem } from "../src/lib/einvoice2-ubl.mjs";
import { isFinalStatus, isLiveEInvoice, isNettedInConsolidation } from "../src/lib/einvoice-state.mjs";

// ---------------------------------------------------------------------------
// Credit note (02) / refund note (04)
// ---------------------------------------------------------------------------

test("no refund → credit note 02; full refund → refund note 04", () => {
  assert.deepEqual(creditNoteDocType({ amount: 120, refundAmount: 0 }), { ok: true, type: "02" });
  assert.deepEqual(creditNoteDocType({ amount: 120, refundAmount: null }), { ok: true, type: "02" });
  assert.deepEqual(creditNoteDocType({ amount: 120, refundAmount: 120 }), { ok: true, type: "04" });
});

test("a partial refund cannot be sent as either type", () => {
  assert.deepEqual(creditNoteDocType({ amount: 120, refundAmount: 50 }), { ok: false, reason: "partial_refund" });
  assert.deepEqual(creditNoteDocType({ amount: 120, refundAmount: 119.99 }), { ok: false, reason: "partial_refund" });
});

test("a full refund of a cash-rounded invoice (100.02 paid as 100.00) is a refund note", () => {
  assert.deepEqual(creditNoteDocType({ amount: 100.02, refundAmount: 100, roundingAdjustment: -0.02 }), { ok: true, type: "04" });
  // Rounding never excuses more than it took off.
  assert.equal(creditNoteDocType({ amount: 100.03, refundAmount: 100, roundingAdjustment: -0.02 }).ok, false);
  // A rounding up (customer paid 0.02 more) does not turn a short refund into a full one.
  assert.equal(creditNoteDocType({ amount: 100, refundAmount: 99.98, roundingAdjustment: 0.02 }).ok, false);
});

// ---------------------------------------------------------------------------
// TIN optional for a Malaysian individual (decision 5)
// ---------------------------------------------------------------------------

const form = {
  name: "Tan Ah Kow", tin: "", idType: "NRIC", idNo: "900101-14-5678", phone: "012-345 6789",
  address: "No. 1, Jalan Satu", postcode: "50000", city: "Kuala Lumpur", stateCode: "14", consent: true,
};

test("QR form: an IC holder may leave the TIN blank", () => {
  const r = checkBuyerFields(form);
  assert.equal(r.ok, true);
  assert.equal(r.value.tin, "");
  assert.equal(r.value.idNo, "900101145678");
});

test("QR form: a company, passport or army ID still needs a TIN", () => {
  assert.deepEqual(checkBuyerFields({ ...form, idType: "BRN", idNo: "202001012345" }).errors, { tin: "required" });
  assert.deepEqual(checkBuyerFields({ ...form, idType: "PASSPORT", idNo: "A12345678" }).errors, { tin: "required" });
  // A TIN that is typed must still look like one.
  assert.deepEqual(checkBuyerFields({ ...form, tin: "x" }).errors, { tin: "invalid" });
});

test("QR form: an IC that is not a real MyKad, or an IC typed as BRN, is refused", () => {
  assert.deepEqual(checkBuyerFields({ ...form, idNo: "123456789012" }).errors, { idNo: "invalid" });
  assert.deepEqual(checkBuyerFields({ ...form, tin: "C12345678901", idType: "BRN", idNo: "900101145678" }).errors, { idNo: "invalid" });
});

test("staff buyer form follows the same rule and says which field is wrong", () => {
  assert.deepEqual(checkStaffBuyerIdentity({ name: "Tan Ah Kow", tin: "", idType: "NRIC", idNo: "900101-14-5678" }), {
    ok: true, value: { name: "Tan Ah Kow", tin: "", idType: "NRIC", idNo: "900101145678" },
  });
  const company = checkStaffBuyerIdentity({ name: "Maju Sdn Bhd", tin: "", idType: "BRN", idNo: "202001012345" });
  assert.equal(company.ok, false);
  assert.equal(company.field, "tin");
  const badIc = checkStaffBuyerIdentity({ name: "Tan", tin: "", idType: "NRIC", idNo: "123" });
  assert.equal(badIc.field, "idNo");
  assert.equal(checkStaffBuyerIdentity({ name: "T", tin: "IG12345678901", idType: "NRIC", idNo: "900101145678" }).field, "name");
  assert.equal(checkStaffBuyerIdentity({ name: "Tan", idType: "LICENCE", idNo: "A1234567" }).field, "idType");
});

test("an all-zero TIN counts as no TIN on both forms, so the print and LHDN name the same buyer", () => {
  // IC holder typing "000000": stored blank (LHDN's general TIN is printed and sent with the IC).
  const ic = checkBuyerFields({ ...form, tin: "000000" });
  assert.equal(ic.ok, true);
  assert.equal(ic.value.tin, "");
  assert.deepEqual(checkStaffBuyerIdentity({ name: "Tan Ah Kow", tin: "0000 0000", idType: "NRIC", idNo: "900101145678" }), {
    ok: true, value: { name: "Tan Ah Kow", tin: "", idType: "NRIC", idNo: "900101145678" },
  });
  // A company with "000000" is refused at once (it used to pass here and fail only at Submit).
  assert.deepEqual(checkBuyerFields({ ...form, tin: "000000", idType: "BRN", idNo: "202001012345" }).errors, { tin: "required" });
  const company = checkStaffBuyerIdentity({ name: "Maju Sdn Bhd", tin: "000000", idType: "BRN", idNo: "202001012345" });
  assert.equal(company.ok, false);
  assert.equal(company.field, "tin");
  // A real TIN that merely contains zeros is kept.
  assert.equal(checkStaffBuyerIdentity({ name: "Maju Sdn Bhd", tin: "C20000000010", idType: "BRN", idNo: "202001012345" }).ok, true);
});

const issuedFor = (order) =>
  JSON.stringify(buildInvoiceSnapshot({
    shop: { name: "Ah Seng Auto", sstNumber: "W10-1808-32000001" },
    order,
    customer: { name: "Walk-in Ali", phone: "012-999 0000", tin: null },
    vehicle: { plateNumber: "WXY1234" },
    at: "2026-11-01T02:00:00Z",
  }));

test("an IC-only buyer is printed and sent to LHDN the same way (general TIN + IC)", () => {
  const order = {
    buyerRequestedAt: new Date("2026-11-02T03:00:00Z"), buyerName: "Tan Ah Kow", buyerTin: null,
    buyerIdType: "NRIC", buyerIdNo: "900101145678", buyerPhone: "+60123456789",
    buyerAddress: "No. 1, Jalan Satu", buyerPostcode: "50000", buyerCity: "Kuala Lumpur", buyerStateCode: "14",
  };
  const withSnap = { ...order, docSnapshot: issuedFor(order) };
  const b = invoiceBuyer({ order: withSnap, customer: { name: "Walk-in Ali", phone: "012-999 0000", tin: null } });
  // It used to fall back to the walk-in, on paper AND to LHDN, because the TIN was blank.
  assert.equal(b.name, "Tan Ah Kow");
  assert.equal(b.tin, "EI00000000010");
  assert.equal(b.source, "buyer_request");
  // The frozen print shows the same name and TIN (no IC number in the snapshot: PDPA).
  const snap = parseDocSnapshot(withSnap.docSnapshot);
  assert.equal(snap.buyer.name, "Tan Ah Kow");
  assert.equal(snap.buyer.tin, "EI00000000010");
  assert.equal(JSON.stringify(snap).includes("900101145678"), false);
  // LHDN gets the general TIN with the MyKad number, and the buyer passes the checks.
  assert.deepEqual(buyerParty(b), { ok: true, kind: "individual_no_tin", tin: "EI00000000010", idScheme: "NRIC", idValue: "900101145678" });
  assert.equal(buyerProblem(b), null);
  // A credit note against this invoice names the same buyer.
  assert.equal(creditNoteBuyer({ order: withSnap, customer: null, via: "invoice" }).tin, "EI00000000010");
  // A company request without a TIN is still not used (LHDN needs it): an invoice without a
  // snapshot then names the customer record.
  assert.equal(invoiceBuyer({ order: { ...order, buyerIdType: "BRN", buyerIdNo: "202001012345" }, customer: { name: "Walk-in Ali" } }).name, "Walk-in Ali");
});

// ---------------------------------------------------------------------------
// Buyer requests waiting more than 3 days (H4)
// ---------------------------------------------------------------------------

test("a buyer request waiting more than 3 days without an e-Invoice is flagged", () => {
  const now = new Date("2026-11-14T06:00:00Z");
  const days = (n) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
  const o = { buyerRequestedAt: days(4), invoiceNumber: "INV20261110001", status: "COMPLETED", reported: false, consolidated: false };
  assert.equal(BUYER_REQUEST_ALERT_DAYS, 3);
  assert.equal(buyerRequestWaiting(o, now), true);
  assert.equal(buyerRequestWaiting({ ...o, buyerRequestedAt: days(2) }, now), false);
  assert.equal(buyerRequestWaiting({ ...o, reported: true }, now), false); // e-Invoice issued
  assert.equal(buyerRequestWaiting({ ...o, consolidated: true }, now), false); // in a real consolidated one
  assert.equal(buyerRequestWaiting({ ...o, status: "CANCELLED" }, now), false);
  assert.equal(buyerRequestWaiting({ ...o, buyerRequestedAt: null }, now), false);
});

// ---------------------------------------------------------------------------
// Shared e-Invoice state rules (one copy instead of five)
// ---------------------------------------------------------------------------

test("shared state rules: final statuses, netted credit notes, live e-Invoices", () => {
  for (const s of ["valid", "Invalid", "cancelled", "rejected"]) assert.equal(isFinalStatus(s), true);
  for (const s of ["pending", "submitted", "unconfirmed", null]) assert.equal(isFinalStatus(s), false);
  assert.equal(isNettedInConsolidation({ eInvoiceStatus: "consolidated" }), true);
  assert.equal(isNettedInConsolidation({ eInvoiceStatus: "pending" }), false);
  assert.equal(isNettedInConsolidation(null), false);
  // An unanswered submission has no UUID, so it never counts as a live e-Invoice.
  assert.equal(isLiveEInvoice({ eInvoiceUuid: null, eInvoiceStatus: "unconfirmed", eInvoiceEnv: "production" }), false);
});
