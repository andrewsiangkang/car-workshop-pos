import test from "node:test";
import assert from "node:assert/strict";
import { normalisePlate, customerPhoneKey, sameCustomerName } from "../src/lib/customer-match.mjs";

test("plates are normalised the same way for lookup and save", () => {
  assert.equal(normalisePlate("wxy 1234"), "WXY1234");
  assert.equal(normalisePlate("  WXY\t1234 "), "WXY1234");
  assert.equal(normalisePlate(null), "");
});

test("placeholder or blank phones never become a matching key", () => {
  for (const v of ["", "  ", "N/A", "n/a", "NA", "-", "--", "NIL", "TBA", "0", "000", "none", null, undefined]) {
    assert.equal(customerPhoneKey(v), "", `expected no key for ${JSON.stringify(v)}`);
  }
});

test("dummy phones typed with separators are placeholders too (no merge into the oldest dummy)", () => {
  for (const v of ["000-0000000", "000 000 0000", "(000) 000-0000", "000.000.0000", "+000 0000", "111-1111111", "9999 9999"]) {
    assert.equal(customerPhoneKey(v), "", `expected no key for ${JSON.stringify(v)}`);
  }
  // Real numbers with repeated digits are still phones.
  assert.equal(customerPhoneKey("011-1111 1111"), "01111111111");
  assert.equal(customerPhoneKey("+60 11-1111 1111"), "+601111111111");
});

test("one phone form for the Customers page and work orders", () => {
  assert.equal(customerPhoneKey("012-345 6789"), "0123456789");
  assert.equal(customerPhoneKey("(012) 345.6789"), "0123456789");
  assert.equal(customerPhoneKey("0123456789"), "0123456789");
  assert.equal(customerPhoneKey("+60 12-345 6789"), "+60123456789");
});

test("a name differing only in case or spacing is not a rename", () => {
  assert.equal(sameCustomerName("Ali  bin Abu", "ali bin abu"), true);
  assert.equal(sameCustomerName("Ali", "Ahmad"), false);
});
