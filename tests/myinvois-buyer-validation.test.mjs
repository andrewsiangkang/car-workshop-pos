import test from "node:test";
import assert from "node:assert/strict";
import { validateMyInvoisBuyer } from "../src/lib/myinvois-buyer-core.mjs";

const validBuyer = {
  name: "Test Buyer",
  tin: "IG1234567890",
  idType: "NRIC",
  idNo: "900101011234",
  address: "10 Jalan Test",
  postcode: "50000",
  city: "Kuala Lumpur",
  stateCode: "14",
};

test("complete Malaysian individual buyer passes validation", () => {
  assert.equal(validateMyInvoisBuyer(validBuyer).ok, true);
});

test("General Public is blocked for an individual invoice", () => {
  const result = validateMyInvoisBuyer({ name: "General Public" });
  assert.equal(result.ok, false);
  assert.ok(result.errors.tin);
});

test("General Public is allowed only when caller explicitly selects consolidated mode", () => {
  assert.equal(validateMyInvoisBuyer({ name: "General Public" }, { allowGeneralPublic: true }).ok, true);
});

test("State Code 17 is rejected for a Malaysian individual buyer", () => {
  const result = validateMyInvoisBuyer({ ...validBuyer, stateCode: "17" });
  assert.equal(result.ok, false);
  assert.ok(result.errors.stateCode);
});

test("NRIC must contain exactly 12 digits", () => {
  const result = validateMyInvoisBuyer({ ...validBuyer, idNo: "ABC123" });
  assert.equal(result.ok, false);
  assert.ok(result.errors.idNo);
});

test("postcode must contain five digits", () => {
  const result = validateMyInvoisBuyer({ ...validBuyer, postcode: "1234" });
  assert.equal(result.ok, false);
  assert.ok(result.errors.postcode);
});
