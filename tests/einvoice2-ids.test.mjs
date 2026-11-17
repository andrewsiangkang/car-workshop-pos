// Review Medium (myinvois.ts:253,275): a 12-digit SSM number was sent as an NRIC, and a buyer
// TIN was paired with an ID that was never checked. Plus the optional TIN for individuals.
import test from "node:test";
import assert from "node:assert/strict";
import {
  GENERAL_PUBLIC_TIN,
  buyerParty,
  checkBuyerId,
  isGeneralPublicBuyer,
  isMyKadNumber,
  isSsmRegistrationNumber,
  maskId,
  supplierSecondId,
} from "../src/lib/einvoice2-ids.mjs";

test("MyKad numbers: a real birth date and place-of-birth code", () => {
  assert.equal(isMyKadNumber("900101-14-5678"), true);
  assert.equal(isMyKadNumber("850229 10 1234"), false); // 1985 / 1885 had no 29 Feb
  assert.equal(isMyKadNumber("840229-10-1234"), true);
  assert.equal(isMyKadNumber("901301145678"), false); // month 13
  assert.equal(isMyKadNumber("900132145678"), false); // day 32
  assert.equal(isMyKadNumber("900101175678"), false); // place code 17 is never issued
  assert.equal(isMyKadNumber("900101005678"), false); // place code 00
  assert.equal(isMyKadNumber("12345"), false);
});

test("new-format SSM numbers: year + entity type 01-06 + 6 digits", () => {
  assert.equal(isSsmRegistrationNumber("202001012345"), true);
  assert.equal(isSsmRegistrationNumber("201903123456"), true); // business (sole proprietor)
  assert.equal(isSsmRegistrationNumber("200501012345"), true); // older company, new number
  assert.equal(isSsmRegistrationNumber("202007012345"), false); // entity type 07 does not exist
  assert.equal(isSsmRegistrationNumber("900101145678"), false); // an IC
  assert.equal(isSsmRegistrationNumber("1234567-A"), false); // old format
});

test("supplier: an SSM number is a BRN even for an individual (IG) taxpayer", () => {
  // The bug: IG TIN + 12 digits was always sent as NRIC.
  assert.deepEqual(supplierSecondId("IG12345678901", "202001012345"), { scheme: "BRN", value: "202001012345" });
  assert.deepEqual(supplierSecondId("IG12345678901", "200503012345"), { scheme: "BRN", value: "200503012345" });
  // A real IC of an individual taxpayer is an NRIC (sent as 12 digits).
  assert.deepEqual(supplierSecondId("IG12345678901", "900101-14-5678"), { scheme: "NRIC", value: "900101145678" });
  // A company TIN never identifies with an NRIC.
  assert.deepEqual(supplierSecondId("C12345678901", "900101145678"), { scheme: "BRN", value: "900101145678" });
  // Old SSM numbers keep their letter as typed; nothing set → "NA".
  assert.deepEqual(supplierSecondId("C12345678901", "1234567-A"), { scheme: "BRN", value: "1234567-A" });
  assert.deepEqual(supplierSecondId("C12345678901", ""), { scheme: "BRN", value: "NA" });
});

test("buyer ID numbers are checked for their type", () => {
  assert.equal(checkBuyerId("NRIC", "900101-14-5678"), null);
  assert.equal(checkBuyerId("NRIC", "123456789012"), "invalid"); // not a date
  assert.equal(checkBuyerId("NRIC", ""), "required");
  assert.equal(checkBuyerId("BRN", "202001012345"), null);
  assert.equal(checkBuyerId("BRN", "1234567-A"), null);
  assert.equal(checkBuyerId("BRN", "900101145678"), "invalid"); // an IC typed as BRN
  assert.equal(checkBuyerId("PASSPORT", "A12345678"), null);
  assert.equal(checkBuyerId("PASSPORT", "A1"), "invalid");
  assert.equal(checkBuyerId("ARMY", "T1234567"), null);
  assert.equal(checkBuyerId("DRIVING", "A12345678"), "invalid");
});

test("buyer party: own TIN + a valid ID is sent as it is", () => {
  assert.deepEqual(buyerParty({ tin: "C12345678901", idType: "BRN", idNo: "202001012345" }), {
    ok: true, kind: "with_tin", tin: "C12345678901", idScheme: "BRN", idValue: "202001012345",
  });
});

test("buyer party: a Malaysian individual without a TIN gets LHDN's general TIN with the IC (decision 5)", () => {
  const p = buyerParty({ tin: "", idType: "NRIC", idNo: "900101-14-5678" });
  assert.deepEqual(p, { ok: true, kind: "individual_no_tin", tin: GENERAL_PUBLIC_TIN, idScheme: "NRIC", idValue: "900101145678" });
  // Typing the general TIN by hand gives the same result.
  assert.equal(buyerParty({ tin: "EI00000000010", idType: "NRIC", idNo: "900101145678" }).kind, "individual_no_tin");
  // A named individual is not General Public: their phone is required.
  assert.equal(isGeneralPublicBuyer({ tin: "", idType: "NRIC", idNo: "900101145678" }), false);
});

test("buyer party: never an unchecked ID, and say which field to fix", () => {
  // Customer-record TIN (fleet account) with no ID: refused (it used to go out with "NA").
  const noId = buyerParty({ tin: "C12345678901" });
  assert.equal(noId.ok, false);
  assert.equal(noId.field, "idNo");
  assert.match(noId.message, /no ID number/);
  // An ID that fails its type check: refused, only the last 4 characters are shown.
  const bad = buyerParty({ tin: "IG12345678901", idType: "NRIC", idNo: "123456789012" });
  assert.equal(bad.ok, false);
  assert.equal(bad.field, "idNo");
  assert.match(bad.message, /ending 9012/);
  assert.doesNotMatch(bad.message, /12345678/);
  // A company without a TIN: the TIN is still required.
  const company = buyerParty({ tin: "", idType: "BRN", idNo: "202001012345" });
  assert.equal(company.ok, false);
  assert.equal(company.field, "tin");
});

test("buyer party: a walk-in is General Public (EI00000000010 + NA)", () => {
  assert.deepEqual(buyerParty({ tin: null, idType: null, idNo: null }), {
    ok: true, kind: "general_public", tin: GENERAL_PUBLIC_TIN, idScheme: "BRN", idValue: "NA",
  });
  assert.equal(isGeneralPublicBuyer({}), true);
  // A placeholder in the TIN box is no TIN: still General Public, not "TIN without ID".
  assert.equal(buyerParty({ tin: "N/A" }).kind, "general_public");
  assert.equal(buyerParty({ tin: "000000" }).kind, "general_public");
});

test("maskId keeps only the last 4 characters", () => {
  assert.equal(maskId("900101-14-5678"), "********5678");
  assert.equal(maskId("A12"), "***");
  assert.equal(maskId(""), "");
});
