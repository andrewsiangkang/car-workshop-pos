import { prisma } from "@/lib/prisma";
import { money } from "@/lib/tax";

/**
 * Monthly consolidated e-Invoice (LHDN): sales where the buyer did not ask for an
 * individual e-Invoice are reported together, as one e-Invoice per month, within
 * 7 days after the month ends. Buyer = "General Public" (TIN EI00000000010).
 *
 * Included: invoices issued in the month (Malaysia time) that were not e-Invoiced
 * individually and not already consolidated. Credit notes issued before
 * consolidation that were not submitted on their own are netted off the line.
 */

const MY_OFFSET_MS = 8 * 60 * 60 * 1000;
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isValidMonth(m: string) {
  return MONTH_RE.test(m);
}

/** Current month in Malaysia time, "YYYY-MM". */
export function currentMonth() {
  return new Date(Date.now() + MY_OFFSET_MS).toISOString().slice(0, 7);
}

export function previousMonth() {
  const [y, m] = currentMonth().split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** UTC instants for the start/end of a Malaysian calendar month, plus the LHDN deadline. */
export function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1) - MY_OFFSET_MS);
  const end = new Date(Date.UTC(y, m, 1) - MY_OFFSET_MS); // exclusive
  const deadline = new Date(Date.UTC(y, m, 7, 23, 59, 59) - MY_OFFSET_MS); // 7th of next month
  return { start, end, deadline };
}

const isLive = (s: string | null | undefined) => !["invalid", "cancelled"].includes((s || "").toLowerCase());

export type ConsolidationLine = {
  orderId: string;
  invoiceNumber: string;
  invoicedAt: Date;
  customer: string;
  invoiceTotal: number;
  creditedNetted: number; // credit notes netted off this line
  creditNoteIds: string[];
  total: number;          // reported amount incl. SST
  tax: number;
  net: number;
  rate: number;
};

export async function consolidationPreview(month: string) {
  const { start, end, deadline } = monthRange(month);
  const orders = await prisma.workOrder.findMany({
    where: {
      invoiceNumber: { not: null },
      invoicedAt: { gte: start, lt: end },
      status: { not: "CANCELLED" },
      consolidatedId: null,
    },
    include: { customer: { select: { name: true } }, creditNotes: true },
    orderBy: { invoicedAt: "asc" },
  });

  const lines: ConsolidationLine[] = [];
  for (const o of orders) {
    if (o.eInvoiceUuid && isLive(o.eInvoiceStatus)) continue; // e-Invoiced individually
    const pending = o.creditNotes.filter((c) => !c.eInvoiceUuid || !isLive(c.eInvoiceStatus));
    const credited = money(pending.reduce((s, c) => s + c.amount, 0));
    const creditedTax = money(pending.reduce((s, c) => s + c.taxAmount, 0));
    const total = money(o.totalAmount - credited);
    const tax = money(Math.max(0, o.taxAmount - creditedTax));
    lines.push({
      orderId: o.id,
      invoiceNumber: o.invoiceNumber!,
      invoicedAt: o.invoicedAt!,
      customer: o.customer?.name || "",
      invoiceTotal: o.totalAmount,
      creditedNetted: credited,
      creditNoteIds: pending.map((c) => c.id),
      total,
      tax,
      net: money(total - tax),
      rate: o.taxRate,
    });
  }
  const reportable = lines.filter((l) => l.total > 0);
  const existing = await prisma.consolidatedInvoice.findUnique({ where: { month } });
  const reported = existing
    ? await prisma.workOrder.findMany({
        where: { consolidatedId: existing.id },
        select: { id: true, invoiceNumber: true, totalAmount: true, invoicedAt: true },
        orderBy: { invoicedAt: "asc" },
      })
    : [];
  return {
    month,
    deadline,
    isPast: month < currentMonth(),
    lines,
    reportable,
    totals: {
      count: reportable.length,
      net: money(reportable.reduce((s, l) => s + l.net, 0)),
      tax: money(reportable.reduce((s, l) => s + l.tax, 0)),
      total: money(reportable.reduce((s, l) => s + l.total, 0)),
    },
    existing,
    reported,
  };
}
