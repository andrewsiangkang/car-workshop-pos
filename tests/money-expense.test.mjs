import test from "node:test";
import assert from "node:assert/strict";
import { parseExpenseInput, EXPENSE_CATEGORIES } from "../src/lib/money-expense.mjs";

const NOW = new Date("2026-11-14T03:00:00Z"); // 14 Nov 11:00 in Kuala Lumpur

test("a valid expense is cleaned up and dated in Malaysia time", () => {
  const r = parseExpenseInput({ title: "  TNB   bill October ", amount: "350.555", category: "Utilities", notes: "", expenseDate: "2026-11-14" }, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.value.title, "TNB bill October");
  assert.equal(r.value.amount, 350.56);
  assert.equal(r.value.category, "Utilities");
  assert.equal(r.value.notes, null);
  assert.equal(r.value.expenseDate.toISOString(), "2026-11-13T16:00:00.000Z");
});

test("description, amount and a real past date are required", () => {
  assert.equal(parseExpenseInput({ title: " ", amount: 10, expenseDate: "2026-11-01" }, NOW).ok, false);
  for (const amount of ["", 0, -5, "abc", "0.001", null]) {
    assert.equal(parseExpenseInput({ title: "Rent", amount, expenseDate: "2026-11-01" }, NOW).ok, false, String(amount));
  }
  assert.equal(parseExpenseInput({ title: "Rent", amount: 20_000_000, expenseDate: "2026-11-01" }, NOW).error, "Amount is too large");
  assert.equal(parseExpenseInput({ title: "Rent", amount: 10, expenseDate: "2026-02-30" }, NOW).ok, false);
  assert.equal(parseExpenseInput({ title: "Rent", amount: 10, expenseDate: "2026-11-15" }, NOW).error, "The date cannot be in the future");
});

test("suggested categories include Other", () => {
  assert.ok(EXPENSE_CATEGORIES.includes("Other"));
  assert.ok(EXPENSE_CATEGORIES.includes("Rent"));
});
