import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMyInvoisPhone, isValidMyInvoisPhone } from "../src/lib/myinvois-phone.mjs";

test("normalizes Malaysian landline and mobile numbers to international format", () => {
  assert.equal(normalizeMyInvoisPhone("0312345678"), "+60312345678");
  assert.equal(normalizeMyInvoisPhone("03-1234 5678"), "+60312345678");
  assert.equal(normalizeMyInvoisPhone("012-345 6789"), "+60123456789");
});

test("preserves already international numbers and converts 60-prefixed numbers", () => {
  assert.equal(normalizeMyInvoisPhone("+601799999999"), "+601799999999");
  assert.equal(normalizeMyInvoisPhone("601799999999"), "+601799999999");
  assert.equal(normalizeMyInvoisPhone("0060312345678"), "+60312345678");
});

test("handles optional phone values and rejects invalid formats", () => {
  assert.equal(normalizeMyInvoisPhone(null), "NA");
  assert.equal(normalizeMyInvoisPhone("N/A"), "NA");
  assert.equal(isValidMyInvoisPhone("NA"), true);
  assert.equal(isValidMyInvoisPhone("0312345678"), true);
  assert.equal(isValidMyInvoisPhone("abc"), false);
  assert.equal(isValidMyInvoisPhone("+60+312345678"), false);
  assert.equal(isValidMyInvoisPhone("123"), false);
});
