// Operating expenses typed on the Expenses page (pure checks, shared by the API and tests).
// 【中文】开支页输入检查（纯函数，API 和测试共用）。
import { toCents, fromCents } from "./money-core.mjs";
import { parseMyDate, myDayStart } from "./money-time.mjs";

/** Suggested categories (stored in English; the screen translates them). */
export const EXPENSE_CATEGORIES = [
  "Rent",
  "Utilities",
  "Wages",
  "Repairs & maintenance",
  "Fuel & transport",
  "Telephone & internet",
  "Bank charges",
  "Insurance",
  "Licences & fees",
  "Other",
];

const MAX_AMOUNT = 10_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const text = (v, max) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/**
 * Checks one expense typed by the boss.
 * @param {{ title?: unknown; amount?: unknown; category?: unknown; notes?: unknown; expenseDate?: unknown }} b
 * @param {Date} [now]
 * @returns {{ ok: true; value: { title: string; amount: number; category: string | null; notes: string | null; expenseDate: Date } }
 *   | { ok: false; error: string }}
 */
// 【中文】检查一笔开支：名称必填、金额大于 0、日期是马来西亚日期且不能是将来。
export function parseExpenseInput(b, now = new Date()) {
  const title = text(b?.title, 150);
  if (!title) return { ok: false, error: "What was it for? Enter a description" };
  const raw = typeof b?.amount === "string" ? b.amount.trim() : b?.amount;
  const n = Number(raw);
  if (raw === "" || raw === null || raw === undefined || !Number.isFinite(n) || n <= 0) {
    return { ok: false, error: "Enter an amount greater than 0" };
  }
  if (n > MAX_AMOUNT) return { ok: false, error: "Amount is too large" };
  const amount = fromCents(toCents(n));
  if (amount <= 0) return { ok: false, error: "Enter an amount greater than 0" };
  const expenseDate = parseMyDate(b?.expenseDate);
  if (!expenseDate) return { ok: false, error: "Enter the date it was paid" };
  // Today (Malaysia time) at the latest: an expense is recorded once it is paid.
  if (expenseDate.getTime() >= myDayStart(now).getTime() + DAY_MS) {
    return { ok: false, error: "The date cannot be in the future" };
  }
  const category = text(b?.category, 60) || null;
  const notes = text(b?.notes, 500) || null;
  return { ok: true, value: { title, amount, category, notes, expenseDate } };
}
