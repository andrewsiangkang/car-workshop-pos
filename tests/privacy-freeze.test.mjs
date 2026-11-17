import test from "node:test";
import assert from "node:assert/strict";
import { buyerDataToClear, expiredBuyerDataSummary, snapshotsToFreeze } from "../src/lib/privacy-freeze.mjs";
import { anonymisedCustomerData, ANONYMISED_NAME } from "../src/lib/privacy-customer.mjs";
import { creditNoteBuyer, invoiceBuyer, parseDocSnapshot } from "../src/lib/doc-snapshot.mjs";

// Anonymising must not change what documents that still have to be kept print (or send to LHDN).
// Documents issued before v0.3.29 have no snapshot and read the live customer record, so the buyer
// is frozen on them first. 【中文】匿名化不能改变仍须保存的单据上的买方；v0.3.29 之前的单据先冻结买方。

const NOW = new Date("2026-11-14T04:00:00Z");
const tan = {
  id: "c1", name: "Tan Ah Kow", phone: "0123456789", email: "tan@x.my", tin: "IG12345678",
  address: "No. 1, Jalan Satu", postcode: "43000", city: "Kajang", stateCode: "10", notes: "VIP",
};
const anonymised = { ...tan, ...anonymisedCustomerData(NOW) };

/** An invoice issued under v0.3.28: no docSnapshot. */
const oldInvoice = {
  id: "o1", invoiceNumber: "INV20250301001", receiptNumber: "RC20250301001", docSnapshot: null, mileageIn: 120000,
  createdAt: "2025-03-01T02:00:00Z", invoicedAt: "2025-03-01T03:00:00Z", paidAt: "2025-03-01T04:00:00Z",
  creditNotes: [{ id: "cn1", createdAt: "2025-04-01T02:00:00Z", docSnapshot: null }],
};

test("without the freeze, an old invoice would reprint the anonymised placeholder", () => {
  const b = invoiceBuyer({ order: oldInvoice, customer: anonymised });
  assert.equal(b.name, ANONYMISED_NAME);
  assert.equal(b.tin, null);
});

test("after the freeze, the old invoice, receipt and credit note keep naming the real buyer", () => {
  const plan = snapshotsToFreeze({ customer: tan, orders: [oldInvoice], now: NOW });
  assert.equal(plan.orders.length, 1);
  assert.equal(plan.creditNotes.length, 1);
  const order = { ...oldInvoice, docSnapshot: plan.orders[0].docSnapshot };
  const b = invoiceBuyer({ order, customer: anonymised });
  assert.deepEqual(
    { name: b.name, phone: b.phone, tin: b.tin, address: b.address, postcode: b.postcode, city: b.city, stateCode: b.stateCode },
    { name: "Tan Ah Kow", phone: "0123456789", tin: "IG12345678", address: "No. 1, Jalan Satu", postcode: "43000", city: "Kajang", stateCode: "10" }
  );
  // The credit note too, from its own snapshot even if the invoice's were missing.
  const cn = { id: "cn1", docSnapshot: plan.creditNotes[0].docSnapshot };
  assert.equal(creditNoteBuyer({ creditNote: cn, order, customer: anonymised, via: "invoice" }).name, "Tan Ah Kow");
  assert.equal(creditNoteBuyer({ creditNote: cn, order: oldInvoice, customer: anonymised, via: "invoice" }).tin, "IG12345678");
});

test("only the buyer is frozen: seller and car keep printing from today's data, no e-mail or notes are copied", () => {
  const plan = snapshotsToFreeze({ customer: tan, orders: [oldInvoice], now: NOW });
  const snap = parseDocSnapshot(plan.orders[0].docSnapshot);
  assert.equal(snap.seller, null);
  assert.equal(snap.vehicle, null);
  assert.equal(snap.kind, "invoice");
  assert.equal(snap.takenAt, NOW.toISOString());
  const raw = plan.orders[0].docSnapshot + plan.creditNotes[0].docSnapshot;
  assert.ok(!raw.includes("tan@x.my") && !raw.includes("VIP"));
  assert.equal(parseDocSnapshot(plan.creditNotes[0].docSnapshot).kind, "credit_note");
});

test("a QR buyer typed on the invoice stays the buyer", () => {
  const qr = {
    ...oldInvoice, buyerRequestedAt: "2025-03-01T02:30:00Z", buyerName: "Syarikat ABC Sdn Bhd", buyerTin: "C1234567890",
    buyerIdType: "BRN", buyerIdNo: "201901000005", buyerPhone: "0399999999",
  };
  const plan = snapshotsToFreeze({ customer: tan, orders: [qr], now: NOW });
  const order = { ...qr, docSnapshot: plan.orders[0].docSnapshot };
  assert.equal(invoiceBuyer({ order, customer: anonymised }).name, "Syarikat ABC Sdn Bhd");
  assert.equal(parseDocSnapshot(plan.orders[0].docSnapshot).buyer.source, "buyer_request");
});

test("documents with a snapshot, quotations and documents past the keeping period are left alone", () => {
  const issuedV329 = { ...oldInvoice, id: "o2", docSnapshot: '{"v":1,"buyer":{"name":"Tan Ah Kow"}}', creditNotes: [{ id: "cn2", createdAt: "2026-11-01T00:00:00Z", docSnapshot: '{"v":1}' }] };
  const quotation = { id: "o3", quotationNumber: "QT20260101001", invoiceNumber: null, receiptNumber: null, docSnapshot: null, createdAt: "2026-01-01T00:00:00Z", creditNotes: [] };
  // Dated 2018: kept until 31 Dec 2025, so its personal data is not copied anywhere.
  const tooOld = { ...oldInvoice, id: "o4", invoiceNumber: "INV20180601001", receiptNumber: null, createdAt: "2018-06-01T02:00:00Z", invoicedAt: "2018-06-01T03:00:00Z", paidAt: null, creditNotes: [{ id: "cn4", createdAt: "2018-07-01T00:00:00Z", docSnapshot: null }] };
  const plan = snapshotsToFreeze({ customer: tan, orders: [issuedV329, quotation, tooOld], now: NOW });
  assert.deepEqual(plan, { orders: [], creditNotes: [] });
});

test("an old invoice whose credit note is still inside the keeping period: only the credit note is frozen", () => {
  // Invoice of 2018, credit note of 2019: the credit note must be kept until 31 Dec 2026.
  const order = { ...oldInvoice, invoiceNumber: "INV20181201001", receiptNumber: null, createdAt: "2018-12-01T02:00:00Z", invoicedAt: "2018-12-01T03:00:00Z", paidAt: null, creditNotes: [{ id: "cn5", createdAt: "2019-02-01T00:00:00Z", docSnapshot: null }] };
  const plan = snapshotsToFreeze({ customer: tan, orders: [order], now: NOW });
  assert.equal(plan.orders.length, 0);
  assert.equal(plan.creditNotes.length, 1);
  assert.equal(creditNoteBuyer({ creditNote: { docSnapshot: plan.creditNotes[0].docSnapshot }, order, customer: anonymised }).name, "Tan Ah Kow");
});

test("documents past the keeping period keep no personal data once the customer is anonymised", () => {
  // Run in 2034: the keeping period starts 1 Jan 2027, so a Jan 2026 invoice is past it.
  const NOW_2034 = new Date("2034-06-01T04:00:00Z");
  const snap = buildSnap();
  const pastQr = {
    ...oldInvoice, id: "o6", invoiceNumber: "INV20260110001", receiptNumber: "RC20260110001",
    createdAt: "2026-01-10T02:00:00Z", invoicedAt: "2026-01-10T03:00:00Z", paidAt: "2026-01-10T04:00:00Z",
    buyerRequestedAt: "2026-01-10T02:30:00Z", buyerName: "Tan Ah Kow", buyerIdType: "NRIC", buyerIdNo: "900101145678",
    buyerPhone: "0123456789", docSnapshot: snap,
    creditNotes: [{ id: "cn6", createdAt: "2026-02-01T00:00:00Z", docSnapshot: snap }],
  };
  // Its credit note is still inside the period (2027): the whole job is kept as it is.
  const stillKept = { ...pastQr, id: "o7", creditNotes: [{ id: "cn7", createdAt: "2027-03-01T00:00:00Z", docSnapshot: snap }] };
  // Paid (receipt) inside the period: kept.
  const paidLater = { ...pastQr, id: "o8", paidAt: "2027-01-05T00:00:00Z", creditNotes: [] };
  const quotation = { id: "o9", invoiceNumber: null, receiptNumber: null, createdAt: "2020-01-01T00:00:00Z", creditNotes: [] };
  const plan = buyerDataToClear({ orders: [pastQr, stillKept, paidLater, quotation], now: NOW_2034 });
  assert.deepEqual(plan.orderIds, ["o6"]);
  assert.deepEqual(plan.orders.map((o) => o.id), ["o6"]);
  assert.deepEqual(plan.creditNotes.map((c) => c.id), ["cn6"]);
  // Only the buyer goes: seller and car stay frozen; the document then names the anonymised customer.
  const after = parseDocSnapshot(plan.orders[0].docSnapshot);
  assert.equal(after.buyer, null);
  assert.equal(after.seller.name, "Ah Seng Auto");
  assert.equal(after.vehicle.plateNumber, "WXY1234");
  const cleared = { ...pastQr, buyerRequestedAt: null, buyerName: null, buyerIdType: null, buyerIdNo: null, buyerPhone: null, docSnapshot: plan.orders[0].docSnapshot };
  const b = invoiceBuyer({ order: cleared, customer: anonymised });
  assert.equal(b.name, ANONYMISED_NAME);
  assert.equal(b.idNo, null);
  assert.equal(creditNoteBuyer({ creditNote: { docSnapshot: plan.creditNotes[0].docSnapshot }, order: cleared, customer: anonymised }).name, ANONYMISED_NAME);
  // Today (2026) nothing of this app's data is past the period yet.
  assert.deepEqual(buyerDataToClear({ orders: [pastQr], now: NOW }), { orderIds: [], orders: [], creditNotes: [] });
});

test("a customer anonymised while the documents were still kept: the later sweep clears them, once", () => {
  // Anonymised in 2026 (request-time): the job keeps its QR buyer and snapshot buyer for now.
  const NOW_2034 = new Date("2034-06-01T04:00:00Z");
  const snap = buildSnap();
  const job = {
    ...oldInvoice, id: "o10", invoiceNumber: "INV20260301001", receiptNumber: "RC20260301001",
    createdAt: "2026-03-01T02:00:00Z", invoicedAt: "2026-03-01T03:00:00Z", paidAt: "2026-03-01T04:00:00Z",
    buyerRequestedAt: "2026-03-01T02:30:00Z", buyerName: "Tan Ah Kow", buyerIdType: "NRIC", buyerIdNo: "900101145555",
    docSnapshot: snap, creditNotes: [{ id: "cn10", createdAt: "2026-04-01T00:00:00Z", docSnapshot: snap }],
  };
  assert.deepEqual(buyerDataToClear({ orders: [job], now: NOW }).orderIds, []);
  // The sweep (clearExpiredBuyerData, at every start) in 2034: the period has ended, so it goes.
  const plan = buyerDataToClear({ orders: [job], now: NOW_2034 });
  assert.deepEqual(plan.orderIds, ["o10"]);
  assert.deepEqual([plan.orders.length, plan.creditNotes.length], [1, 1]);
  // Running it again on the cleared job finds no buyer left to strip (nothing is written or counted twice).
  const cleared = {
    ...job, buyerRequestedAt: null, buyerName: null, buyerIdType: null, buyerIdNo: null, docSnapshot: plan.orders[0].docSnapshot,
    creditNotes: [{ ...job.creditNotes[0], docSnapshot: plan.creditNotes[0].docSnapshot }],
  };
  const again = buyerDataToClear({ orders: [cleared], now: NOW_2034 });
  assert.deepEqual([again.orders.length, again.creditNotes.length], [0, 0]);
});

test("expired buyer data sweep: the audit entry is written when a customer could not be cleared, even with nothing cleared", () => {
  assert.equal(expiredBuyerDataSummary({ customers: 0, documents: 0, failed: 0 }), null);
  assert.equal(
    expiredBuyerDataSummary({ customers: 2, documents: 5, failed: 0 }),
    "Buyer details removed from 5 document(s) of 2 anonymised customer(s): past the record-keeping period"
  );
  // A customer that fails on every run (nothing else to clear) still reaches the audit log.
  assert.equal(
    expiredBuyerDataSummary({ customers: 0, documents: 0, failed: 1 }),
    "1 anonymised customer(s) past the record-keeping period could not be cleared (tried again at next start)"
  );
  assert.equal(
    expiredBuyerDataSummary({ customers: 1, documents: 3, failed: 2 }),
    "Buyer details removed from 3 document(s) of 1 anonymised customer(s): past the record-keeping period; " +
      "2 anonymised customer(s) past the record-keeping period could not be cleared (tried again at next start)"
  );
});

function buildSnap() {
  return JSON.stringify({
    v: 1, kind: "invoice", takenAt: "2026-01-10T03:00:00Z",
    seller: { name: "Ah Seng Auto", sstNumber: "W10-1808-32000001" },
    buyer: { name: "Tan Ah Kow", phone: "0123456789", tin: "", address: "No. 1, Jalan Satu", postcode: "43000", city: "Kajang", stateCode: "10", source: "customer" },
    vehicle: { plateNumber: "WXY1234", make: "Perodua", model: "Myvi" },
  });
}
