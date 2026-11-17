// The printed invoice / credit note must name what LHDN has (review fix round):
// - the buyer of an invoice reported in a real consolidated e-Invoice can no longer be changed;
// - a credit note sent against the consolidated e-Invoice names General Public, print and LHDN alike;
// - a credit note that reverses SST keeps the invoice's SST registration number.
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCreditNoteSnapshot,
  buildInvoiceSnapshot,
  buyerEditLock,
  creditNoteBuyer,
  creditNoteReference,
  creditNoteSeller,
  invoiceBuyer,
  parseDocSnapshot,
  printedCreditNoteReference,
} from "../src/lib/doc-snapshot.mjs";

const shop = (extra = {}) => ({
  name: "Ah Seng Auto",
  address: "12 Jalan Besi",
  postcode: "47300",
  city: "Petaling Jaya",
  stateCode: "10",
  phone: "03-1234 5678",
  tin: "C1234567890",
  sstNumber: "W10-1808-32000001",
  ...extra,
});
const walkIn = () => ({ id: "c1", name: "Walk-in Ali", phone: "012-345 6789", tin: null });
const car = () => ({ plateNumber: "WXY1234", make: "Perodua", model: "Myvi", year: 2019, mileage: 80000 });
const qrBuyer = {
  buyerRequestedAt: new Date("2026-10-20T03:00:00Z"),
  buyerName: "XYZ Sdn Bhd",
  buyerTin: "C12345678901",
  buyerIdType: "BRN",
  buyerIdNo: "201901000002",
  buyerPhone: "+60387654321",
  buyerAddress: "8 Jalan Maju",
  buyerPostcode: "50450",
  buyerCity: "Kuala Lumpur",
  buyerStateCode: "14",
};
const issued = (s = shop()) =>
  JSON.stringify(buildInvoiceSnapshot({ shop: s, order: { mileageIn: 81234 }, customer: walkIn(), vehicle: car(), at: "2026-10-05T02:00:00Z" }));
const order = (extra = {}) => ({
  id: "o1",
  invoiceNumber: "INV-0001",
  docSnapshot: issued(),
  eInvoiceUuid: null,
  eInvoiceStatus: null,
  eInvoiceEnv: null,
  consolidatedId: null,
  ...extra,
});
const liveCon = (extra = {}) => ({ number: "CON-202610", eInvoiceUuid: "CONUUID0000000001", eInvoiceStatus: "valid", eInvoiceEnv: "production", ...extra });

test("buyer lock: an invoice in a real consolidated e-Invoice keeps its buyer (H6)", () => {
  const o = order({ consolidatedId: "con1" });
  assert.equal(buyerEditLock(o, liveCon()), "consolidated");
  assert.equal(buyerEditLock(o, liveCon({ eInvoiceStatus: "pending" })), "consolidated");
  // A link that cannot be resolved is taken as reported (as the submit / cancel routes do).
  assert.equal(buyerEditLock(o, null), "consolidated");
  // Its own real e-Invoice locks too.
  assert.equal(buyerEditLock(order({ eInvoiceUuid: "U1", eInvoiceStatus: "valid", eInvoiceEnv: "production" }), null), "submitted");
});

test("buyer lock: sandbox tests and consolidated e-Invoices LHDN no longer counts do not lock", () => {
  const o = order({ consolidatedId: "con1" });
  assert.equal(buyerEditLock(o, liveCon({ eInvoiceEnv: "sandbox" })), null);
  assert.equal(buyerEditLock(o, liveCon({ eInvoiceStatus: "invalid" })), null);
  assert.equal(buyerEditLock(o, liveCon({ eInvoiceStatus: "cancelled" })), null);
  assert.equal(buyerEditLock(o, liveCon({ eInvoiceUuid: null })), null);
  assert.equal(buyerEditLock(order(), null), null);
  assert.equal(buyerEditLock(order({ eInvoiceUuid: "U1", eInvoiceStatus: "valid", eInvoiceEnv: "sandbox" }), null), null);
  assert.equal(buyerEditLock(order({ eInvoiceUuid: "U1", eInvoiceStatus: "rejected", eInvoiceEnv: "production" }), null), null);
});

test("reviewer scenario: walk-in reported as General Public can no longer be renamed to a company", () => {
  // Invoice to walk-in Ali, reported in the live October consolidated e-Invoice.
  const o = order({ consolidatedId: "con1" });
  assert.equal(invoiceBuyer({ order: o, customer: walkIn() }).name, "Walk-in Ali");
  // save_buyer now answers 409 for this order, so the print keeps naming Ali.
  assert.equal(buyerEditLock(o, liveCon()), "consolidated");
});

test("credit note reference: the invoice's own e-Invoice first, in the same LHDN system", () => {
  const o = order({ eInvoiceUuid: "INVUUID000000001", eInvoiceStatus: "valid", eInvoiceEnv: "production" });
  assert.deepEqual(creditNoteReference({ order: o, consolidated: null, env: "production" }), {
    via: "invoice", number: "INV-0001", uuid: "INVUUID000000001",
  });
  // A production e-Invoice cannot be referred to from the sandbox.
  assert.equal(creditNoteReference({ order: o, consolidated: null, env: "sandbox" }), null);
});

test("credit note reference: else the consolidated e-Invoice the invoice is linked to", () => {
  const o = order({ consolidatedId: "con1" });
  assert.deepEqual(creditNoteReference({ order: o, consolidated: liveCon(), env: "production" }), {
    via: "consolidated", number: "CON-202610", uuid: "CONUUID0000000001",
  });
  assert.equal(creditNoteReference({ order: o, consolidated: liveCon({ eInvoiceStatus: "rejected" }), env: "production" }), null);
  assert.equal(creditNoteReference({ order: o, consolidated: liveCon({ eInvoiceEnv: "sandbox" }), env: "production" }), null);
  // Not linked: the month's record alone does not make it the reference.
  assert.equal(creditNoteReference({ order: order(), consolidated: liveCon(), env: "production" }), null);
  // Netted into the consolidated e-Invoice already: no reference of its own.
  assert.equal(creditNoteReference({ creditNote: { eInvoiceStatus: "consolidated" }, order: o, consolidated: liveCon(), env: "production" }), null);
});

test("reviewer scenario: credit note against the consolidated e-Invoice prints General Public, as LHDN gets", () => {
  // Customer sent QR details, no individual e-Invoice was issued, the sale went into the live
  // consolidated e-Invoice as General Public; the boss then issues a credit note.
  const o = order({ ...qrBuyer, consolidatedId: "con1" });
  const cn = {
    eInvoiceUuid: null, eInvoiceStatus: null, eInvoiceEnv: null, taxAmount: 0,
    docSnapshot: JSON.stringify(buildCreditNoteSnapshot({ shop: shop(), order: o, customer: walkIn(), vehicle: car() })),
  };
  const settingsEnv = "production";
  const printedRef = printedCreditNoteReference({ creditNote: cn, order: o, consolidated: liveCon(), settingsEnv });
  const submitRef = creditNoteReference({ creditNote: cn, order: o, consolidated: liveCon(), env: settingsEnv });
  assert.deepEqual(printedRef, submitRef);
  const printed = creditNoteBuyer({ creditNote: cn, order: o, customer: walkIn(), via: printedRef?.via });
  const sent = creditNoteBuyer({ creditNote: cn, order: o, customer: walkIn(), via: submitRef?.via });
  assert.deepEqual(printed, sent);
  assert.equal(printed.name, "General Public");
  assert.equal(printed.tin, null);
  assert.equal(printed.phone, null);
  assert.equal(printed.address, null);
  assert.equal(printed.idNo, null);
  assert.equal(printed.source, "general_public");
});

test("credit note against the invoice's own e-Invoice still names the QR buyer (unchanged)", () => {
  const o = order({ ...qrBuyer, eInvoiceUuid: "INVUUID000000001", eInvoiceStatus: "valid", eInvoiceEnv: "production" });
  const cn = { docSnapshot: null, eInvoiceUuid: null, eInvoiceStatus: null };
  const ref = printedCreditNoteReference({ creditNote: cn, order: o, consolidated: null, settingsEnv: "production" });
  assert.equal(ref?.via, "invoice");
  const b = creditNoteBuyer({ creditNote: cn, order: o, customer: walkIn(), via: ref?.via });
  assert.equal(b.name, "XYZ Sdn Bhd");
  assert.deepEqual(b, invoiceBuyer({ order: o, customer: walkIn() }));
});

test("credit note netted into the consolidated e-Invoice keeps printing as issued", () => {
  const o = order({ consolidatedId: "con1" });
  const cn = { docSnapshot: null, eInvoiceUuid: null, eInvoiceStatus: "consolidated" };
  const ref = printedCreditNoteReference({ creditNote: cn, order: o, consolidated: liveCon(), settingsEnv: "production" });
  assert.equal(ref, null);
  assert.equal(creditNoteBuyer({ creditNote: cn, order: o, customer: walkIn(), via: ref?.via }).name, "Walk-in Ali");
});

test("printed reference: a sent credit note follows the LHDN system it went to", () => {
  const o = order({ ...qrBuyer, consolidatedId: "con1" });
  const sandboxCon = liveCon({ eInvoiceEnv: "sandbox" });
  const sentToSandbox = { eInvoiceUuid: "CNUUID0000000001", eInvoiceStatus: "valid", eInvoiceEnv: "sandbox" };
  // Settings were switched to production since: the print still matches the sandbox document.
  assert.equal(printedCreditNoteReference({ creditNote: sentToSandbox, order: o, consolidated: sandboxCon, settingsEnv: "production" })?.via, "consolidated");
  // Not sent yet: a sandbox test does not count while Settings are on production...
  const unsent = { eInvoiceUuid: null, eInvoiceStatus: null, eInvoiceEnv: null };
  assert.equal(printedCreditNoteReference({ creditNote: unsent, order: o, consolidated: sandboxCon, settingsEnv: "production" }), null);
  // ...counts while testing on Sandbox (the submit route would use it)...
  assert.equal(printedCreditNoteReference({ creditNote: unsent, order: o, consolidated: sandboxCon, settingsEnv: "sandbox" })?.via, "consolidated");
  // ...and a real consolidated e-Invoice always counts, whatever the Settings checkbox says.
  assert.equal(printedCreditNoteReference({ creditNote: unsent, order: o, consolidated: liveCon(), settingsEnv: "sandbox" })?.via, "consolidated");
});

test("SST credited: the credit note keeps the invoice's SST number after Settings change", () => {
  const o = order(); // invoice issued under W10-1808-32000001
  for (const later of [null, "", "NA", "W10-2000-00000002"]) {
    const snap = parseDocSnapshot(JSON.stringify(buildCreditNoteSnapshot({
      shop: shop({ sstNumber: later, address: "99 Jalan Baru" }), order: o, customer: walkIn(), vehicle: car(), taxAmount: 8,
    })));
    assert.equal(snap.seller.sstNumber, "W10-1808-32000001", `today's SST ${JSON.stringify(later)}`);
    // Everything else is the seller as on the credit note's date.
    assert.equal(snap.seller.address, "99 Jalan Baru");
  }
});

test("no SST credited, or an invoice without a snapshot: today's SST number", () => {
  const o = order();
  const noTax = buildCreditNoteSnapshot({ shop: shop({ sstNumber: "W10-2000-00000002" }), order: o, customer: walkIn(), vehicle: car(), taxAmount: 0 });
  assert.equal(noTax.seller.sstNumber, "W10-2000-00000002");
  const old = buildCreditNoteSnapshot({ shop: shop({ sstNumber: "W10-2000-00000002" }), order: order({ docSnapshot: null }), customer: walkIn(), vehicle: car(), taxAmount: 8 });
  assert.equal(old.seller.sstNumber, "W10-2000-00000002");
  // The print fallback for credit notes without their own snapshot uses the same rule.
  assert.equal(creditNoteSeller({ shop: shop({ sstNumber: null }), invoice: parseDocSnapshot(o.docSnapshot), taxAmount: 4.5 }).sstNumber, "W10-1808-32000001");
  assert.equal(creditNoteSeller({ shop: shop({ sstNumber: null }), invoice: null, taxAmount: 4.5 }).sstNumber, null);
});
