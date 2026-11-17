import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { buildClosingSnapshot, computeSummary, estimatePartsCost, type ClosingSnapshot, type ShiftSummary } from "@/lib/counter-calc";
import { returnedStockCost } from "@/lib/order-profit.mjs";

type Db = typeof prisma | Prisma.TransactionClient;

/** The counter session that is open right now, or null when the counter is closed. */
export async function getOpenShift(db: Db = prisma) {
  return db.cashShift.findFirst({ where: { closedAt: null }, orderBy: { openedAt: "desc" } });
}

/** Cash / non-cash breakdown and expected drawer cash for one counter session. */
export async function summarizeShift(
  shift: { id: string; openingFloat: number },
  db: Db = prisma
): Promise<ShiftSummary> {
  const rows = await db.payment.findMany({
    where: { shiftId: shift.id },
    select: { amount: true, method: true, tendered: true, changeGiven: true },
  });
  const payouts = await db.paymentVoucher.aggregate({
    where: { shiftId: shift.id, voidedAt: null },
    _sum: { amount: true },
  });
  return computeSummary(shift.openingFloat, rows, payouts._sum.amount ?? 0);
}

/**
 * The whole settlement of one counter session from live data, in the shape stored as the closing
 * snapshot: totals, cash paid out of this drawer, other vouchers paid while it was open and the
 * estimated parts cost of the jobs paid in it. Used when closing (to freeze it), for a session
 * that is still open, and for days closed before v0.3.30 (no snapshot).
 * 【中文】按实时数据算一个收银时段的完整结算（与关柜快照同一格式）：关柜时冻结、营业中显示、以及 v0.3.30 之前关柜的日子。
 */
export async function liveSettlement(
  shift: { id: string; openingFloat: number; openedAt: Date; closedAt: Date | null },
  db: Db = prisma,
  at: Date = new Date()
): Promise<ClosingSnapshot> {
  const payments = await db.payment.findMany({
    where: { shiftId: shift.id },
    select: { amount: true, method: true, tendered: true, changeGiven: true, workOrderId: true },
  });
  // Cash paid out of this drawer, and every other voucher paid while the counter was open.
  const windowEnd = shift.closedAt ?? at;
  const vouchers = await db.paymentVoucher.findMany({
    where: { voidedAt: null, OR: [{ shiftId: shift.id }, { shiftId: null, paidAt: { gte: shift.openedAt, lte: windowEnd } }] },
    orderBy: { paidAt: "asc" },
    select: { id: true, number: true, payee: true, purpose: true, amount: true, shiftId: true },
  });
  const drawerPayouts = vouchers.filter((v) => v.shiftId === shift.id);
  const otherVouchers = vouchers.filter((v) => v.shiftId !== shift.id);
  const summary = computeSummary(
    shift.openingFloat,
    payments,
    drawerPayouts.reduce((t, v) => t + v.amount, 0)
  );

  // Estimated parts cost of the jobs paid in this session (boss-only figure on the report).
  let partsCost = 0;
  if (payments.length > 0) {
    const jobIds = [...new Set(payments.map((p) => p.workOrderId))];
    const jobs = await db.workOrder.findMany({
      where: { id: { in: jobIds } },
      select: {
        id: true,
        totalAmount: true,
        items: { where: { type: "PART" }, select: { id: true, quantity: true, costPrice: true } },
        creditNotes: { select: { lines: { select: { workOrderItemId: true, returnedToStock: true } } } },
      },
    });
    partsCost = estimatePartsCost(
      jobs.map((j) => ({
        totalAmount: j.totalAmount,
        paidInShift: payments.filter((p) => p.workOrderId === j.id).reduce((t, p) => t + p.amount, 0),
        partsCost: j.items.reduce((t, i) => t + i.quantity * i.costPrice, 0) - returnedStockCost(j.items, j.creditNotes),
      }))
    );
  }
  return buildClosingSnapshot({ summary, drawerPayouts, otherVouchers, partsCost, at });
}
