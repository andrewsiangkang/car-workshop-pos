import { prisma } from "@/lib/prisma";
import { money } from "@/lib/tax";
import { envFromSandboxFlag, isReportedFor } from "@/lib/einvoice-state.mjs";
import {
  BUYER_REQUEST_ALERT_DAYS,
  buyerRequestDeadline,
  buyerRequestWaiting,
  consolidationEntry,
  monthBounds,
  waitingRequestWhere,
  type IndividualReason,
} from "@/lib/einvoice-rules.mjs";

/**
 * Monthly consolidated e-Invoice (LHDN): sales where the buyer did not ask for an
 * individual e-Invoice are reported together, as one e-Invoice per month, within
 * 7 days after the month ends. Buyer = "General Public" (TIN EI00000000010).
 *
 * Included: invoices issued in the month (Malaysia time) that were not e-Invoiced
 * individually and not already consolidated. Credit notes issued before
 * consolidation that were not submitted on their own are netted off the line.
 * Invoices whose buyer asked for their own e-Invoice (QR) or has a TIN on file should be
 * e-Invoiced individually: while the month is open they are left out; once it has ended,
 * any still without a live e-Invoice are included (and flagged) so no sale goes unreported.
 * An invoice whose own submission (or one of its credit notes') is being sent or got no answer
 * from LHDN may already be at LHDN: it is listed as `blocked` instead, and the consolidated
 * e-Invoice cannot be sent or recorded until Check Status has settled it (else the same sale
 * could be reported twice).
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
// 【中文】马来西亚时间（UTC+8）某月的起止时间，以及 LHDN 的申报截止日（次月 7 号）。
export function monthRange(month: string) {
  // Shared with the QR request deadline (einvoice-rules.mjs): end is exclusive, deadline = 7th of next month.
  return monthBounds(month);
}

type Env = "sandbox" | "production";

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
  /** Should have had its own e-Invoice; included only because its month has ended. */
  individual: IndividualReason | null;
};

/** An invoice (or one of its credit notes) whose own submission is being sent or got no answer from LHDN. */
export type BlockedLine = {
  orderId: string;
  invoiceNumber: string;
  customer: string;
  total: number;
  /** The waiting submission is a credit note's, not the invoice's. */
  creditNote: string | null;
};

/** An invoice that should get an individual e-Invoice (buyer asked by QR, or has a TIN on file). */
export type IndividualDue = {
  orderId: string;
  invoiceNumber: string;
  customer: string;
  total: number;
  reason: IndividualReason;
  included: boolean; // already in the consolidated lines (its month has ended)
};

// 【中文】预览某月的合并电子发票：汇总该月没有单独开电子发票的发票，并扣除尚未单独申报的退款单。
export async function consolidationPreview(month: string, envArg?: Env) {
  const { start, end, deadline } = monthRange(month);
  // Which LHDN system this preview is for: a real e-Invoice always counts as reported;
  // while testing in the sandbox, sandbox submissions count too.
  const env: Env =
    envArg ?? envFromSandboxFlag((await prisma.shopProfile.findFirst({ select: { myInvoisSandbox: true } }))?.myInvoisSandbox);
  const existing = await prisma.consolidatedInvoice.findUnique({ where: { month } });
  // A consolidated e-Invoice that LHDN rejected / that was cancelled, or a sandbox test while
  // working in production, no longer reports anything: its invoices are released so they can be
  // reported again (they used to stay linked forever, so "Resubmit" always found nothing).
  const released = !!existing && !isReportedFor(existing, env);
  const orders = await prisma.workOrder.findMany({
    where: {
      invoiceNumber: { not: null },
      invoicedAt: { gte: start, lt: end },
      status: { not: "CANCELLED" },
      ...(released ? { OR: [{ consolidatedId: null }, { consolidatedId: existing!.id }] } : { consolidatedId: null }),
    },
    include: { customer: { select: { name: true, tin: true } }, creditNotes: true },
    orderBy: { invoicedAt: "asc" },
  });

  const monthEnded = month < currentMonth();
  const lines: ConsolidationLine[] = [];
  const individualDue: IndividualDue[] = [];
  const blocked: BlockedLine[] = [];
  for (const o of orders) {
    // Treatment, or held back while its own submission (or a credit note's) may be arriving at LHDN.
    const how = consolidationEntry(o, env, monthEnded);
    if (how.individual) {
      // The buyer asked for their own e-Invoice by QR, or is a TIN customer (e.g. a fleet account):
      // listed so the boss issues it; after month end it is reported as General Public instead
      // of silently going unreported (it used to be skipped forever).
      individualDue.push({
        orderId: o.id, invoiceNumber: o.invoiceNumber!, customer: o.buyerName || o.customer?.name || "",
        total: o.totalAmount, reason: how.individual, included: how.line,
      });
    }
    if (how.blocked) {
      // 【中文】它自己的电子发票（或退款单）可能正在送到 LHDN：先不放进合并发票。
      blocked.push({
        orderId: o.id, invoiceNumber: o.invoiceNumber!, customer: o.buyerName || o.customer?.name || "",
        total: o.totalAmount, creditNote: how.blocked.creditNote,
      });
      continue;
    }
    if (!how.line) continue;
    // Credit notes not reported on their own are netted off here (including ones netted into a
    // released consolidated e-Invoice: they are netted again in the new one).
    const pending = o.creditNotes.filter((c) => !isReportedFor(c, env));
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
      individual: how.individual,
    });
  }
  const reportable = lines.filter((l) => l.total > 0);
  // Every invoice number of the month in issue order (in this consolidated e-Invoice or not), so a
  // range line "INV… - INV…" never spans an invoice it does not cover (see consolidatedRanges).
  const sequence = (
    await prisma.workOrder.findMany({
      where: { invoiceNumber: { not: null }, invoicedAt: { gte: start, lt: end } },
      select: { invoiceNumber: true },
      orderBy: [{ invoicedAt: "asc" }, { invoiceNumber: "asc" }],
    })
  ).map((o) => o.invoiceNumber!);
  const reported = existing && !released
    ? await prisma.workOrder.findMany({
        where: { consolidatedId: existing.id },
        select: { id: true, invoiceNumber: true, totalAmount: true, invoicedAt: true },
        orderBy: { invoicedAt: "asc" },
      })
    : [];
  return {
    month,
    deadline,
    isPast: monthEnded,
    lines,
    reportable,
    sequence,
    /** Invoices covered with nothing left to report (fully credited): they do not break a range. */
    covered: lines.filter((l) => !(l.total > 0)).map((l) => l.invoiceNumber),
    individualDue, // should get an individual e-Invoice; `included` once the month has ended
    blocked, // own submission being sent / unanswered: nothing can be sent until these are settled
    totals: {
      count: reportable.length,
      net: money(reportable.reduce((s, l) => s + l.net, 0)),
      tax: money(reportable.reduce((s, l) => s + l.tax, 0)),
      total: money(reportable.reduce((s, l) => s + l.total, 0)),
    },
    existing,
    released, // existing record no longer reports anything; its invoices are back in `lines`
    env,
    reported,
  };
}

export type WaitingRequest = {
  orderId: string;
  invoiceNumber: string;
  customer: string;
  total: number;
  requestedAt: Date;
  deadline: Date | null;
};

/**
 * Invoices whose buyer asked for their own e-Invoice (QR form, or staff saved the buyer) more than
 * 3 days ago and still have none, and are not in a consolidated e-Invoice either (review H4).
 * Shown on the monthly e-Invoice page so the boss issues them before the deadline. Oldest first.
 * `list` holds the oldest 50; `total` counts every waiting request read (`more`: there may be more
 * than the 500 read, shown as "500+"), so the number shown is never capped at the list's length.
 */
// 【中文】顾客要求个别电子发票超过 3 天还没开出（也没并入合并发票）的发票清单，按时间排序，在每月电子发票页醒目提示。
export async function waitingBuyerRequests(
  envArg?: Env,
  now = new Date()
): Promise<{ list: WaitingRequest[]; total: number; more: boolean }> {
  const env: Env =
    envArg ?? envFromSandboxFlag((await prisma.shopProfile.findFirst({ select: { myInvoisSandbox: true } }))?.myInvoisSandbox);
  const cutoff = new Date(now.getTime() - BUYER_REQUEST_ALERT_DAYS * 24 * 60 * 60 * 1000);
  // A handful a year: the consolidated e-Invoices that count, so the query can leave out their invoices.
  const cons = await prisma.consolidatedInvoice.findMany({
    select: { id: true, eInvoiceUuid: true, eInvoiceStatus: true, eInvoiceEnv: true },
  });
  const reportedConsolidatedIds = cons.filter((c) => isReportedFor(c, env)).map((c) => c.id);
  // Everything that is already done is filtered out by the database BEFORE the oldest 500 are
  // taken (it used to be filtered after, so 500 old finished requests hid every new one).
  const orders = await prisma.workOrder.findMany({
    where: waitingRequestWhere({ cutoff, env, reportedConsolidatedIds }),
    select: {
      id: true, invoiceNumber: true, status: true, totalAmount: true, invoicedAt: true, buyerRequestedAt: true, buyerName: true,
      eInvoiceUuid: true, eInvoiceStatus: true, eInvoiceEnv: true, consolidatedId: true,
      customer: { select: { name: true } },
    },
    orderBy: { buyerRequestedAt: "asc" },
    take: 500,
  });
  const reportedCon = new Set(reportedConsolidatedIds);
  const waiting = orders.filter((o) =>
    buyerRequestWaiting(
      {
        ...o,
        reported: isReportedFor(o, env),
        consolidated: !!o.consolidatedId && reportedCon.has(o.consolidatedId),
      },
      now
    )
  );
  const list = waiting
    .slice(0, 50)
    .map((o) => ({
      orderId: o.id,
      invoiceNumber: o.invoiceNumber!,
      customer: o.buyerName || o.customer?.name || "",
      total: o.totalAmount,
      requestedAt: o.buyerRequestedAt!,
      deadline: buyerRequestDeadline(o.invoicedAt),
    }));
  return { list, total: waiting.length, more: orders.length === 500 };
}
