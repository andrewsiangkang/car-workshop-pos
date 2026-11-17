import test from "node:test";
import assert from "node:assert/strict";
import { friendlyMyInvoisError, lhdnProblems, classifyProblem, formatFriendlyError } from "../src/lib/myinvois-errors-core.mjs";

// A rejected submission as MyInvois returns it (rejectedDocuments[0]).
const rejected = (code, message, propertyPath) => ({
  invoiceCodeNumber: "INV20261101001",
  error: {
    code: "BadArgument",
    message: "Validation Error",
    target: "INV20261101001",
    details: [{ code, message, target: propertyPath.split(".").pop(), propertyPath }],
  },
});

test("phone, email and address errors are no longer called TIN problems (#77/#89/#90)", () => {
  // Every party path contains "Accoun-tin-g": the old keyword check said "TIN" for all of these.
  const phone = friendlyMyInvoisError(rejected("CF410", "Enter valid phone number", "Invoice.AccountingSupplierParty.Party.Contact.Telephone"), { kind: "submit", fallback: "Submission failed" });
  assert.equal(phone.topic, "phone");
  assert.equal(phone.party, "supplier");
  assert.match(phone.message, /shop phone number/);
  assert.doesNotMatch(phone.message, /TIN/);

  const email = friendlyMyInvoisError(rejected("CF999", "Enter valid email", "Invoice.AccountingCustomerParty.Party.Contact.ElectronicMail"));
  assert.equal(email.topic, "email");
  assert.equal(email.party, "buyer");

  const city = friendlyMyInvoisError(rejected("CF999", "Value is not valid", "Invoice.AccountingSupplierParty.Party.PostalAddress.CityName"));
  assert.equal(city.topic, "address");
  assert.match(city.message, /shop address/);

  const msic = friendlyMyInvoisError(rejected("CF999", "Value is not valid", "Invoice.AccountingSupplierParty.Party.IndustryClassificationCode"));
  assert.equal(msic.topic, "msic");
});

test("real TIN / ID problems are still reported as such, with the right party", () => {
  const buyer = friendlyMyInvoisError("Enter valid TIN (Invoice.AccountingCustomerParty.Party.PartyIdentification.ID[@schemeID='TIN'])", { kind: "status" });
  assert.equal(buyer.topic, "id");
  assert.equal(buyer.party, "buyer");
  const shop = friendlyMyInvoisError("Supplier TIN is not valid");
  assert.equal(shop.topic, "id");
  assert.equal(shop.party, "supplier");
});

test("the status-check reason line (message (path); ...) is read field by field", () => {
  const line = "Enter valid phone number (Invoice.AccountingCustomerParty.Party.Contact.Telephone); Some other thing";
  assert.deepEqual(lhdnProblems(line), [
    { code: "", message: "Enter valid phone number", path: "Invoice.AccountingCustomerParty.Party.Contact.Telephone" },
    { code: "", message: "Some other thing", path: "" },
  ]);
  const fe = friendlyMyInvoisError(line, { kind: "status" });
  assert.equal(fe.topic, "phone");
  assert.equal(fe.party, "buyer");
});

test("document validation results (errorCode / innerError) are understood", () => {
  const details = {
    validationResults: {
      status: "Invalid",
      validationSteps: [{
        status: "Invalid",
        error: { error: "Step failed", innerError: [{ errorCode: "CF410", error: "Invalid contact number", propertyPath: null }] },
      }],
    },
  };
  const fe = friendlyMyInvoisError(details);
  assert.equal(fe.topic, "phone"); // from the error code
});

test("classification falls back to whole words in the message", () => {
  assert.deepEqual(classifyProblem({ code: "", message: "Accounting period closed", path: "" }), { topic: null, party: null });
  assert.equal(classifyProblem({ code: "", message: "Buyer postcode is missing", path: "" }).topic, "address");
  assert.equal(classifyProblem({ code: "", message: "Total payable amount mismatch", path: "" }).topic, "totals");
});

test("general errors keep their meaning", () => {
  assert.match(friendlyMyInvoisError({}, { httpStatus: 429 }).message, /Too many requests/);
  assert.match(friendlyMyInvoisError({ error: "invalid_client" }, { httpStatus: 400 }).message, /login failed/);
  assert.match(friendlyMyInvoisError({ error: { message: "Document is not signed" } }).message, /signature/);
  assert.match(friendlyMyInvoisError({ error: { message: "Duplicate submission" } }).message, /already exist/);
  // "CF401" is an LHDN code, not an HTTP 401.
  assert.doesNotMatch(friendlyMyInvoisError({ error: { code: "CF401", message: "Enter valid email", propertyPath: "Invoice.AccountingCustomerParty.Party.Contact.ElectronicMail" } }).message, /login/);
  assert.equal(friendlyMyInvoisError("weird", { fallback: "Submission failed" }).message, "Submission failed");
  assert.equal(formatFriendlyError({ message: "A", messageZh: "甲", hint: "h" }), "A / 甲 — h");
  assert.equal(formatFriendlyError({ message: "A", messageZh: "甲" }, false), "A");
});

test("TIN lookup errors keep the lookup wording", () => {
  const fe = friendlyMyInvoisError("No TIN found for this ID.", { kind: "tin", httpStatus: 404, fallback: "No TIN found for this ID." });
  assert.match(fe.message, /No TIN found/);
});

test("an amount or line number of 401 / 404 in LHDN's reason is not a login / not-found error", () => {
  const reason = "Total Payable Amount 401.00 does not match (Invoice.LegalMonetaryTotal.PayableAmount)";
  const fe = friendlyMyInvoisError(reason, { kind: "status" });
  assert.doesNotMatch(fe.message, /login/);
  assert.equal(fe.topic, "totals"); // the status route shows the totals hint as `advice`
  assert.doesNotMatch(friendlyMyInvoisError("Line 401: value is not valid", { kind: "status" }).message, /login/);
  assert.doesNotMatch(friendlyMyInvoisError("Line 404: value is not valid", { kind: "status" }).message, /could not find/);
  // Real login failures are still recognised: HTTP 401 or the OAuth error words.
  assert.match(friendlyMyInvoisError({}, { httpStatus: 401 }).message, /login failed/);
  assert.match(friendlyMyInvoisError("Unauthorized", { kind: "submit" }).message, /login failed/);
  assert.match(friendlyMyInvoisError({}, { httpStatus: 404, kind: "status" }).message, /could not find/);
});
