import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { nextSequenceNumber } from "@/lib/privacy-docnumber.mjs";

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
 * Numbers of this day that were issued before a backup restore rolled the database back
 * (RetiredDocNumber, filled at the first start after a restore, see desktop-startup.ts). They are
 * counted in the "highest number so far", so a printed number is never given to a second document.
 * If the table cannot be read (an older database that could not be upgraded), numbering goes on
 * as before rather than blocking every sale.
 * 【中文】还原备份前已开出、被还原掉的号码（RetiredDocNumber）也算进「目前最大号码」，同一个号码不会开给两张单据。
 */
async function retiredNumbers(db: Db, base: string): Promise<string[]> {
  try {
    const rows = await db.retiredDocNumber.findMany({ where: { number: { startsWith: base } }, select: { number: true } });
    return rows.map((r) => r.number);
  } catch (e) {
    console.error("[docnumber] retired numbers could not be read", e);
    return [];
  }
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
  const used = (rows as unknown as Array<Record<string, string | null>>).map((r) => r[field]);
  return nextSequenceNumber(base, used, await retiredNumbers(db, base));
}

/** Credit note number per day, e.g. CN20261111001 (call inside the same transaction). */
export async function nextCreditNoteNumber(db: Db = prisma) {
  const base = `CN${localDatePart()}`;
  const rows = await db.creditNote.findMany({ where: { number: { startsWith: base } }, select: { number: true } });
  return nextSequenceNumber(base, rows.map((r) => r.number), await retiredNumbers(db, base));
}

/** Internal supplier-invoice number, e.g. SI20261111001 (call inside the same transaction). */
export async function nextSupplierInvoiceNumber(db: Db = prisma) {
  const base = `SI${localDatePart()}`;
  const rows = await db.supplierInvoice.findMany({ where: { internalNo: { startsWith: base } }, select: { internalNo: true } });
  return nextSequenceNumber(base, rows.map((r) => r.internalNo), await retiredNumbers(db, base));
}

/** Payment voucher number, e.g. PV20261111001 (call inside the same transaction). */
export async function nextVoucherNumber(db: Db = prisma) {
  const base = `PV${localDatePart()}`;
  const rows = await db.paymentVoucher.findMany({ where: { number: { startsWith: base } }, select: { number: true } });
  return nextSequenceNumber(base, rows.map((r) => r.number), await retiredNumbers(db, base));
}

/** Round to sen (2 decimal places) to avoid floating-point drift such as 0.1 + 0.2. */
export { money } from "@/lib/tax";
