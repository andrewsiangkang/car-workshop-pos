import test from "node:test";
import assert from "node:assert/strict";
import {
  validateCustomerFields,
  parseRetentionYears,
  anonymisedCustomerData,
  recordKeepingCheck,
  lastActivityTime,
  isRetentionDue,
  anonymiseRefusal,
  yearsBefore,
  recordKeepingStart,
  ANONYMISED_NAME,
} from "../src/lib/privacy-customer.mjs";
import { customerPhoneKey } from "../src/lib/customer-match.mjs";
import { redactBuyerForList } from "../src/lib/privacy-redact.mjs";

const STATES = ["01", "10", "14", "17"];
const NOW = new Date("2026-11-14T04:00:00Z");

test("a new customer: name and phone required, phone saved in matching form, blanks become null", () => {
  const r = validateCustomerFields({ name: "  Tan  Ah Kow ", phone: "012-345 6789" }, { stateCodes: STATES, all: true, phoneRequired: true });
  assert.equal(r.ok, true);
  assert.equal(r.data.name, "Tan Ah Kow");
  assert.equal(r.data.phone, "0123456789");
  assert.equal(r.data.email, null);
  assert.equal(r.data.address, null);
  assert.equal(r.data.stateCode, null);
  assert.equal(validateCustomerFields({ name: "", phone: "0123" }, { stateCodes: STATES, all: true }).field, "name");
  assert.equal(validateCustomerFields({ name: "A", phone: "N/A" }, { stateCodes: STATES, all: true, phoneRequired: true }).field, "phone");
});

test("address follows LHDN limits: 150 characters, city 50, 5-digit postcode, a listed state", () => {
  const ok = validateCustomerFields(
    { address: "No. 1, Jalan  Satu", postcode: " 43000 ", city: "Kajang", stateCode: "10" },
    { stateCodes: STATES }
  );
  assert.deepEqual(ok, { ok: true, data: { address: "No. 1, Jalan Satu", postcode: "43000", city: "Kajang", stateCode: "10" } });
  assert.equal(validateCustomerFields({ address: "x".repeat(151) }, { stateCodes: STATES }).field, "address");
  assert.equal(validateCustomerFields({ address: "x".repeat(150) }, { stateCodes: STATES }).ok, true);
  assert.equal(validateCustomerFields({ city: "y".repeat(51) }, { stateCodes: STATES }).field, "city");
  for (const pc of ["4300", "430000", "43OOO", "43-000"]) {
    assert.equal(validateCustomerFields({ postcode: pc }, { stateCodes: STATES }).field, "postcode", pc);
  }
  assert.equal(validateCustomerFields({ stateCode: "99" }, { stateCodes: STATES }).field, "stateCode");
});

test("only the fields sent are checked on an edit; e-mail, TIN and language are checked", () => {
  assert.deepEqual(validateCustomerFields({ tin: " ig 1234 5678 " }, { stateCodes: STATES }), { ok: true, data: { tin: "IG12345678" } });
  assert.equal(validateCustomerFields({ tin: "IG-123" }, { stateCodes: STATES }).field, "tin");
  assert.equal(validateCustomerFields({ email: "not an email" }, { stateCodes: STATES }).field, "email");
  assert.equal(validateCustomerFields({ language: "fr" }, { stateCodes: STATES }).field, "language");
  assert.deepEqual(validateCustomerFields({ language: "zh" }, { stateCodes: STATES }), { ok: true, data: { language: "zh" } });
  // A walk-in's placeholder phone stays "no phone".
  assert.deepEqual(validateCustomerFields({ phone: "-" }, { stateCodes: STATES }), { ok: true, data: { phone: "N/A" } });
});

test("retention years: off, or 7 to 50 whole years", () => {
  for (const off of [null, undefined, "", 0, "0", "off"]) assert.deepEqual(parseRetentionYears(off), { ok: true, value: null });
  assert.deepEqual(parseRetentionYears(7), { ok: true, value: 7 });
  assert.deepEqual(parseRetentionYears("10"), { ok: true, value: 10 });
  for (const bad of [6, 1, 7.5, 51, "abc", -7]) assert.equal(parseRetentionYears(bad).ok, false, String(bad));
});

test("anonymising removes every contact and ID detail and switches reminders off for good", () => {
  const d = anonymisedCustomerData(NOW);
  assert.equal(d.name, ANONYMISED_NAME);
  assert.equal(customerPhoneKey(d.phone), "", "the phone can never match another customer");
  for (const k of ["email", "tin", "notes", "address", "postcode", "city", "stateCode", "language", "reminderConsentAt"]) assert.equal(d[k], null, k);
  assert.equal(d.reminderOptOutAt, NOW);
  assert.equal(d.anonymisedAt, NOW);
});

const oldInvoice = { status: "COMPLETED", invoiceNumber: "INV20180101001", createdAt: "2018-01-01T02:00:00Z", invoicedAt: "2018-01-01T03:00:00Z", paidAt: "2018-01-02T03:00:00Z" };
const recentInvoice = { status: "COMPLETED", invoiceNumber: "INV20230601001", createdAt: "2023-06-01T02:00:00Z", invoicedAt: "2023-06-01T03:00:00Z" };

test("record keeping: invoices, receipts and credit notes of the last 7 years are counted", () => {
  assert.deepEqual(recordKeepingCheck([oldInvoice], NOW), { count: 0, latest: null });
  assert.deepEqual(recordKeepingCheck([oldInvoice, recentInvoice], NOW), { count: 1, latest: "2023-06-01T03:00:00.000Z" });
  // A quotation that never became an invoice is not a tax document.
  assert.equal(recordKeepingCheck([{ status: "QUOTED", createdAt: "2026-01-01T00:00:00Z" }], NOW).count, 0);
  // A recent credit note on an old invoice counts.
  assert.equal(recordKeepingCheck([{ ...oldInvoice, creditNotes: [{ createdAt: "2022-01-01T00:00:00Z" }] }], NOW).count, 1);
  assert.equal(yearsBefore(NOW, 7).toISOString(), "2019-11-14T04:00:00.000Z");
});

test("record keeping runs 7 years from the END of the document's year (Malaysia time)", () => {
  // 14 Nov 2026: everything dated 2019 or later must still be kept (2019 records until 31 Dec 2026).
  assert.equal(new Date(recordKeepingStart(NOW)).toISOString(), "2018-12-31T16:00:00.000Z", "1 Jan 2019, 00:00 Malaysia time");
  const inv = (at) => ({ status: "COMPLETED", invoiceNumber: "INV", createdAt: at, invoicedAt: at });
  assert.equal(recordKeepingCheck([inv("2019-06-01T03:00:00Z")], NOW).count, 1, "June 2019 is kept until 31 Dec 2026");
  assert.equal(recordKeepingCheck([inv("2018-12-31T03:00:00Z")], NOW).count, 0, "2018 records were due until 31 Dec 2025");
  // 1 Jan 2019 at 07:00 Malaysia time is still 31 Dec 2018 in UTC, and counts.
  assert.equal(recordKeepingCheck([inv("2018-12-31T23:00:00Z")], NOW).count, 1);
  // On New Year's Day 2027 (Malaysia time) the 2019 records are free.
  assert.equal(recordKeepingCheck([inv("2019-06-01T03:00:00Z")], new Date("2026-12-31T16:30:00Z")).count, 0);
  assert.equal(recordKeepingCheck([inv("2019-06-01T03:00:00Z")], new Date("2026-12-31T15:30:00Z")).count, 1);
  // A receipt paid in a later year than its invoice counts on its own date.
  const lateReceipt = { ...inv("2018-12-20T03:00:00Z"), receiptNumber: "RC", paidAt: "2019-01-05T03:00:00Z" };
  assert.deepEqual(recordKeepingCheck([lateReceipt], NOW), { count: 1, latest: "2019-01-05T03:00:00.000Z" });
  // The retention schedule leaves that customer alone, even with no visit for 7 years.
  assert.equal(isRetentionDue({ createdAt: "2018-01-01T00:00:00Z", workOrders: [inv("2019-06-01T03:00:00Z")] }, 7, NOW), false);
  assert.equal(isRetentionDue({ createdAt: "2018-01-01T00:00:00Z", workOrders: [inv("2018-06-01T03:00:00Z")] }, 7, NOW), true);
});

test("anonymising is refused while a job is open, and needs the boss's confirmation inside 7 years", () => {
  assert.deepEqual(anonymiseRefusal({ customer: { anonymisedAt: NOW }, orders: [], now: NOW }), { code: "ALREADY" });
  assert.equal(anonymiseRefusal({ customer: {}, orders: [{ status: "IN_PROGRESS" }], now: NOW, confirmRecordKeeping: true }).code, "OPEN_JOB");
  const r = anonymiseRefusal({ customer: {}, orders: [recentInvoice], now: NOW });
  assert.equal(r.code, "RECORD_KEEPING");
  assert.equal(r.count, 1);
  assert.equal(anonymiseRefusal({ customer: {}, orders: [recentInvoice], now: NOW, confirmRecordKeeping: true }), null);
  assert.equal(anonymiseRefusal({ customer: {}, orders: [oldInvoice], now: NOW }), null);
});

test("retention: only customers whose last visit of any kind is older than the period", () => {
  const old = { createdAt: "2017-05-01T00:00:00Z", workOrders: [oldInvoice] };
  assert.equal(lastActivityTime(old), Date.parse("2018-01-02T03:00:00Z"));
  assert.equal(isRetentionDue(old, 7, NOW), true);
  assert.equal(isRetentionDue(old, 10, NOW), false, "8 years ago is not 10");
  assert.equal(isRetentionDue({ ...old, anonymisedAt: NOW }, 7, NOW), false);
  // A later payment, credit note or new job keeps the customer.
  assert.equal(isRetentionDue({ ...old, workOrders: [{ ...oldInvoice, payments: [{ paidAt: "2021-03-01T00:00:00Z" }] }] }, 7, NOW), false);
  assert.equal(isRetentionDue({ ...old, workOrders: [oldInvoice, { status: "QUOTED", createdAt: "2025-01-01T00:00:00Z" }] }, 7, NOW), false);
  // A customer record created recently is kept even without jobs.
  assert.equal(isRetentionDue({ createdAt: "2024-01-01T00:00:00Z", workOrders: [] }, 7, NOW), false);
  // Never below the 7-year minimum.
  assert.equal(isRetentionDue(old, 5, NOW), false);
});

test("staff list responses carry no buyer ID number, TIN, e-mail or address", () => {
  const order = {
    id: "o1", buyerName: "Syarikat ABC", buyerPhone: "0123456789", buyerTin: "C1234567890", buyerIdType: "BRN",
    buyerIdNo: "201901000005", buyerEmail: "a@b.my", buyerAddress: "Jalan 1", buyerPostcode: "43000", buyerCity: "Kajang",
    buyerStateCode: "10", docSnapshot: '{"buyer":{"tin":"C1234567890"}}',
    customer: { name: "Tan", phone: "0123456789", tin: "IG123", email: "t@x.my", address: "Jalan 2", postcode: "43000", city: "Kajang", stateCode: "10" },
  };
  const staff = redactBuyerForList(order, false);
  for (const k of ["buyerTin", "buyerIdNo", "buyerEmail", "buyerAddress", "buyerPostcode", "buyerCity", "buyerStateCode", "docSnapshot"]) assert.equal(staff[k], null, k);
  assert.equal(staff.buyerName, "Syarikat ABC");
  assert.equal(staff.buyerPhone, "0123456789");
  assert.equal(staff.customer.name, "Tan");
  assert.equal(staff.customer.phone, "0123456789");
  for (const k of ["tin", "email", "address", "postcode", "city", "stateCode"]) assert.equal(staff.customer[k], null, k);
  assert.ok(!JSON.stringify(staff).includes("C1234567890"));
  // The boss gets everything; the original object is not changed.
  assert.equal(redactBuyerForList(order, true), order);
  assert.equal(order.buyerIdNo, "201901000005");
});
