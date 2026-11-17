import { NextResponse } from "next/server";
import { requireAuth, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getMyInvoisConfig,
  buildInvoiceJson,
  supplierFromShop,
  submitDocument,
  payableOf,
  issueStamp,
  buyerForOrder,
  buyerProblem,
} from "@/lib/myinvois";
import { friendlyMyInvoisError, formatFriendlyError } from "@/lib/myinvois-errors";
import { writeAuditLog } from "@/lib/audit";
import { envFromSandboxFlag, isReportedFor } from "@/lib/einvoice-state.mjs";
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

const SIGNATURE_NOTE =
  "MyInvois may require a digitally signed document. If you see a signature error, you need a Malaysian digital certificate to sign the invoice before submission.";

const BUSY = "This invoice is already being sent to LHDN (from another click or device). Wait a minute, then press Check Status.";
const BUYER_CHANGED = "The buyer details of this invoice were changed while it was being prepared. Nothing was sent. Check them and submit again.";
const IN_CONSOLIDATED = "This invoice was already reported in a monthly consolidated e-Invoice.";
const CONSOLIDATED_PENDING =
  "The monthly consolidated e-Invoice that includes this invoice is being sent or waiting for LHDN's answer. Check its status on the e-Invoice page first.";

/**
 * The monthly consolidated e-Invoice this invoice is linked to already reports it, or is being
 * sent / waiting for LHDN's answer: then the invoice must not be sent on its own.
 */
// 【中文】这张发票所在的合并电子发票已申报，或正在送 / 在等 LHDN 回应：不能再单独送。
async function consolidatedRefusal(consolidatedId: string | null, env: "sandbox" | "production") {
  if (!consolidatedId) return null;
  const con = await prisma.consolidatedInvoice.findUnique({ where: { id: consolidatedId } });
  if (!con || isReportedFor(con, env)) return IN_CONSOLIDATED;
  if (submitGate(con).action !== "go") return CONSOLIDATED_PENDING;
  return null;
}

/**
 * Submit one invoice to LHDN as an individual e-Invoice (buyer asked for one).
 * Sent at most once: the invoice is claimed atomically before sending, the call waits at most
 * 30 seconds, and a submission LHDN did not answer is kept as "unconfirmed" until LHDN shows
 * whether it arrived (einvoice2-submit.mjs).
 */
// 【中文】把一张发票单独送 LHDN。只送一次：送出前原子占位，最多等 30 秒；LHDN 没回应的记为"未确认"，确认 LHDN 有没有收到之前不能再送。
export async function POST(request: Request) {
  const __denied = await requireAuth();
  if (__denied) return __denied;
  try {
    const actor = await getCurrentUser();
    const { orderId } = await request.json();
    if (!orderId) return NextResponse.json({ error: "orderId required" }, { status: 400 });

    let order = await prisma.workOrder.findUnique({
      where: { id: orderId },
      include: { customer: true, items: true },
    });
    if (!order || !order.invoiceNumber) {
      return NextResponse.json({ error: "Invoice not generated yet" }, { status: 400 });
    }
    if (order.status === "CANCELLED") {
      return NextResponse.json({ error: "Cancelled work order cannot be submitted" }, { status: 400 });
    }
    const invoiceNumber = order.invoiceNumber;
    const { shop } = await getMyInvoisConfig();
    const env = envFromSandboxFlag(shop.myInvoisSandbox);
    // In a consolidated e-Invoice that reports it, or one being sent / waiting for LHDN's answer.
    const conRefusal = await consolidatedRefusal(order.consolidatedId, env);
    if (conRefusal) return NextResponse.json({ error: conRefusal }, { status: 409 });
    // Prevent double submission (a resubmit is only allowed if LHDN rejected / cancelled it).
    // A real e-Invoice always blocks; a sandbox test only blocks another sandbox test.
    if (isReportedFor(order, env)) {
      return NextResponse.json(
        { error: `Already submitted to LHDN ${order.eInvoiceEnv || "production"} (UUID ${order.eInvoiceUuid}, status ${order.eInvoiceStatus || "pending"}).` },
        { status: 409 }
      );
    }

    // Production API submission requires an approved Malaysian X.509 certificate and XAdES signature.
    // This build has no certificate-backed signing implementation; fail closed instead of sending unsigned documents.
    if (!shop.myInvoisSandbox) {
      return NextResponse.json(
        { error: "Production MyInvois submission is disabled until XAdES digital signing is implemented and verified with your organisation certificate.", code: "PRODUCTION_SIGNING_NOT_AVAILABLE" },
        { status: 501 }
      );
    }
    const { supplier, missing } = supplierFromShop(shop);
    if (missing.length) {
      return NextResponse.json({ error: `Fill in Settings → Shop first: ${missing.join(", ")}` }, { status: 400 });
    }

    // QR / staff buyer details, else the buyer frozen on the invoice: the same buyer the printed
    // invoice shows (docdata.ts uses the same rule). Its TIN / ID pair and phone are checked first.
    // Built again from the fresh read below (the one sent), so a buyer saved meanwhile is the one LHDN gets.
    // 【中文】先检查一次（尽早报错），下面重新读取后再按最新资料生成要送出的文件。
    const build = (o: NonNullable<typeof order>) => {
      const buyer = buyerForOrder(o);
      const problem = buyerProblem(buyer);
      if (problem) return { error: problem } as const;
      const doc = buildInvoiceJson({
        invoiceNumber,
        ...issueStamp(),
        supplier,
        customer: buyer,
        lines: o.items.map((i) => ({
          description: i.description,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          total: i.total,
          type: i.type,
        })),
        discount: o.discount,
        taxRate: o.taxRate,
        taxScope: o.taxScope,
        // An invoice issued under v0.3.29 or earlier is rebuilt with that version's rounding.
        issuedTax: o.taxAmount,
      });
      // Safety net: never send LHDN a total different from the printed invoice.
      if (Math.abs(payableOf(doc) - o.totalAmount) > 0.005) {
        return { error: `e-Invoice total RM ${payableOf(doc).toFixed(2)} does not match invoice RM ${o.totalAmount.toFixed(2)}` } as const;
      }
      return { buyer, doc } as const;
    };
    const first = build(order);
    if ("error" in first) return NextResponse.json({ error: first.error }, { status: 400 });

    // An earlier submission still running, or one LHDN never answered: settle it first.
    const blocked = await checkBeforeSubmit({ kind: "order", rec: order, number: invoiceNumber, env, actor, request });
    if (blocked) return NextResponse.json({ error: blocked.error, code: blocked.code }, { status: blocked.status });
    order = (await prisma.workOrder.findUnique({ where: { id: orderId }, include: { customer: true, items: true } }))!;
    if (isReportedFor(order, env)) {
      return NextResponse.json(
        { error: `Already submitted to LHDN ${order.eInvoiceEnv || "production"} (UUID ${order.eInvoiceUuid}, status ${order.eInvoiceStatus || "pending"}).` },
        { status: 409 }
      );
    }
    const gate = submitGate(order);
    if (gate.action === "wait") return NextResponse.json({ error: inFlightMessage(gate.until), code: "SUBMIT_IN_PROGRESS" }, { status: 409 });
    // Checked again on the fresh read: a consolidated e-Invoice may have taken the invoice in meanwhile.
    const conAgain = await consolidatedRefusal(order.consolidatedId, env);
    if (conAgain) return NextResponse.json({ error: conAgain }, { status: 409 });
    // The document LHDN gets is built from this fresh read; the claim below also pins the buyer
    // (buyerRequestedAt changes on every buyer save), so the stored buyer is the one sent.
    // 【中文】按重新读取的资料生成要送出的文件；占位时也锁定买方（每次保存买方 buyerRequestedAt 都会变）。
    const built = build(order);
    if ("error" in built) return NextResponse.json({ error: built.error }, { status: 400 });
    const { buyer, doc } = built;

    // Claim the invoice: a second click / device finds the claim and is refused. The link to a
    // consolidated e-Invoice must still be as read (a consolidated e-Invoice that reserved the
    // invoice after this read makes the claim fail).
    const claimAt = new Date();
    if (!(await claimSubmission("order", order, claimAt, env, { consolidatedId: order.consolidatedId ?? null, buyerRequestedAt: order.buyerRequestedAt ?? null }))) {
      const now = await prisma.workOrder.findUnique({ where: { id: orderId }, select: { consolidatedId: true, buyerRequestedAt: true } });
      const why = (now?.consolidatedId ?? null) !== (order.consolidatedId ?? null) ? await consolidatedRefusal(now?.consolidatedId ?? null, env) : null;
      if (!why && (now?.buyerRequestedAt?.getTime() ?? null) !== (order.buyerRequestedAt?.getTime() ?? null)) {
        return NextResponse.json({ error: BUYER_CHANGED }, { status: 409 });
      }
      return NextResponse.json({ error: why || BUSY, code: why ? undefined : "SUBMIT_IN_PROGRESS" }, { status: 409 });
    }
    // And once more after the claim: a consolidated e-Invoice (re)submitted with this invoice
    // between the read and the claim keeps its link unchanged, so it is checked here. The
    // consolidated side refuses invoices that hold a claim, so one of the two always backs off.
    // 【中文】占位后再查一次合并发票：期间合并发票（重送时链接不变）已把它收进去，就放弃单独提交；合并发票那边也会拒绝已占位的发票。
    const conAfterClaim = await consolidatedRefusal(order.consolidatedId, env);
    if (conAfterClaim) {
      await releaseClaim("order", orderId, claimAt, order);
      return NextResponse.json({ error: conAfterClaim }, { status: 409 });
    }
    let outcome: "accepted" | "rejected" | "unknown" = "rejected";
    try {
      const r = await submitDocument(doc, invoiceNumber, { env });
      outcome = submitOutcome(r);
      if (outcome === "unknown") {
        await markUnconfirmed("order", orderId, claimAt, env);
        if (actor) await writeAuditLog({ actor, request, action: "MYINVOIS_SUBMISSION_UNCONFIRMED", entityType: "WorkOrder", entityId: orderId, summary: `No answer from LHDN for invoice ${invoiceNumber}`, details: { invoiceNumber, environment: env, attemptAt: claimAt.toISOString(), previous: order.eInvoiceUuid ? { uuid: order.eInvoiceUuid, status: order.eInvoiceStatus, environment: order.eInvoiceEnv } : null } });
        return NextResponse.json({ error: unconfirmedMessage(claimAt), code: "UNCONFIRMED" }, { status: 504 });
      }
      if (!r.ok) {
        const fe = friendlyMyInvoisError(r.detail, { httpStatus: r.status, kind: "submit", fallback: "Submission failed" });
        return NextResponse.json(
          {
            error: formatFriendlyError(fe),
            messageZh: fe.messageZh,
            detail: r.detail,
            note: SIGNATURE_NOTE,
          },
          { status: r.status || 502 }
        );
      }
      // Its own e-Invoice now reports the sale: a link to a consolidated record that does not
      // report it (checked after the claim) ends, and credit notes netted into that record are
      // unreported again, so they can be sent on their own (as save_einvoice does).
      // 【中文】单独的电子发票已被接受：解除与没申报它的合并发票的关联，原先并入其中的退款单恢复为未申报，之后可以单独送。
      const unlinkedConsolidatedId = order.consolidatedId ?? null;
      await prisma.$transaction(async (tx) => {
        if (unlinkedConsolidatedId) {
          await tx.creditNote.updateMany({
            where: { workOrderId: orderId, eInvoiceStatus: "consolidated" },
            data: { eInvoiceStatus: null },
          });
        }
        await tx.workOrder.update({
          where: { id: orderId },
          data: {
            eInvoiceUuid: r.uuid,
            eInvoiceLongId: null,
            eInvoiceStatus: "pending",
            eInvoiceEnv: env,
            submissionUid: r.submissionUID || null,
            eInvoiceSubmittingAt: null,
            ...(unlinkedConsolidatedId ? { consolidatedId: null } : {}),
          },
        });
      });
      if (actor) await writeAuditLog({ actor, request, action: "MYINVOIS_INVOICE_SUBMITTED", entityType: "WorkOrder", entityId: orderId, summary: `Invoice submitted to MyInvois`, details: { invoiceNumber, uuid: r.uuid, environment: env, buyerSource: buyer.source ?? null, previous: order.eInvoiceUuid ? { uuid: order.eInvoiceUuid, status: order.eInvoiceStatus, environment: order.eInvoiceEnv } : null, ...(unlinkedConsolidatedId ? { unlinkedConsolidatedId } : {}) } });
      return NextResponse.json({
        ok: true,
        submissionUID: r.submissionUID,
        uuid: r.uuid,
        message: "Submitted. Check status in a few seconds for Long ID.",
      });
    } finally {
      // LHDN answered "no" (or nothing was sent): free the invoice for a corrected submission.
      if (outcome === "rejected") await releaseClaim("order", orderId, claimAt, order);
    }
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: (e instanceof Error && e.message) || "Failed" }, { status: 500 });
  }
}
