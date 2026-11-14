import { NextResponse } from "next/server";
import { requireOwner, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { parseExpenseInput } from "@/lib/money-expense.mjs";
import { myMonthKey, myDateKey, parseMyMonth } from "@/lib/money-time.mjs";

export const dynamic = "force-dynamic";

/**
 * Operating expenses (boss only).
 *   GET  ?month=YYYY-MM   expenses of that Malaysian calendar month (default: this month), voided ones included
 *   POST { title, amount, category?, notes?, expenseDate: "YYYY-MM-DD" }
 * Expenses are never deleted: a wrong one is voided with a reason (see [id]/void).
 * 【中文】营业开支（仅老板）：按月列出、新增；录错的只能作废并写原因，不能删除。
 */
export async function GET(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  const url = new URL(request.url);
  const month = parseMyMonth(url.searchParams.get("month") || myMonthKey(new Date()));
  if (!month) return NextResponse.json({ error: "Month must look like 2026-11" }, { status: 400 });
  try {
    const list = await prisma.expense.findMany({
      where: { expenseDate: { gte: month.start, lt: month.end } },
      orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }],
    });
    return NextResponse.json(list);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to load expenses" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const me = await getCurrentUser();
    if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const b = await request.json().catch(() => ({}));
    const parsed = parseExpenseInput(b);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const v = parsed.value;
    const e = await prisma.expense.create({
      data: { title: v.title, amount: v.amount, category: v.category, notes: v.notes, expenseDate: v.expenseDate, createdById: me.id },
    });
    await writeAuditLog({
      actor: me, request, action: "EXPENSE_CREATED", entityType: "Expense", entityId: e.id,
      summary: `Expense recorded: ${e.title}`,
      details: { after: { title: e.title, amount: e.amount, category: e.category, expenseDate: myDateKey(e.expenseDate) } },
    });
    return NextResponse.json(e, { status: 201 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to save expense" }, { status: 500 });
  }
}
