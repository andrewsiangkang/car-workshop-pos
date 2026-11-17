export const EXPENSE_CATEGORIES: string[];
export type ExpenseInput = { title: string; amount: number; category: string | null; notes: string | null; expenseDate: Date };
export function parseExpenseInput(
  b: { title?: unknown; amount?: unknown; category?: unknown; notes?: unknown; expenseDate?: unknown } | null | undefined,
  now?: Date
): { ok: true; value: ExpenseInput } | { ok: false; error: string };
