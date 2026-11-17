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

test("rounds exactly half-up in sen above RM2 (36.25 × 6% = 2.18, not 2.17)", () => {
  assert.equal(roundMoney(36.25 * 0.06), 2.18);
  assert.equal(roundMoney((36.25 * 6) / 100), 2.18);
  assert.equal(roundMoney(2.675), 2.68);
  assert.equal(roundMoney(8.345), 8.35);
  assert.equal(roundMoney(1234567.885), 1234567.89);
  assert.equal(toCents(0.005), 1);
  assert.equal(toCents(-0.005), -1);
  assert.equal(toCents(1.0049), 100);
});

test("every 3-decimal amount up to RM2000 rounds half-up exactly", () => {
  for (let i = 0; i <= 2_000_000; i += 7) {
    const want = Math.floor(i / 10) + (i % 10 >= 5 ? 1 : 0);
    assert.equal(toCents(i / 1000), want, `RM ${i / 1000}`);
  }
});

test("SST at 6% / 8% / 10% on any price up to RM1000 rounds half-up to the sen", () => {
  for (let p = 0; p <= 100_000; p += 3) {
    for (const rate of [6, 8, 10]) {
      const exact = p * rate; // sen × rate = hundredths of a sen
      const want = Math.floor(exact / 100) + (exact % 100 >= 50 ? 1 : 0);
      assert.equal(toCents(((p / 100) * rate) / 100), want, `${p / 100} @ ${rate}%`);
    }
  }
});

test("tiny float noise and negative zero never leak out", () => {
  assert.equal(toCents(1e-9), 0);
  assert.ok(Object.is(toCents(-1e-9), 0));
  assert.ok(Object.is(toCents(-0.001), 0));
  assert.equal(toCents("12.5"), 1250);
  assert.equal(toCents("abc"), 0);
  assert.equal(addMoney(100.02, -0.02), 100);
});
