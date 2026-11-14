import { NextResponse } from "next/server";
import { requireOwner, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import {
  getMyInvoisConfig,
  buildCreditNoteJson,
  supplierFromShop,
  submitDocument,
  payableOf,
  issueStamp,
  buyerForCreditNote,
  buyerProblem,
} from "@/lib/myinvois";
import { friendlyMyInvoisError, formatFriendlyError } from "@/lib/myinvois-errors";
import { envFromSandboxFlag, isNettedInConsolidation, isReportedFor } from "@/lib/einvoice-state.mjs";
import { buyerEditLock, creditNoteReference, creditNoteSeller, parseDocSnapshot } from "@/lib/doc-snapshot.mjs";
import { buyerParty } from "@/lib/einvoice2-ids.mjs";
import { creditNoteDocType } from "@/lib/einvoice-rules.mjs";
import { submitGate, submitOutcome } from "@/lib/einvoice2-submit.mjs";
import {
  checkBeforeSubmit,
  claimSubmission,
  inFlightMessage,
  markUnconfirmed,
  releaseClaim,
  unconfirmedMessage,
} from "@/lib/einvoice2-guard";

export const dynamic = "force-dynamic";

const PARTIAL_REFUND =
  "Part of this credit note was refunded and part was not. LHDN has two document types for this: a credit note " +
  "(value reduced, no money back) and a refund note (money returned), so one document cannot carry both. Nothing was sent. " +
  "Issue the refunded part and the non-refunded part as two separate credit notes instead.";

const BUSY = "This credit note is already being sent to LHDN (from another click or device). Wait a minute, then press Check Status.";

// The buyer has a TIN but no (valid) ID number, and the invoice's e-Invoice is already at LHDN, so
// staff cannot fix the buyer any more (save_buyer is locked): pointing them there was a dead end.
// 【中文】买方有 TIN 却没有（合格的）证件号码，而发票的电子发票已在 LHDN，买方资料已锁定不能再改，只能在 MyInvois 网站开退款单。
const BUYER_ID_LOCKED =
  "The buyer on this invoice has no valid ID number on record (NRIC, BRN, passport or army ID), and the invoice's e-Invoice is already at LHDN, " +
  "so its buyer can no longer be changed here. Nothing was sent. Issue this credit note in the MyInvois portal instead, with the same buyer as the e-Invoice.";

/**
 * Submit a credit note to LHDN. It must refer to the e-Invoice that reported the original sale:
 * the invoice's own e-Invoice, or the monthly consolidated e-Invoice that included it.
 * Document type (LHDN e-Invoice Guideline; confirm with your tax agent): no money returned →
 * 02 credit note; the whole credited value returned → 04 refund note; a partial refund is
 * refused (issue two credit notes). Sent at most once, like invoices (einvoice2-submit.mjs).
 */
// 【中文】把退款单送 LHDN：没退钱 → 02 贷项通知；全部退回 → 04 退款单；只退一部分 → 拒绝（请开两张退款单）。只送一次。
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const { id } = await params;
    const actor = await getCurrentUser();
    const load = () =>
      prisma.creditNote.findUnique({
        where: { id },
        include: { workOrder: { include: { customer: true } }, lines: { orderBy: { id: "asc" } } },
      });
    let cn = await load();
    if (!cn) return NextResponse.json({ error: "Credit note not found" }, { status: 404 });
    if (isNettedInConsolidation(cn)) {
      return NextResponse.json(
        { error: "This credit note was already netted into the monthly consolidated e-Invoice. Nothing to submit." },
        { status: 409 }
      );
    }

    const { shop } = await getMyInvoisConfig();
    const env = envFromSandboxFlag(shop.myInvoisSandbox);
    // A real e-Invoice always blocks; a sandbox test only blocks another sandbox test.
    if (isReportedFor(cn, env)) {
      return NextResponse.json({ error: `Already submitted (UUID ${cn.eInvoiceUuid})` }, { status: 409 });
    }

    // Credit note (02) or refund note (04): a partial refund cannot be sent as either.
    const o = cn.workOrder;
    const docType = creditNoteDocType({ amount: cn.amount, refundAmount: cn.refundAmount, roundingAdjustment: o.roundingAdjustment });
    if (!docType.ok) return NextResponse.json({ error: PARTIAL_REFUND, code: "PARTIAL_REFUND" }, { status: 400 });

    // The credit note must refer to an e-Invoice in the SAME LHDN system (sandbox or production):
    // the invoice's own, else the consolidated one that reported it. The printed credit note uses
    // the same rule (creditNoteReference), so both name the same buyer: the invoice's buyer, or
    // General Public on the consolidated path.
    const con = o.consolidatedId ? await prisma.consolidatedInvoice.findUnique({ where: { id: o.consolidatedId } }) : null;
    const reference = creditNoteReference({ creditNote: cn, order: o, consolidated: con, env });
    if (!reference) {
      return NextResponse.json(
        {
          error:
            "The original invoice has not been reported to LHDN yet. Either submit the invoice's e-Invoice first, " +
            "or leave it: this credit note will be netted off in the monthly consolidated e-Invoice.",
        },
        { status: 400 }
      );
    }

    if (!shop.myInvoisSandbox) {
      return NextResponse.json({ error: "Production MyInvois submission is disabled until XAdES digital signing is implemented and verified with your organisation certificate.", code: "PRODUCTION_SIGNING_NOT_AVAILABLE" }, { status: 501 });
    }
    // SST credited here was charged under the SST number printed on the credit note (the
    // invoice's one, see creditNoteSeller), so LHDN gets that number, not today's Settings.
    const printedSeller =
      parseDocSnapshot(cn.docSnapshot)?.seller ??
      creditNoteSeller({ shop, invoice: parseDocSnapshot(o.docSnapshot), taxAmount: cn.taxAmount });
    const { supplier, missing } = supplierFromShop(cn.taxAmount > 0 ? { ...shop, sstNumber: printedSeller.sstNumber } : shop);
    if (missing.length) {
      return NextResponse.json({ error: `Fill in Settings → Shop first: ${missing.join(", ")}` }, { status: 400 });
    }
    // Same buyer as the e-Invoice referred to AND as the printed credit note (one shared rule).
    const customer = buyerForCreditNote(cn, o, reference.via);
    const problem = buyerProblem(customer, { allowGeneralPublic: reference.via === "consolidated" });
    if (problem) {
      const party = buyerParty(customer);
      if (!party.ok && party.field === "idNo" && reference.via === "invoice" && buyerEditLock(o, con)) {
        return NextResponse.json({ error: BUYER_ID_LOCKED, code: "BUYER_ID_LOCKED" }, { status: 400 });
      }
      return NextResponse.json({ error: problem }, { status: 400 });
    }

    const doc = buildCreditNoteJson({
      typeCode: docType.type,
      number: cn.number,
      ...issueStamp(),
      supplier,
      customer,
      originalInvoiceNumber: o.invoiceNumber || "",
      reference: { number: reference.number, uuid: reference.uuid },
      reason: cn.reason,
      amount: cn.amount,
      taxAmount: cn.taxAmount,
      taxRate: o.taxRate,
      lines: cn.lines,
      consolidated: reference.via === "consolidated",
    });
    if (Math.abs(payableOf(doc) - cn.amount) > 0.005) {
      return NextResponse.json({ error: "Credit note total mismatch - not submitted" }, { status: 400 });
    }

    // An earlier submission still running, or one LHDN never answered: settle it first.
    const blocked = await checkBeforeSubmit({ kind: "creditNote", rec: cn, number: cn.number, env, actor, request });
    if (blocked) return NextResponse.json({ error: blocked.error, code: blocked.code }, { status: blocked.status });
    cn = (await load())!;
    if (isReportedFor(cn, env)) return NextResponse.json({ error: `Already submitted (UUID ${cn.eInvoiceUuid})` }, { status: 409 });
    const gate = submitGate(cn);
    if (gate.action === "wait") return NextResponse.json({ error: inFlightMessage(gate.until), code: "SUBMIT_IN_PROGRESS" }, { status: 409 });

    const claimAt = new Date();
    if (!(await claimSubmission("creditNote", cn, claimAt, env))) {
      return NextResponse.json({ error: BUSY, code: "SUBMIT_IN_PROGRESS" }, { status: 409 });
    }
    let outcome: "accepted" | "rejected" | "unknown" = "rejected";
    try {
      const r = await submitDocument(doc, cn.number, { env });
      outcome = submitOutcome(r);
      if (outcome === "unknown") {
        await markUnconfirmed("creditNote", id, claimAt, env, { eInvoiceType: docType.type });
        if (actor) await writeAuditLog({ actor, request, action: "MYINVOIS_SUBMISSION_UNCONFIRMED", entityType: "CreditNote", entityId: id, summary: `No answer from LHDN for credit note ${cn.number}`, details: { creditNoteNumber: cn.number, documentType: docType.type, environment: env, attemptAt: claimAt.toISOString(), previous: cn.eInvoiceUuid ? { uuid: cn.eInvoiceUuid, status: cn.eInvoiceStatus, environment: cn.eInvoiceEnv } : null } });
        return NextResponse.json({ error: unconfirmedMessage(claimAt), code: "UNCONFIRMED" }, { status: 504 });
      }
      if (!r.ok) {
        const fe = friendlyMyInvoisError(r.detail, { httpStatus: r.status, kind: "submit", fallback: "Submission failed" });
        return NextResponse.json({ error: formatFriendlyError(fe), messageZh: fe.messageZh, detail: r.detail }, { status: r.status || 502 });
      }
      await prisma.creditNote.update({
        where: { id },
        data: {
          eInvoiceUuid: r.uuid,
          eInvoiceLongId: null,
          eInvoiceStatus: "pending",
          eInvoiceEnv: env,
          eInvoiceType: docType.type,
          submissionUid: r.submissionUID,
          eInvoiceSubmittingAt: null,
        },
      });
      if (actor) await writeAuditLog({ actor, request, action: "MYINVOIS_CREDIT_NOTE_SUBMITTED", entityType: "CreditNote", entityId: id, summary: `${docType.type === "04" ? "Refund note" : "Credit note"} submitted to MyInvois`, details: { creditNoteNumber: cn.number, documentType: docType.type, uuid: r.uuid, environment: env, reference: reference.number, referenceType: reference.via, buyerSource: customer.source ?? "general_public", supplierSst: supplier.sst, previous: cn.eInvoiceUuid ? { uuid: cn.eInvoiceUuid, status: cn.eInvoiceStatus, environment: cn.eInvoiceEnv, type: cn.eInvoiceType } : null } });
      return NextResponse.json({ ok: true, submissionUID: r.submissionUID, uuid: r.uuid, documentType: docType.type });
    } finally {
      if (outcome === "rejected") await releaseClaim("creditNote", id, claimAt, cn);
    }
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: (e instanceof Error && e.message) || "Failed" }, { status: 500 });
  }
}
