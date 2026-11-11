import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

type Field = "orderNumber" | "quotationNumber" | "invoiceNumber" | "receiptNumber";
type Db = typeof prisma | Prisma.TransactionClient;

/** Malaysia local date (UTC+8) regardless of the PC's time zone setting. */
function localDatePart() {
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}${m}${day}`;
}

/**
 * Sequential number per day, e.g. WO20261110001.
 * Call it with the transaction client (`tx`) and write the number in the same
 * transaction, so two people saving at the same moment cannot get the same number.
 * (SQLite runs one write transaction at a time.)
 */
export async function nextDocNumber(
  prefix: "WO" | "QT" | "INV" | "RC",
  field: Field,
  db: Db = prisma
) {
  const base = `${prefix}${localDatePart()}`;
  const rows = await db.workOrder.findMany({
    where: { [field]: { startsWith: base } },
    select: { [field]: true },
  });
  // Numeric max (string ordering breaks once a day passes 999 documents).
  let max = 0;
  for (const r of rows as unknown as Array<Record<string, string | null>>) {
    const n = parseInt((r[field] ?? "").slice(base.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${base}${String(max + 1).padStart(3, "0")}`;
}

/** Credit note number per day, e.g. CN20261111001 (call inside the same transaction). */
export async function nextCreditNoteNumber(db: Db = prisma) {
  const base = `CN${localDatePart()}`;
  const rows = await db.creditNote.findMany({ where: { number: { startsWith: base } }, select: { number: true } });
  const max = rows.reduce((m, r) => Math.max(m, parseInt(r.number.slice(base.length), 10) || 0), 0);
  return `${base}${String(max + 1).padStart(3, "0")}`;
}

/** Round to sen (2 decimal places) to avoid floating-point drift such as 0.1 + 0.2. */
export { money } from "@/lib/tax";
