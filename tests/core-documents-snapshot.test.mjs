import test from "node:test";
import assert from "node:assert/strict";
import {
  addressText,
  buildCreditNoteSnapshot,
  buildInvoiceSnapshot,
  creditNoteBuyer,
  customerBuyer,
  invoiceBuyer,
  parseDocSnapshot,
  sellerSnapshot,
  vehicleSnapshot,
} from "../src/lib/doc-snapshot.mjs";

const shop = () => ({
  name: "Ah Seng Auto",
  address: "12 Jalan Besi",
  postcode: "47300",
  city: "Petaling Jaya",
  stateCode: "10",
  phone: "03-1234 5678",
  email: "shop@example.my",
  tin: "C1234567890",
  brn: "202301000001",
  sstNumber: "W10-1808-32000001",
  sstRate: 8,
  sstScope: "ALL",
  msicCode: "45201",
  msicDesc: "Maintenance and repair of motor vehicles",
  bankName: "Maybank",
  bankAccount: "5141 2345 6789",
  paymentQrUrl: "/api/files/payment-qr-1.png",
  myInvoisClientSecret: "never-copy-me",
  myInvoisClientId: "client-id",
});
const walkIn = () => ({ id: "c1", name: "Walk-in Ali", phone: "012-345 6789", tin: null, email: "ali@example.my" });
const car = () => ({ plateNumber: "WXY1234", make: "Perodua", model: "Myvi", year: 2019, mileage: 80000 });
const order = (extra = {}) => ({ id: "o1", mileageIn: 81234, docSnapshot: null, ...extra });
const qrBuyer = {
  buyerRequestedAt: new Date("2026-11-10T03:00:00Z"),
  buyerName: "Syarikat Maju Sdn Bhd",
  buyerTin: "C9876543210",
  buyerIdType: "BRN",
  buyerIdNo: "201901000002",
  buyerEmail: "accounts@maju.my",
  buyerPhone: "+60387654321",
  buyerAddress: "8 Jalan Maju",
  buyerPostcode: "50450",
  buyerCity: "Kuala Lumpur",
  buyerStateCode: "14",
};
const STATES = { "10": "Selangor", "14": "Wilayah Persekutuan Kuala Lumpur" };
const stateName = (c) => STATES[c];

/** Invoice issued now; returns the stored JSON as the route saves it. */
function issueInvoice(o, s = shop(), c = walkIn(), v = car()) {
  return JSON.stringify(buildInvoiceSnapshot({ shop: s, order: o, customer: c, vehicle: v, at: new Date("2026-11-01T02:00:00Z") }));
}

test("invoice snapshot freezes seller, buyer and vehicle as issued", () => {
  const snap = parseDocSnapshot(issueInvoice(order()));
  assert.equal(snap.kind, "invoice");
  assert.equal(snap.takenAt, "2026-11-01T02:00:00.000Z");
  assert.equal(snap.seller.name, "Ah Seng Auto");
  assert.equal(snap.seller.sstNumber, "W10-1808-32000001");
  assert.equal(snap.seller.msicCode, "45201");
  assert.equal(snap.seller.bankAccount, "5141 2345 6789");
  assert.deepEqual(
    { name: snap.buyer.name, phone: snap.buyer.phone, tin: snap.buyer.tin, source: snap.buyer.source },
    { name: "Walk-in Ali", phone: "012-345 6789", tin: null, source: "customer" }
  );
  // The job's mileage, not the car's last known mileage.
  assert.deepEqual(snap.vehicle, { plateNumber: "WXY1234", make: "Perodua", model: "Myvi", year: 2019, mileage: 81234 });
});

test("the MyInvois secret and other settings never go into a snapshot", () => {
  const raw = issueInvoice(order());
  assert.ok(!raw.includes("never-copy-me"));
  assert.ok(!raw.includes("client-id"));
  assert.ok(!("sstRate" in sellerSnapshot(shop())));
});

test("snapshots keep no NRIC / passport number or e-mail (PDPA: one copy only)", () => {
  const o = order({ ...qrBuyer });
  const raw = JSON.stringify(buildCreditNoteSnapshot({ shop: shop(), order: o, customer: walkIn(), vehicle: car() }));
  assert.ok(!raw.includes("201901000002"));
  assert.ok(!raw.includes("accounts@maju.my"));
  assert.ok(!issueInvoice(order()).includes("ali@example.my"));
});

test("H6/H5: editing Settings, renaming the customer or the car does not change an issued invoice", () => {
  const s = shop();
  const c = walkIn();
  const v = car();
  const o = order({ docSnapshot: issueInvoice(order(), s, c, v) });
  // After the invoice: SST number changes, the walk-in is renamed by another job, car edited.
  s.sstNumber = "W10-9999-99999999";
  s.name = "New Name Auto";
  c.name = "Somebody Else";
  c.phone = "019-999 9999";
  v.make = "Proton";
  const snap = parseDocSnapshot(o.docSnapshot);
  assert.equal(snap.seller.sstNumber, "W10-1808-32000001");
  assert.equal(snap.seller.name, "Ah Seng Auto");
  assert.equal(snap.vehicle.make, "Perodua");
  const b = invoiceBuyer({ order: o, customer: c });
  assert.equal(b.name, "Walk-in Ali");
  assert.equal(b.phone, "012-345 6789");
  assert.equal(b.source, "snapshot");
});

test("old invoices without a snapshot still print from live data", () => {
  const c = walkIn();
  const b = invoiceBuyer({ order: order(), customer: c });
  assert.equal(b.name, "Walk-in Ali");
  assert.equal(b.source, "customer");
  assert.equal(parseDocSnapshot(null), null);
});

test("QR buyer details win, on the print and on the e-Invoice alike", () => {
  const o = order({ docSnapshot: issueInvoice(order()), ...qrBuyer });
  const b = invoiceBuyer({ order: o, customer: walkIn() });
  assert.equal(b.source, "buyer_request");
  assert.equal(b.name, "Syarikat Maju Sdn Bhd");
  assert.equal(b.tin, "C9876543210");
  assert.equal(b.idNo, "201901000002"); // for LHDN, from the order (not the snapshot)
  assert.equal(addressText(b, stateName), "8 Jalan Maju\n50450 Kuala Lumpur\nWilayah Persekutuan Kuala Lumpur");
  // A later correction by QR (before e-Invoicing) shows up on the reprint too.
  const corrected = { ...o, buyerName: "Maju Holdings Sdn Bhd" };
  assert.equal(invoiceBuyer({ order: corrected, customer: walkIn() }).name, "Maju Holdings Sdn Bhd");
});

test("a buyer request without TIN is ignored (LHDN needs it), as before", () => {
  const o = order({ docSnapshot: issueInvoice(order()), ...qrBuyer, buyerTin: "  " });
  assert.equal(invoiceBuyer({ order: o, customer: walkIn() }).name, "Walk-in Ali");
});

test("QR buyer without a phone falls back to the frozen phone, not a renamed live record", () => {
  const o = order({ docSnapshot: issueInvoice(order()), ...qrBuyer, buyerPhone: null });
  const live = { ...walkIn(), phone: "019-999 9999" };
  assert.equal(invoiceBuyer({ order: o, customer: live }).phone, "012-345 6789");
});

test("Medium: the credit note names the same buyer as its invoice's e-Invoice (QR buyer)", () => {
  const o = order({ docSnapshot: issueInvoice(order()), ...qrBuyer });
  const cn = { docSnapshot: JSON.stringify(buildCreditNoteSnapshot({ shop: shop(), order: o, customer: walkIn(), vehicle: car() })) };
  const printed = creditNoteBuyer({ creditNote: cn, order: o, customer: walkIn() });
  const invoice = invoiceBuyer({ order: o, customer: walkIn() });
  assert.equal(printed.name, "Syarikat Maju Sdn Bhd");
  assert.deepEqual(printed, invoice);
  // Frozen on the credit note itself as printed particulars.
  assert.equal(parseDocSnapshot(cn.docSnapshot).buyer.name, "Syarikat Maju Sdn Bhd");
  assert.equal(parseDocSnapshot(cn.docSnapshot).buyer.source, "buyer_request");
});

test("QR details sent after the credit note still reach both the credit note print and its e-Invoice", () => {
  const before = order({ docSnapshot: issueInvoice(order()) });
  const cn = { docSnapshot: JSON.stringify(buildCreditNoteSnapshot({ shop: shop(), order: before, customer: walkIn(), vehicle: car() })) };
  const after = { ...before, ...qrBuyer };
  assert.equal(creditNoteBuyer({ creditNote: cn, order: after, customer: walkIn() }).name, "Syarikat Maju Sdn Bhd");
  assert.deepEqual(creditNoteBuyer({ creditNote: cn, order: after, customer: walkIn() }), invoiceBuyer({ order: after, customer: walkIn() }));
});

test("credit note on an old invoice freezes the buyer and vehicle on the day it is issued", () => {
  const c = walkIn();
  const v = car();
  const o = order(); // invoice issued before snapshots existed
  const cn = { docSnapshot: JSON.stringify(buildCreditNoteSnapshot({ shop: shop(), order: o, customer: c, vehicle: v })) };
  c.name = "Renamed Later";
  v.plateNumber = "ABC1";
  const b = creditNoteBuyer({ creditNote: cn, order: o, customer: c });
  assert.equal(b.name, "Walk-in Ali");
  assert.equal(parseDocSnapshot(cn.docSnapshot).vehicle.plateNumber, "WXY1234");
});

test("credit note takes the invoice's frozen vehicle and today's seller", () => {
  const s = shop();
  const o = order({ docSnapshot: issueInvoice(order(), s) });
  const s2 = { ...s, sstNumber: "W10-2000-00000002", address: "99 Jalan Baru" };
  const v2 = { ...car(), make: "Proton" };
  const cn = parseDocSnapshot(JSON.stringify(buildCreditNoteSnapshot({ shop: s2, order: o, customer: walkIn(), vehicle: v2 })));
  assert.equal(cn.kind, "credit_note");
  assert.equal(cn.vehicle.make, "Perodua");
  assert.equal(cn.vehicle.mileage, 81234);
  assert.equal(cn.seller.sstNumber, "W10-2000-00000002");
  assert.equal(cn.seller.address, "99 Jalan Baru");
});

test("unreadable or partial snapshots fall back instead of breaking the print", () => {
  for (const raw of ["", "   ", "not json", "[]", "42", "null", undefined, 7]) {
    assert.equal(parseDocSnapshot(raw), null, `expected null for ${JSON.stringify(raw)}`);
  }
  const partial = parseDocSnapshot(JSON.stringify({ v: 1, seller: { name: "X" } }));
  assert.equal(partial.seller.name, "X");
  assert.equal(partial.buyer, null);
  assert.equal(partial.vehicle, null);
  // Falls back to the live customer when the snapshot has no buyer.
  const o = order({ docSnapshot: JSON.stringify({ v: 1, seller: { name: "X" } }) });
  assert.equal(invoiceBuyer({ order: o, customer: walkIn() }).source, "customer");
});

test("blank values are stored as null and numbers stay whole", () => {
  assert.equal(sellerSnapshot({ name: "  ", sstNumber: "  " }).name, "My Workshop");
  assert.equal(sellerSnapshot({ name: "A", sstNumber: "  " }).sstNumber, null);
  assert.deepEqual(vehicleSnapshot({ plateNumber: "A1", make: "M", model: "X", year: "2020", mileage: null }, null), {
    plateNumber: "A1", make: "M", model: "X", year: 2020, mileage: null,
  });
  assert.equal(vehicleSnapshot({ mileage: 5000 }, undefined).mileage, 5000);
  assert.equal(customerBuyer(null).name, "General Public");
});

test("address text: street, postcode + city, state; Not Applicable left out", () => {
  assert.equal(addressText({ address: "1 Jalan A", postcode: "47300", city: "PJ", stateCode: "10" }, stateName), "1 Jalan A\n47300 PJ\nSelangor");
  assert.equal(addressText({ address: "1 Jalan A", postcode: null, city: null, stateCode: "17" }, stateName), "1 Jalan A");
  assert.equal(addressText({ address: null, postcode: null, city: null, stateCode: null }, stateName), null);
  assert.equal(addressText(null, stateName), null);
});
