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

// v0.3.29 — gaps left by the v0.3.27 CF410 fix (see docs/CODE-REVIEW-v0.3.27.md, section V).
test("placeholders become NA and are refused where a real number is required (supplier)", () => {
  for (const p of ["-", "NIL", "TBA", "N/A", "n.a.", "none", "0", ""]) {
    assert.equal(normalizeMyInvoisPhone(p), "NA", p);
    assert.equal(isValidMyInvoisPhone(p, { allowNA: false }), false, `supplier phone ${JSON.stringify(p)} must be refused`);
  }
});

test("extensions, trunk (0) and several numbers are cleaned up instead of glued together", () => {
  assert.equal(normalizeMyInvoisPhone("03-1234 5678 ext 12"), "+60312345678");
  assert.equal(normalizeMyInvoisPhone("03-1234 5678 x12"), "+60312345678");
  assert.equal(normalizeMyInvoisPhone("+60 (0)12-345 6789"), "+60123456789");
  assert.equal(normalizeMyInvoisPhone("012-345 6789 / 019-876 5432"), "+60123456789");
  assert.equal(normalizeMyInvoisPhone("(03) 1234-5678"), "+60312345678");
});

test("only E.164 numbers pass: a + and a country code, sensible Malaysian lengths", () => {
  assert.equal(isValidMyInvoisPhone("04-123 4567"), true);
  assert.equal(isValidMyInvoisPhone("011-1234 5678"), true);
  assert.equal(isValidMyInvoisPhone("+65 9123 4567"), true);
  assert.equal(isValidMyInvoisPhone("6591234567"), false, "foreign number without + is ambiguous");
  assert.equal(isValidMyInvoisPhone("+0123456789"), false, "country codes never start with 0");
  assert.equal(isValidMyInvoisPhone("+60123"), false, "too short for Malaysia");
  assert.equal(isValidMyInvoisPhone("+600123456789"), false, "no trunk 0 after +60");
});
