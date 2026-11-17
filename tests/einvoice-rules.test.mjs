import test from "node:test";
import assert from "node:assert/strict";
import {
  malaysiaMonth,
  monthBounds,
  buyerRequestDeadline,
  buyerRequestLock,
  hasOwnTin,
  consolidationTreatment,
  checkBuyerFields,
  checkStaffBuyerContact,
  BUYER_LIMITS,
  checkPortalReference,
  portalConsolidatedDocument,
  sameIdSet,
  chunkForAudit,
  portalRecordMatches,
  consolidationLinesUnchanged,
  reportedInConsolidation,
} from "../src/lib/einvoice-rules.mjs";

test("month and deadline use Malaysia time (UTC+8)", () => {
  // 31 Oct 2026 23:30 Malaysia time is still October, though it is 15:30 UTC.
  assert.equal(malaysiaMonth(new Date("2026-10-31T15:30:00Z")), "2026-10");
  // 1 Nov 2026 00:30 Malaysia time is November (16:30 UTC on 31 Oct).
  assert.equal(malaysiaMonth(new Date("2026-10-31T16:30:00Z")), "2026-11");
  const b = monthBounds("2026-10");
  assert.equal(b.start.toISOString(), "2026-09-30T16:00:00.000Z");
  assert.equal(b.end.toISOString(), "2026-10-31T16:00:00.000Z");
  assert.equal(b.deadline.toISOString(), "2026-11-07T15:59:59.000Z"); // 7 Nov 23:59:59 MYT
  // December rolls into January of the next year.
  assert.equal(monthBounds("2026-12").deadline.toISOString(), "2027-01-07T15:59:59.000Z");
});

test("QR request deadline is the consolidation deadline of the invoice's month", () => {
  assert.equal(buyerRequestDeadline(null), null);
  assert.equal(buyerRequestDeadline(new Date("2026-10-15T04:00:00Z")).toISOString(), "2026-11-07T15:59:59.000Z");
  // Invoiced late on the last evening of October (Malaysia time) still belongs to October.
  assert.equal(buyerRequestDeadline(new Date("2026-10-31T15:00:00Z")).toISOString(), "2026-11-07T15:59:59.000Z");
});

test("QR request lock: open until staff save, e-Invoice, consolidation or the deadline", () => {
  const base = { hasInvoice: true, live: false, consolidated: false, staffSaved: false, invoicedAt: new Date("2026-10-15T04:00:00Z") };
  const before = new Date("2026-11-07T15:59:00Z");
  const after = new Date("2026-11-07T16:00:00Z"); // 8 Nov 00:00 MYT
  assert.equal(buyerRequestLock(base, before), "none");
  assert.equal(buyerRequestLock(base, after), "expired");
  assert.equal(buyerRequestLock({ ...base, staffSaved: true }, before), "staff_saved");
  assert.equal(buyerRequestLock({ ...base, consolidated: true }, before), "consolidated");
  assert.equal(buyerRequestLock({ ...base, live: true }, before), "submitted");
  assert.equal(buyerRequestLock({ ...base, hasInvoice: false }, before), "no_invoice");
  // The most useful reason wins: an issued e-Invoice beats an expired link.
  assert.equal(buyerRequestLock({ ...base, live: true }, after), "submitted");
  assert.equal(buyerRequestLock({ ...base, consolidated: true, staffSaved: true }, after), "consolidated");
  // No invoice date (old data): no deadline to apply.
  assert.equal(buyerRequestLock({ ...base, invoicedAt: null }, after), "none");
});

test("own TIN on file: real TINs only, not LHDN's shared ones or placeholders", () => {
  assert.equal(hasOwnTin("C12345678901"), true);
  assert.equal(hasOwnTin(" ig 1234 5678 901 "), true);
  for (const t of ["EI00000000010", "EI00000000020", "ei00000000030", "EI00000000040", "", null, undefined, "NA", "-", "000000", "N/A"]) {
    assert.equal(hasOwnTin(t), false, String(t));
  }
});

test("consolidation: QR / TIN buyers are left out while the month is open, included and flagged after (H4, #34)", () => {
  const open = { reported: false, monthEnded: false };
  const ended = { reported: false, monthEnded: true };
  assert.deepEqual(consolidationTreatment({ ...open, buyerRequested: false, customerTin: null }), { line: true, individual: null });
  assert.deepEqual(consolidationTreatment({ ...open, buyerRequested: true }), { line: false, individual: "buyer_request" });
  assert.deepEqual(consolidationTreatment({ ...ended, buyerRequested: true }), { line: true, individual: "buyer_request" });
  assert.deepEqual(consolidationTreatment({ ...open, buyerRequested: false, customerTin: "C12345678901" }), { line: false, individual: "customer_tin" });
  assert.deepEqual(consolidationTreatment({ ...ended, buyerRequested: false, customerTin: "C12345678901" }), { line: true, individual: "customer_tin" });
  // General-public TIN on the customer record is not a reason for an individual e-Invoice.
  assert.deepEqual(consolidationTreatment({ ...ended, buyerRequested: false, customerTin: "EI00000000010" }), { line: true, individual: null });
  // Already e-Invoiced on its own: never in the consolidated one, never listed.
  assert.deepEqual(consolidationTreatment({ reported: true, monthEnded: true, buyerRequested: true }), { line: false, individual: null });
});

const good = {
  name: "Tan Ah Kow", tin: "IG12345678901", idType: "NRIC", idNo: "900101-14-5678", email: "tan@example.com",
  phone: "012-345 6789", address: "No. 1, Jalan Satu", postcode: "50000", city: "Kuala Lumpur", stateCode: "14", consent: true,
};

test("buyer form: valid input is cleaned and the phone is stored in LHDN form", () => {
  const r = checkBuyerFields(good);
  assert.equal(r.ok, true);
  assert.equal(r.value.idNo, "900101145678");
  assert.equal(r.value.phone, "+60123456789");
  // Optional phone left blank or as a placeholder is fine.
  assert.equal(checkBuyerFields({ ...good, phone: "" }).ok, true);
  assert.equal(checkBuyerFields({ ...good, phone: "-" }).value.phone, "");
});

test("buyer form: LHDN maximum lengths are refused with a reason, never cut short (#120)", () => {
  const over = (n) => "A".repeat(n + 1);
  const r = checkBuyerFields({
    ...good,
    name: over(BUYER_LIMITS.name),
    address: over(BUYER_LIMITS.address),
    city: over(BUYER_LIMITS.city),
    email: "a".repeat(BUYER_LIMITS.email) + "@x.my",
  });
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, { name: "too_long", address: "too_long", city: "too_long", email: "too_long" });
  // Exactly at the limit is accepted.
  const at = checkBuyerFields({ ...good, address: "A".repeat(BUYER_LIMITS.address), city: "B".repeat(BUYER_LIMITS.city) });
  assert.equal(at.ok, true);
  assert.equal(at.value.address.length, 150);
  assert.deepEqual(BUYER_LIMITS, { name: 300, address: 150, city: 50, email: 320 });
});

test("buyer form: PDPA consent tick is required (#39/#96)", () => {
  assert.deepEqual(checkBuyerFields({ ...good, consent: false }).errors, { consent: "required" });
  assert.deepEqual(checkBuyerFields({ ...good, consent: "true" }).errors, { consent: "required" });
  const { consent, ...noConsent } = good;
  assert.equal(consent, true);
  assert.deepEqual(checkBuyerFields(noConsent).errors, { consent: "required" });
});

test("buyer form: each bad field gets its own reason", () => {
  const r = checkBuyerFields({ consent: true, idType: "NRIC", idNo: "123", tin: "x", phone: "12", postcode: "5000", stateCode: "17", email: "nope" });
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, {
    name: "required", tin: "invalid", idNo: "invalid", email: "invalid", phone: "invalid",
    address: "required", postcode: "invalid", city: "required", stateCode: "required",
  });
  assert.equal(checkBuyerFields(null).ok, false);
});

test("portal-recorded consolidated e-Invoice: reference format checks", () => {
  assert.deepEqual(checkPortalReference({ uuid: "F9D425P6DS7D8IU4K2QXYZ", number: "CON-202610" }), {
    ok: true, value: { uuid: "F9D425P6DS7D8IU4K2QXYZ", longId: null, number: "CON-202610" },
  });
  assert.equal(checkPortalReference({ uuid: "short", number: "CON-202610" }).ok, false);
  assert.equal(checkPortalReference({ uuid: "F9D425P6DS7D8IU4K2QXYZ", number: "" }).ok, false);
  assert.equal(checkPortalReference({ uuid: "F9D425P6DS7D8IU4K2QXYZ", longId: "has space in it", number: "CON-202610" }).ok, false);
});

test("portal-recorded consolidated e-Invoice: any number the MyInvois portal shows can be recorded", () => {
  // Spaces, '#' and other printable characters used to be refused, so such a real number could
  // never be recorded and Check Status then set the month's record aside.
  for (const number of ["CONS 10/2026", "CONS#10", "CON 2026", "Consolidated (Oct) 2026", "X".repeat(50)]) {
    const r = checkPortalReference({ uuid: "F9D425P6DS7D8IU4K2QXYZ", number: `  ${number} ` });
    assert.equal(r.ok, true, number);
    assert.equal(r.ok && r.value.number, number);
  }
  // Still refused: nothing, too long, control characters.
  assert.equal(checkPortalReference({ uuid: "F9D425P6DS7D8IU4K2QXYZ", number: "   " }).ok, false);
  assert.equal(checkPortalReference({ uuid: "F9D425P6DS7D8IU4K2QXYZ", number: "X".repeat(51) }).ok, false);
  assert.equal(checkPortalReference({ uuid: "F9D425P6DS7D8IU4K2QXYZ", number: "CON\u0007202610" }).ok, false);
});

test("a portal consolidated e-Invoice typed with another number is still recognised as the month's one", () => {
  const raw = { uuid: "F9D425P6DS7D8IU4K2QXYZ", internalId: "CONS 10/2026", typeName: "Invoice", receiverId: "EI00000000010", receiverName: "General Public", totalPayableAmount: 1234.5 };
  assert.equal(portalConsolidatedDocument(raw, { status: "valid", totalAmount: 1234.5 }), true);
  assert.equal(portalConsolidatedDocument(raw, { status: "submitted", totalAmount: 1234.5 }), true);
  // Name only, or the TIN under another field name, is enough for the General Public buyer.
  assert.equal(portalConsolidatedDocument({ receiverName: "general public", totalPayableAmount: 10 }, { status: "valid", totalAmount: 10 }), true);
  assert.equal(portalConsolidatedDocument({ buyerTIN: "EI00000000010", total: 10 }, { status: "valid", totalAmount: 10 }), true);
  // Another document: an invoice to a real buyer, another total, a credit note, or one LHDN no longer counts.
  assert.equal(portalConsolidatedDocument({ ...raw, receiverId: "IG12345678", receiverName: "Tan Ah Kow" }, { status: "valid", totalAmount: 1234.5 }), false);
  assert.equal(portalConsolidatedDocument(raw, { status: "valid", totalAmount: 1234.49 }), false);
  assert.equal(portalConsolidatedDocument({ ...raw, typeName: "Credit Note" }, { status: "valid", totalAmount: 1234.5 }), false);
  assert.equal(portalConsolidatedDocument(raw, { status: "cancelled", totalAmount: 1234.5 }), false);
  assert.equal(portalConsolidatedDocument({ ...raw, totalPayableAmount: undefined }, { status: "valid", totalAmount: 1234.5 }), false);
  assert.equal(portalConsolidatedDocument(null, { status: "valid", totalAmount: 1234.5 }), false);
});

test("portal record links exactly the invoices shown on the page", () => {
  assert.equal(sameIdSet(["a", "b"], ["b", "a"]), true);
  assert.equal(sameIdSet(["a"], ["a", "b"]), false);
  assert.equal(sameIdSet(["a", "b", "c"], ["a", "b"]), false);
  assert.equal(sameIdSet(undefined, ["a"]), false);
  assert.equal(sameIdSet([], []), true);
});

test("long invoice lists are split so audit details are never cut mid-list", () => {
  const nums = Array.from({ length: 450 }, (_, i) => `INV20261001${String(i).padStart(4, "0")}`);
  const parts = chunkForAudit(nums);
  assert.ok(parts.length > 1);
  assert.deepEqual(parts.flat(), nums);
  for (const p of parts) assert.ok(JSON.stringify(p).length <= 2500);
  assert.deepEqual(chunkForAudit([]), [[]]);
});

test("QR request: only a real consolidated e-Invoice closes it, not a sandbox test or a rejected one", () => {
  const sandboxTest = { eInvoiceUuid: "SBX123", eInvoiceStatus: "valid", eInvoiceEnv: "sandbox" };
  const rejectedReal = { eInvoiceUuid: "PRD123", eInvoiceStatus: "invalid", eInvoiceEnv: "production" };
  const pendingReal = { eInvoiceUuid: "PRD456", eInvoiceStatus: "pending", eInvoiceEnv: "production" };
  const noUuid = { eInvoiceUuid: null, eInvoiceStatus: null, eInvoiceEnv: null };
  // Linked by a sandbox test on 2 Nov: the October customer can still ask until 7 Nov.
  assert.equal(reportedInConsolidation(sandboxTest, sandboxTest), false);
  assert.equal(reportedInConsolidation(rejectedReal, null), false);
  assert.equal(reportedInConsolidation(noUuid, undefined), false);
  assert.equal(reportedInConsolidation(null, null), false);
  // A real one (still pending at LHDN counts), linked or recorded for the month.
  assert.equal(reportedInConsolidation(pendingReal, null), true);
  assert.equal(reportedInConsolidation(sandboxTest, pendingReal), true);
  assert.equal(reportedInConsolidation({ eInvoiceUuid: "OLD1", eInvoiceStatus: "valid" }, null), true); // pre-v0.3.29 = production
  // Fed into the lock: open while only a sandbox test links it.
  const base = { hasInvoice: true, live: false, staffSaved: false, invoicedAt: new Date("2026-10-15T04:00:00Z") };
  const nov2 = new Date("2026-11-02T04:00:00Z");
  assert.equal(buyerRequestLock({ ...base, consolidated: reportedInConsolidation(sandboxTest, null) }, nov2), "none");
  assert.equal(buyerRequestLock({ ...base, consolidated: reportedInConsolidation(pendingReal, null) }, nov2), "consolidated");
});

// A production preview as consolidationPreview returns it (only the fields the checks read).
const preview = () => ({
  lines: [
    { orderId: "o1", creditNoteIds: [], total: 6000, tax: 0 },
    { orderId: "o2", creditNoteIds: ["cn1"], total: 3500.1, tax: 198.12 },
    { orderId: "o3", creditNoteIds: ["cn0"], total: 0, tax: 0 }, // fully credited: linked, not reported
  ],
  totals: { total: 9500.1 },
});

test("portal record: the credit notes and total the boss saw must still be what is saved", () => {
  const p = preview();
  const sent = { orderIds: ["o3", "o2", "o1"], creditNoteIds: ["cn1", "cn0"], total: 9500.1 };
  assert.equal(portalRecordMatches(sent, p), true);
  // Float noise from the browser is fine: compared in whole sen.
  assert.equal(portalRecordMatches({ ...sent, total: 9500.099999999999 }, p), true);
  // Page opened before a RM 500 credit note was issued: same invoices, different amounts.
  assert.equal(portalRecordMatches({ ...sent, creditNoteIds: ["cn0"], total: 10000.1 }, p), false);
  assert.equal(portalRecordMatches({ ...sent, total: 10000.1 }, p), false);
  assert.equal(portalRecordMatches({ ...sent, total: 9500.11 }, p), false); // one sen off
  assert.equal(portalRecordMatches({ ...sent, creditNoteIds: ["cn0"] }, p), false);
  assert.equal(portalRecordMatches({ ...sent, orderIds: ["o1", "o2"] }, p), false);
  // An old page that does not send the credit notes / total is refused, not trusted.
  assert.equal(portalRecordMatches({ orderIds: sent.orderIds }, p), false);
  assert.equal(portalRecordMatches({ ...sent, total: "9500.10" }, p), false);
  assert.equal(portalRecordMatches(null, p), false);
});

test("portal record: amounts are checked again from the invoices and credit notes as they are now", () => {
  const p = preview();
  const orders = [
    { id: "o1", totalAmount: 6000, taxAmount: 0 },
    { id: "o2", totalAmount: 4000.1, taxAmount: 226.42 },
    { id: "o3", totalAmount: 300, taxAmount: 0 },
  ];
  const cn = (id, workOrderId, amount, taxAmount, rest = {}) => ({ id, workOrderId, amount, taxAmount, eInvoiceUuid: null, eInvoiceStatus: null, eInvoiceEnv: null, ...rest });
  // cn9 was e-Invoiced on its own (real, valid): not netted, so it does not count here.
  const creditNotes = [
    cn("cn1", "o2", 500, 28.3),
    cn("cn0", "o3", 300, 0),
    cn("cn9", "o1", 50, 0, { eInvoiceUuid: "PRDCN9", eInvoiceStatus: "valid", eInvoiceEnv: "production" }),
  ];
  assert.equal(consolidationLinesUnchanged(p.lines, orders, creditNotes, "production"), true);
  // A credit note issued between the preview and the save: refused.
  assert.equal(consolidationLinesUnchanged(p.lines, orders, [...creditNotes, cn("cn2", "o1", 100, 0)], "production"), false);
  // A credit note "submitted" only in the sandbox is still waiting to be reported for real.
  const sandboxCn = cn("cn3", "o1", 100, 0, { eInvoiceUuid: "SBXCN3", eInvoiceStatus: "valid", eInvoiceEnv: "sandbox" });
  assert.equal(consolidationLinesUnchanged(p.lines, orders, [...creditNotes, sandboxCn], "production"), false);
  // An invoice total changed meanwhile, or its SST.
  assert.equal(consolidationLinesUnchanged(p.lines, orders.map((o) => (o.id === "o1" ? { ...o, totalAmount: 6000.01 } : o)), creditNotes, "production"), false);
  assert.equal(consolidationLinesUnchanged(p.lines, orders.map((o) => (o.id === "o2" ? { ...o, taxAmount: 226.43 } : o)), creditNotes, "production"), false);
  // An invoice missing from the re-read.
  assert.equal(consolidationLinesUnchanged(p.lines, orders.slice(0, 2), creditNotes, "production"), false);
});

test("staff buyer contact: all optional, a given address must be complete, LHDN limits kept", () => {
  // Nothing typed: saved as empty (the QR sender's address / e-mail is not kept for another buyer)
  assert.deepEqual(checkStaffBuyerContact({}), { ok: true, value: { email: "", address: "", postcode: "", city: "", stateCode: "" } });
  const full = { address: " No. 1,  Jalan Satu ", postcode: "47500", city: "Subang Jaya", stateCode: "10", email: "acc@xyz.com.my" };
  assert.deepEqual(checkStaffBuyerContact(full), {
    ok: true,
    value: { email: "acc@xyz.com.my", address: "No. 1, Jalan Satu", postcode: "47500", city: "Subang Jaya", stateCode: "10" },
  });
  // Half an address is refused rather than half-sent
  assert.deepEqual(checkStaffBuyerContact({ ...full, postcode: "" }).errors, { address: "incomplete" });
  assert.deepEqual(checkStaffBuyerContact({ ...full, postcode: "4750" }).errors, { address: "incomplete" });
  assert.deepEqual(checkStaffBuyerContact({ ...full, stateCode: "17" }).errors, { address: "incomplete" });
  assert.deepEqual(checkStaffBuyerContact({ address: "", postcode: "", city: "KL", stateCode: "" }).errors, { address: "incomplete" });
  assert.deepEqual(checkStaffBuyerContact({ ...full, address: "A".repeat(BUYER_LIMITS.address + 1) }).errors, { address: "too_long" });
  assert.deepEqual(checkStaffBuyerContact({ ...full, email: "not-an-email" }).errors, { email: "invalid" });
  assert.equal(checkStaffBuyerContact({ email: "a@b.co" }).ok, true);
});
