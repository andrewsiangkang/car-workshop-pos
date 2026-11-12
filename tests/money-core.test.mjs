import test from "node:test";
import assert from "node:assert/strict";
import { toCents, fromCents, roundMoney, addMoney, multiplyMoney } from "../src/lib/money-core.mjs";

test("converts ringgit to integer sen and back", () => {
  assert.equal(toCents(12.34), 1234);
  assert.equal(fromCents(1234), 12.34);
});

test("rounds positive and negative half-sen values consistently", () => {
  assert.equal(roundMoney(1.005), 1.01);
  assert.equal(roundMoney(-1.005), -1.01);
});

test("adds money using integer cents", () => {
  assert.equal(addMoney(0.1, 0.2, 0.3), 0.6);
});

test("rounds fractional quantity multiplication to sen", () => {
  assert.equal(multiplyMoney(0.1, 3), 0.3);
});

test("rejects values outside safe integer-cent range", () => {
  assert.throws(() => toCents(Number.MAX_SAFE_INTEGER), RangeError);
});
