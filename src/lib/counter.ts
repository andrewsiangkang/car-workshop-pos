import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { computeSummary, type ShiftSummary } from "@/lib/counter-calc";

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
  return computeSummary(shift.openingFloat, rows);
}
