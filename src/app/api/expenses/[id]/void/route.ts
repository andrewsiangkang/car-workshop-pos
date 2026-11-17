import { NextResponse } from "next/server";
import { requireOwner, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { myDateKey } from "@/lib/money-time.mjs";

export const dynamic = "force-dynamic";

class UserError extends Error {}

/**
 * Void a wrongly entered expense (boss only). The record is kept with the reason (7-year record
 * keeping) and no longer counts in the reports. Expenses are never hard-deleted.
 * 【中文】作废录错的开支（仅老板）：记录保留并写明原因，报表不再计算；开支永远不会被删除。
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const { id } = await params;
    const actor = await getCurrentUser();
    const b = await request.json().catch(() => ({}));
    const reason = typeof b.reason === "string" ? b.reason.trim().slice(0, 300) : "";
    if (!reason) throw new UserError("Please give a reason for voiding");

    const e = await prisma.$transaction(async (tx) => {
      const cur = await tx.expense.findUnique({ where: { id } });
      if (!cur) throw new UserError("Expense not found");
      if (cur.voidedAt) throw new UserError("Already voided");
      return tx.expense.update({ where: { id }, data: { voidedAt: new Date(), voidReason: reason } });
    });
    if (actor) {
      await writeAuditLog({
        actor, request, action: "EXPENSE_VOIDED", entityType: "Expense", entityId: id,
        summary: `Expense voided: ${e.title}`,
        details: { reason, before: { voided: false }, after: { voided: true }, title: e.title, amount: e.amount, expenseDate: myDateKey(e.expenseDate) },
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error(e);
    return NextResponse.json({ error: "Failed to void" }, { status: 500 });
  }
}
