import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requireOwner, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { consolidationPreview, isValidMonth, currentMonth } from "@/lib/consolidation";
import { checkPortalReference, chunkForAudit, consolidationLinesUnchanged, portalRecordMatches } from "@/lib/einvoice-rules.mjs";
import { friendlyMyInvoisError, formatFriendlyError } from "@/lib/myinvois-errors";
import {
  getMyInvoisConfig,
  planConsolidatedDocument,
  supplierFromShop,
  submitDocument,
  payableOf,
  issueStamp,
} from "@/lib/myinvois";
import { envFromSandboxFlag, isLiveEInvoice, isReportedFor, PRODUCTION } from "@/lib/einvoice-state.mjs";
import { claimData, inFlightFor, notInFlightWhere, submitGate, submitOutcome } from "@/lib/einvoice2-submit.mjs";
import { checkBeforeSubmit, clock, inFlightMessage, markUnconfirmed, unconfirmedMessage, uuidHolderMessage, uuidRecordedElsewhere } from "@/lib/einvoice2-guard";

export const dynamic = "force-dynamic";

type Preview = Awaited<ReturnType<typeof consolidationPreview>>;
type RecordData = {
  number: string;
  orderCount: number;
  netAmount: number;
  taxAmount: number;
  totalAmount: number;
  eInvoiceUuid?: string | null;
  eInvoiceLongId?: string | null;
  eInvoiceStatus?: string | null;
  eInvoiceEnv?: string;
  submissionUid?: string | null;
  eInvoiceSubmittingAt?: Date | null;
};

/** Refused because the data changed between the preview and the save. */
class Conflict extends Error {
  readonly conflict = true;
}

/**
 * Save the month's consolidated record and mark everything it covers (invoices and the credit
 * notes netted in), so nothing is reported twice. Runs inside the caller's transaction. A new
 * month's record is created here; the unique month makes a second concurrent create fail.
 * The invoices and credit notes are reserved only while none of them is being sent on its own
 * (atomic: an individual submission that claimed one meanwhile makes the whole save fail).
 */
// 【中文】保存该月合并发票记录，并标记它包含的发票和贷项通知，避免重复申报（在调用方的事务内执行）。
// 只有在它们都没有自己在提交中时才预留（原子操作：期间有单独提交占位，整个保存就失败）。
async function saveConsolidated(
  tx: Prisma.TransactionClient,
  p: Preview,
  month: string,
  data: RecordData,
  env: "sandbox" | "production",
  changed: string
) {
  const lineIds = p.lines.map((l) => l.orderId);
  const cnIds = p.lines.flatMap((l) => l.creditNoteIds);
  if (p.existing && p.released) {
    // The earlier attempt no longer reports anything: unlink what it covered that is not
    // in this attempt (e.g. invoices since e-Invoiced on their own).
    await tx.creditNote.updateMany({
      where: { eInvoiceStatus: "consolidated", id: { notIn: cnIds }, workOrder: { consolidatedId: p.existing.id } },
      data: { eInvoiceStatus: null },
    });
    await tx.workOrder.updateMany({
      where: { consolidatedId: p.existing.id, id: { notIn: lineIds } },
      data: { consolidatedId: null },
    });
  }
  const con = p.existing
    ? await tx.consolidatedInvoice.update({ where: { id: p.existing.id }, data })
    : await tx.consolidatedInvoice.create({ data: { month, ...data } });
  // Fully-credited invoices (total 0) are also marked: nothing left to report.
  const linked = await tx.workOrder.updateMany({
    where: { id: { in: lineIds }, ...notInFlightWhere(env) },
    data: { consolidatedId: con.id },
  });
  if (linked.count !== lineIds.length) throw new Conflict(changed);
  if (cnIds.length) {
    // A credit note netted in has no submission of its own any more: a SANDBOX leftover claim
    // (production only lets those through, notInFlightWhere) ends here, so the note shows "Netted"
    // with no Check Status, and a later sandbox check can never overwrite the netting.
    // Not for the linked invoices above: their link is consolidatedId and their own status stays.
    // 【中文】退款单扣进合并发票后就不再有自己的提交：沙盒遗留的占位（只有正式环境会放行）在这里结束，
    // 只显示「已扣除」，之后沙盒的检查状态也不会盖掉。上面的发票不这样做（它们靠 consolidatedId 连结，状态照旧）。
    const netted = await tx.creditNote.updateMany({
      where: { id: { in: cnIds }, ...notInFlightWhere(env) },
      data: { eInvoiceStatus: "consolidated", eInvoiceSubmittingAt: null },
    });
    if (netted.count !== cnIds.length) throw new Conflict(changed);
  }
  return con;
}

/** Preview what would go into the consolidated e-Invoice for ?month=YYYY-MM (boss only). */
export async function GET(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  const month = new URL(request.url).searchParams.get("month") || "";
  if (!isValidMonth(month)) return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
  return NextResponse.json(await consolidationPreview(month));
}

const CHANGED_SUBMIT =
  "The invoices or credit notes for this month changed while the consolidated e-Invoice was being prepared. Nothing was sent. Reload the page, check the list and total, and submit again.";
const BUSY = "The consolidated e-Invoice for this month is already being sent to LHDN (from another click or device). Wait a minute, then press Check Status.";

/**
 * Refusal while an invoice of the month (or one of its credit notes) is being sent on its own or
 * got no answer from LHDN: it may already be at LHDN, so it must be settled before the month is
 * reported (else the same sale could be reported twice).
 */
// 【中文】该月有发票（或它的退款单）自己正在提交或在等 LHDN 回应：可能已在 LHDN，要先「检查状态」，否则同一笔交易可能申报两次。
function blockedMessage(p: Preview) {
  const names = p.blocked.map((b) => (b.creditNote ? `${b.invoiceNumber} (${b.creditNote})` : b.invoiceNumber));
  const list = names.length > 10 ? `${names.slice(0, 10).join(", ")} …` : names.join(", ");
  return `These invoices have their own e-Invoice or a credit note being sent to LHDN or waiting for LHDN's answer: ${list}. Open each one and press Check Status first, then try again.`;
}

/**
 * Build and submit the consolidated e-Invoice for { month } (boss only).
 * - One line per invoice while the document stays well under LHDN's 300 KB, else one line per
 *   continuous range of invoice numbers; refused when even that would not fit.
 * - Sent at most once: before sending, the month's record is claimed and the invoices and credit
 *   notes it covers are reserved in one transaction (checked again against the preview). If LHDN
 *   says no, the reservation is undone; if LHDN does not answer, the record stays reserved as
 *   "unconfirmed" until Check Status shows whether the document arrived.
 */
// 【中文】提交每月合并电子发票（只限老板）：一张发票一行能远低于 300 KB 就照旧，否则按连续号码分段，还是太大就拒绝。
// 只送一次：送出前在同一事务里占位并预留它包含的发票和退款单；LHDN 拒绝就撤销预留；LHDN 没回应就保持预留、记为"未确认"，等「检查状态」确认。
export async function POST(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const actor = await getCurrentUser();
    const { month } = await request.json();
    if (!isValidMonth(String(month || ""))) {
      return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
    }
    if (month >= currentMonth()) {
      return NextResponse.json({ error: "A month can only be consolidated after it has ended." }, { status: 400 });
    }

    const { shop } = await getMyInvoisConfig();
    const env = envFromSandboxFlag(shop.myInvoisSandbox);
    let p = await consolidationPreview(month, env);
    if (p.existing && isReportedFor(p.existing, env)) {
      return NextResponse.json(
        { error: `Already submitted for ${month} (UUID ${p.existing.eInvoiceUuid}). New items for this month need individual e-Invoices.` },
        { status: 409 }
      );
    }
    if (!shop.myInvoisSandbox) {
      return NextResponse.json({ error: "Production MyInvois submission is disabled until XAdES digital signing is implemented and verified with your organisation certificate.", code: "PRODUCTION_SIGNING_NOT_AVAILABLE" }, { status: 501 });
    }
    const { supplier, missing } = supplierFromShop(shop);
    if (missing.length) {
      return NextResponse.json({ error: `Fill in Settings → Shop first: ${missing.join(", ")}` }, { status: 400 });
    }

    // An earlier submission still running, or one LHDN never answered: settle it first.
    if (p.existing) {
      const blocked = await checkBeforeSubmit({ kind: "consolidated", rec: p.existing, number: p.existing.number, env, actor, request });
      if (blocked) return NextResponse.json({ error: blocked.error, code: blocked.code }, { status: blocked.status });
      p = await consolidationPreview(month, env);
      if (p.existing && isReportedFor(p.existing, env)) {
        return NextResponse.json({ error: `Already submitted for ${month} (UUID ${p.existing.eInvoiceUuid}).` }, { status: 409 });
      }
      const gate = submitGate(p.existing);
      if (gate.action === "wait") return NextResponse.json({ error: inFlightMessage(gate.until), code: "SUBMIT_IN_PROGRESS" }, { status: 409 });
    }
    if (p.blocked.length) return NextResponse.json({ error: blockedMessage(p), code: "INVOICE_SUBMISSION_PENDING" }, { status: 409 });
    if (p.reportable.length === 0) {
      return NextResponse.json({ error: "Nothing to consolidate for this month." }, { status: 400 });
    }

    // A retry after LHDN rejected the first attempt needs a new document number.
    const ym = month.replace("-", "");
    // (A number typed in from the portal may not follow the CON-YYYYMM-N pattern.)
    const prevAttempt = Number(p.existing?.number.split("-")[2] || "1");
    const attempt = p.existing ? (Number.isInteger(prevAttempt) && prevAttempt > 0 ? prevAttempt : 1) + 1 : 1;
    const number = attempt > 1 ? `CON-${ym}-${attempt}` : `CON-${ym}`;

    const plan = planConsolidatedDocument({
      number,
      ...issueStamp(),
      supplier,
      lines: p.reportable.map((l) => ({ invoiceNumber: l.invoiceNumber, net: l.net, tax: l.tax, rate: l.rate })),
      sequence: p.sequence,
      covered: p.covered,
    });
    if (!plan.ok) return NextResponse.json({ error: plan.error, code: "DOCUMENT_TOO_LARGE" }, { status: 400 });
    const doc = plan.doc;
    if (Math.abs(payableOf(doc) - p.totals.total) > 0.005) {
      return NextResponse.json({ error: "Consolidated total mismatch - not submitted" }, { status: 400 });
    }

    // Claim the month and reserve what this document covers, in one transaction, checked again
    // against the preview (a credit note issued meanwhile changes the amounts).
    const claimAt = new Date();
    const lineIds = p.lines.map((l) => l.orderId);
    const totals = { number, orderCount: p.reportable.length, netAmount: p.totals.net, taxAmount: p.totals.tax, totalAmount: p.totals.total };
    const previous = p.existing
      ? {
          number: p.existing.number, orderCount: p.existing.orderCount, netAmount: p.existing.netAmount, taxAmount: p.existing.taxAmount,
          totalAmount: p.existing.totalAmount,
          // The claim keeps the attempt's system on a record with no UUID (claimData): put it back too.
          eInvoiceEnv: p.existing.eInvoiceEnv,
        }
      : null;
    let record;
    try {
      record = await prisma.$transaction(async (tx) => {
        const cur = await tx.consolidatedInvoice.findUnique({ where: { month } });
        if ((cur?.id ?? null) !== (p.existing?.id ?? null)) throw new Conflict(BUSY);
        if (cur && (isReportedFor(cur, env) || submitGate(cur, claimAt).action !== "go")) throw new Conflict(BUSY);
        const now = await tx.workOrder.findMany({
          where: { id: { in: lineIds } },
          select: { id: true, consolidatedId: true, eInvoiceUuid: true, eInvoiceStatus: true, eInvoiceEnv: true, eInvoiceSubmittingAt: true, totalAmount: true, taxAmount: true },
        });
        // An invoice being sent on its own since the preview (or got no answer) may already be at LHDN.
        if (
          now.length !== lineIds.length ||
          now.some((o) => isReportedFor(o, env) || inFlightFor(o, env, claimAt) || (o.consolidatedId && o.consolidatedId !== cur?.id))
        ) {
          throw new Conflict(CHANGED_SUBMIT);
        }
        const creditNotes = await tx.creditNote.findMany({
          where: { workOrderId: { in: lineIds } },
          select: { id: true, workOrderId: true, amount: true, taxAmount: true, eInvoiceUuid: true, eInvoiceStatus: true, eInvoiceEnv: true, eInvoiceSubmittingAt: true },
        });
        if (creditNotes.some((c) => inFlightFor(c, env, claimAt))) throw new Conflict(CHANGED_SUBMIT);
        if (!consolidationLinesUnchanged(p.lines, now, creditNotes, env)) throw new Conflict(CHANGED_SUBMIT);
        if (cur) {
          // Atomic claim on the existing record (count 1 wins); the earlier, ended UUID stays until LHDN answers.
          // A record with no UUID also keeps the system the attempt goes to (claimData).
          const n = await tx.consolidatedInvoice.updateMany({
            where: { id: cur.id, eInvoiceUuid: cur.eInvoiceUuid, eInvoiceStatus: cur.eInvoiceStatus, eInvoiceSubmittingAt: cur.eInvoiceSubmittingAt },
            data: claimData(cur, claimAt, env),
          });
          if (n.count !== 1) throw new Conflict(BUSY);
          return saveConsolidated(tx, p, month, { ...totals, eInvoiceSubmittingAt: claimAt }, env, CHANGED_SUBMIT);
        }
        return saveConsolidated(tx, p, month, { ...totals, eInvoiceEnv: env, eInvoiceSubmittingAt: claimAt }, env, CHANGED_SUBMIT);
      });
    } catch (e) {
      // Two first submissions at once: the second create hits the unique month / number.
      if ((e as { code?: string })?.code === "P2002") return NextResponse.json({ error: BUSY, code: "SUBMIT_IN_PROGRESS" }, { status: 409 });
      throw e;
    }

    let outcome: "accepted" | "rejected" | "unknown" = "rejected";
    try {
      const r = await submitDocument(doc, number, { env });
      outcome = submitOutcome(r);
      if (outcome === "unknown") {
        await markUnconfirmed("consolidated", record.id, claimAt, env);
        if (actor) await writeAuditLog({ actor, request, action: "MYINVOIS_SUBMISSION_UNCONFIRMED", entityType: "ConsolidatedInvoice", entityId: record.id, summary: `No answer from LHDN for consolidated e-Invoice ${number}`, details: { month, number, orderCount: p.reportable.length, totalAmount: p.totals.total, layout: plan.layout, environment: env, attemptAt: claimAt.toISOString(), previous: p.existing ? { number: p.existing.number, uuid: p.existing.eInvoiceUuid, status: p.existing.eInvoiceStatus, environment: p.existing.eInvoiceEnv } : null } });
        return NextResponse.json({ error: unconfirmedMessage(claimAt), code: "UNCONFIRMED", id: record.id }, { status: 504 });
      }
      if (!r.ok) {
        const fe = friendlyMyInvoisError(r.detail, { httpStatus: r.status, kind: "submit", fallback: "Submission failed" });
        return NextResponse.json({ error: formatFriendlyError(fe), detail: r.detail }, { status: r.status || 502 });
      }
      record = await prisma.consolidatedInvoice.update({
        where: { id: record.id },
        data: {
          eInvoiceUuid: r.uuid,
          eInvoiceLongId: null,
          eInvoiceStatus: "pending",
          eInvoiceEnv: env,
          submissionUid: r.submissionUID,
          eInvoiceSubmittingAt: null,
        },
      });
      if (actor) await writeAuditLog({ actor, request, action: "MYINVOIS_CONSOLIDATED_SUBMITTED", entityType: "ConsolidatedInvoice", entityId: record.id, summary: `Monthly consolidated e-Invoice submitted`, details: { month, number, orderCount: p.reportable.length, totalAmount: p.totals.total, layout: plan.layout, documentBytes: plan.bytes, uuid: r.uuid, environment: env, previous: p.existing ? { number: p.existing.number, uuid: p.existing.eInvoiceUuid, status: p.existing.eInvoiceStatus, environment: p.existing.eInvoiceEnv } : null } });
      return NextResponse.json({ ok: true, id: record.id, number, submissionUID: r.submissionUID, uuid: r.uuid });
    } finally {
      // LHDN said no (or nothing was sent): undo the reservation so the month can be sent again.
      if (outcome === "rejected") await undoReservation(record.id, claimAt, previous);
    }
  } catch (e: unknown) {
    if ((e as Conflict)?.conflict) return NextResponse.json({ error: (e as Conflict).message }, { status: 409 });
    console.error(e);
    return NextResponse.json({ error: (e as Error)?.message || "Failed" }, { status: 500 });
  }
}

/**
 * LHDN refused the consolidated e-Invoice (or nothing was sent): a first attempt is removed with
 * the links it made; a resubmission gets its previous number, totals and system back. Its earlier,
 * ended UUID was never touched. Only while the claim is still ours.
 */
// 【中文】LHDN 拒绝（或根本没送出）：第一次的记录连同预留的发票、退款单一起撤销；重送的恢复原来的单号、金额和 LHDN 系统。
async function undoReservation(
  id: string,
  claimAt: Date,
  previous: { number: string; orderCount: number; netAmount: number; taxAmount: number; totalAmount: number; eInvoiceEnv: string | null } | null
) {
  await prisma.$transaction(async (tx) => {
    const cur = await tx.consolidatedInvoice.findUnique({ where: { id } });
    if (!cur || cur.eInvoiceSubmittingAt?.getTime() !== claimAt.getTime()) return;
    if (!previous) {
      await tx.creditNote.updateMany({ where: { eInvoiceStatus: "consolidated", workOrder: { consolidatedId: id } }, data: { eInvoiceStatus: null } });
      await tx.workOrder.updateMany({ where: { consolidatedId: id }, data: { consolidatedId: null } });
      await tx.consolidatedInvoice.delete({ where: { id } });
      return;
    }
    await tx.consolidatedInvoice.update({ where: { id }, data: { ...previous, eInvoiceSubmittingAt: null } });
  });
}

const CHANGED = "The invoices or credit notes for this month changed since this page was opened. Reload the page, check the list and total, and record it again.";

/**
 * Record a consolidated e-Invoice that the boss submitted in the MyInvois portal (boss only).
 * Submitting to production from this app is blocked until XAdES signing exists, so this is
 * how a real month gets reported. Body: { month, uuid, longId?, number, orderIds, creditNoteIds, total }.
 * - orderIds, creditNoteIds and total must be exactly what the page showed (the current
 *   production preview): a credit note issued meanwhile changes the amounts, so the portal
 *   document would no longer match what is saved. Checked again inside the transaction.
 * - Saved as production / "pending"; Check Status then confirms it with LHDN by UUID.
 * - Refused when a real (production) consolidated e-Invoice is already recorded for the month.
 */
// 【中文】登记老板在 MyInvois 网站上提交的合并电子发票（只限老板）：发票、扣掉的退款单和总额必须和页面显示的完全一样，记为正式环境 / 待确认，同一事务内再核对一次并写审计记录（列出发票号码）。该月已有正式合并发票则拒绝。
export async function PUT(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const actor = await getCurrentUser();
    const body = await request.json().catch(() => ({}));
    const month = String(body?.month || "");
    if (!isValidMonth(month)) {
      return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
    }
    if (month >= currentMonth()) {
      return NextResponse.json({ error: "A month can only be consolidated after it has ended." }, { status: 400 });
    }
    const ref = checkPortalReference(body || {});
    if (!ref.ok) return NextResponse.json({ error: ref.error }, { status: 400 });
    const { uuid, longId, number } = ref.value;

    // A portal submission is a real e-Invoice: build the list the production way.
    const p = await consolidationPreview(month, PRODUCTION);
    if (p.existing && isLiveEInvoice(p.existing)) {
      return NextResponse.json(
        { error: `A real consolidated e-Invoice is already recorded for ${month} (${p.existing.number}, UUID ${p.existing.eInvoiceUuid}). New items for this month need individual e-Invoices.` },
        { status: 409 }
      );
    }
    // A portal record is a real e-Invoice: an unanswered SANDBOX test of the month does not hold it
    // up (same rule as the production preview and saveConsolidated, see inFlightFor).
    // 【中文】网站登记的是正式合并发票：该月沙盒测试没回应不会挡住它（与正式预览同一规则）。
    if (p.existing && inFlightFor(p.existing, PRODUCTION)) {
      return NextResponse.json(
        { error: `A submission of the consolidated e-Invoice for ${month} is running or waiting for LHDN's answer (since ${clock(p.existing.eInvoiceSubmittingAt)}). Press Check Status first.` },
        { status: 409 }
      );
    }
    if (p.blocked.length) return NextResponse.json({ error: blockedMessage(p), code: "INVOICE_SUBMISSION_PENDING" }, { status: 409 });
    if (p.reportable.length === 0) {
      return NextResponse.json({ error: "Nothing to record for this month." }, { status: 400 });
    }
    const lineIds = p.lines.map((l) => l.orderId);
    // Same invoices, same credit notes netted in and same total as the page the boss built it from.
    if (!portalRecordMatches(body, p)) return NextResponse.json({ error: CHANGED }, { status: 409 });
    const clash = await prisma.consolidatedInvoice.findFirst({
      where: { NOT: { month }, OR: [{ number }, { eInvoiceUuid: uuid }] },
      select: { month: true, number: true },
    });
    if (clash) {
      return NextResponse.json(
        { error: `That document number or UUID is already recorded for ${clash.month} (${clash.number}).` },
        { status: 409 }
      );
    }
    // ...nor on an invoice's or credit note's own e-Invoice: that document covers one sale, so
    // linking the whole month to it would count every sale as reported. 【中文】也不能是某张发票或退款单自己的 UUID。
    const holder = await uuidRecordedElsewhere(uuid, { consolidatedMonth: month });
    if (holder) return NextResponse.json({ error: uuidHolderMessage(holder) }, { status: 409 });

    const record = await prisma.$transaction(async (tx) => {
      // Check again inside the transaction: nothing may have changed since the preview.
      const cur = await tx.consolidatedInvoice.findUnique({ where: { month } });
      if ((cur?.id ?? null) !== (p.existing?.id ?? null) || isLiveEInvoice(cur) || (cur && inFlightFor(cur, PRODUCTION))) {
        throw new Conflict(CHANGED);
      }
      const now = await tx.workOrder.findMany({
        where: { id: { in: lineIds } },
        select: { id: true, consolidatedId: true, eInvoiceUuid: true, eInvoiceStatus: true, eInvoiceEnv: true, eInvoiceSubmittingAt: true, totalAmount: true, taxAmount: true },
      });
      if (
        now.length !== lineIds.length ||
        now.some((o) => isLiveEInvoice(o) || inFlightFor(o, PRODUCTION) || (o.consolidatedId && o.consolidatedId !== cur?.id))
      ) {
        throw new Conflict(CHANGED);
      }
      // ...and no credit note was issued (or reported on its own) meanwhile: the amounts are the preview's.
      const creditNotes = await tx.creditNote.findMany({
        where: { workOrderId: { in: lineIds } },
        select: { id: true, workOrderId: true, amount: true, taxAmount: true, eInvoiceUuid: true, eInvoiceStatus: true, eInvoiceEnv: true, eInvoiceSubmittingAt: true },
      });
      if (creditNotes.some((c) => inFlightFor(c, PRODUCTION))) throw new Conflict(CHANGED);
      if (!consolidationLinesUnchanged(p.lines, now, creditNotes, PRODUCTION)) throw new Conflict(CHANGED);
      return saveConsolidated(tx, p, month, {
        number,
        orderCount: p.reportable.length,
        netAmount: p.totals.net,
        taxAmount: p.totals.tax,
        totalAmount: p.totals.total,
        eInvoiceUuid: uuid,
        eInvoiceLongId: longId,
        eInvoiceStatus: "pending",
        eInvoiceEnv: PRODUCTION,
        submissionUid: null, // portal submission: checked by UUID
        eInvoiceSubmittingAt: null,
      }, PRODUCTION, CHANGED);
    });

    if (actor) {
      // Audit details are capped at 4000 characters: long invoice lists go in follow-up parts.
      const parts = chunkForAudit(p.lines.map((l) => l.invoiceNumber));
      for (let i = 0; i < parts.length; i++) {
        await writeAuditLog({
          actor, request, action: "MYINVOIS_CONSOLIDATED_RECORDED", entityType: "ConsolidatedInvoice", entityId: record.id,
          summary: i === 0
            ? `Consolidated e-Invoice for ${month} recorded from the MyInvois portal`
            : `Consolidated e-Invoice for ${month}: invoice list part ${i + 1}/${parts.length}`,
          details: i === 0
            ? {
                month, number, uuid, longId, environment: PRODUCTION, status: "pending",
                orderCount: p.reportable.length, netAmount: p.totals.net, taxAmount: p.totals.tax, totalAmount: p.totals.total,
                creditNotesNetted: p.lines.reduce((n, l) => n + l.creditNoteIds.length, 0),
                individualIncluded: p.individualDue.filter((d) => d.included).length,
                previous: p.existing
                  ? { number: p.existing.number, uuid: p.existing.eInvoiceUuid, status: p.existing.eInvoiceStatus, environment: p.existing.eInvoiceEnv }
                  : null,
                part: `1/${parts.length}`, invoiceNumbers: parts[0],
              }
            : { month, number, part: `${i + 1}/${parts.length}`, invoiceNumbers: parts[i] },
        });
      }
    }
    return NextResponse.json({ ok: true, id: record.id, number, uuid });
  } catch (e: unknown) {
    if ((e as Conflict)?.conflict) return NextResponse.json({ error: (e as Conflict).message }, { status: 409 });
    console.error(e);
    return NextResponse.json({ error: (e as Error)?.message || "Failed" }, { status: 500 });
  }
}
