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
} from "@/lib/myinvois";
import { friendlyMyInvoisError, formatFriendlyError } from "@/lib/myinvois-errors";
import { writeAuditLog } from "@/lib/audit";
import { validateMyInvoisBuyer } from "@/lib/myinvois-buyer-core.mjs";
import { writeEInvoiceSubmissionLog } from "@/lib/myinvois-log";

export const dynamic = "force-dynamic";

const SIGNATURE_NOTE =
  "MyInvois may require a digitally signed document. If you see a signature error, you need a Malaysian digital certificate to sign the invoice before submission.";

/** Submit one invoice to LHDN as an individual e-Invoice (buyer asked for one). */
export async function POST(request: Request) {
  const __denied = await requireAuth();
  if (__denied) return __denied;
  try {
    const actor = await getCurrentUser();
    const { orderId } = await request.json();
    if (!orderId) return NextResponse.json({ error: "orderId required" }, { status: 400 });

    const order = await prisma.workOrder.findUnique({
      where: { id: orderId },
      include: { customer: true, items: true },
    });
    if (!order || !order.invoiceNumber) {
      return NextResponse.json({ error: "Invoice not generated yet" }, { status: 400 });
    }
    if (order.status === "CANCELLED") {
      return NextResponse.json({ error: "Cancelled work order cannot be submitted" }, { status: 400 });
    }
    if (order.consolidatedId) {
      return NextResponse.json(
        { error: "This invoice was already reported in a monthly consolidated e-Invoice." },
        { status: 409 }
      );
    }
    // Prevent double submission (a resubmit is only allowed if LHDN rejected / cancelled it).
    if (order.eInvoiceUuid && !["invalid", "cancelled"].includes((order.eInvoiceStatus || "").toLowerCase())) {
      return NextResponse.json(
        { error: `Already submitted to LHDN (UUID ${order.eInvoiceUuid}, status ${order.eInvoiceStatus || "pending"}).` },
        { status: 409 }
      );
    }

    const { shop } = await getMyInvoisConfig();
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

    // Defense in depth: validate at the submission boundary and again in the UBL builder.
    const buyer = buyerForOrder(order);
    const buyerValidation = validateMyInvoisBuyer(buyer as unknown as Record<string, unknown>);
    if (!buyerValidation.ok) {
      if (actor) await writeAuditLog({
        actor, request, action: "MYINVOIS_BUYER_VALIDATION_FAILED",
        entityType: "WorkOrder", entityId: order.id,
        summary: "Individual e-Invoice blocked by buyer validation",
        details: { errorFields: Object.keys(buyerValidation.errors) },
      });
      return NextResponse.json(
        {
          error: "Buyer details are incomplete or invalid for an individual e-Invoice. Do not submit a walk-in / General Public invoice individually.",
          messageZh: "普通个人电子发票必须有完整且有效的顾客资料。没有要求个人电子发票的普通散客，请通过 Monthly Consolidated e-Invoice 合并申报。",
          code: "BUYER_DETAILS_INVALID",
          fields: buyerValidation.errors,
        },
        { status: 400 }
      );
    }

    const doc = buildInvoiceJson({
      invoiceNumber: order.invoiceNumber,
      ...issueStamp(),
      supplier,
      customer: buyer, // validated customer details from the QR request
      lines: order.items.map((i) => ({
        description: i.description,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        total: i.total,
        type: i.type,
      })),
      discount: order.discount,
      taxRate: order.taxRate,
      taxScope: order.taxScope,
    });
    // Safety net: never send LHDN a total different from the printed invoice.
    if (Math.abs(payableOf(doc) - order.totalAmount) > 0.005) {
      return NextResponse.json(
        { error: `e-Invoice total RM ${payableOf(doc).toFixed(2)} does not match invoice RM ${order.totalAmount.toFixed(2)}` },
        { status: 400 }
      );
    }

    const r = await submitDocument(doc, order.invoiceNumber);
    if (!r.ok) {
      await writeEInvoiceSubmissionLog({ documentType: "INVOICE", documentNumber: order.invoiceNumber, entityId: order.id, status: "rejected", environment: shop.myInvoisSandbox ? "SANDBOX" : "PRODUCTION", detail: r.detail });
      const fe = friendlyMyInvoisError(r.detail, { httpStatus: r.status, kind: "submit", fallback: "Submission failed" });
      return NextResponse.json(
        {
          error: formatFriendlyError(fe),
          messageZh: fe.messageZh,
          detail: r.detail,
          note: SIGNATURE_NOTE,
        },
        { status: r.status }
      );
    }
    await writeEInvoiceSubmissionLog({ documentType: "INVOICE", documentNumber: order.invoiceNumber, entityId: order.id, submissionUid: r.submissionUID, uuid: r.uuid, status: "pending", environment: shop.myInvoisSandbox ? "SANDBOX" : "PRODUCTION" });
    await prisma.workOrder.update({
      where: { id: orderId },
      data: {
        eInvoiceUuid: r.uuid,
        eInvoiceLongId: null,
        eInvoiceStatus: "pending",
        submissionUid: r.submissionUID || null,
      },
    });
    if (actor) await writeAuditLog({ actor, request, action: "MYINVOIS_INVOICE_SUBMITTED", entityType: "WorkOrder", entityId: orderId, summary: `Invoice submitted to MyInvois`, details: { invoiceNumber: order.invoiceNumber, uuid: r.uuid, environment: shop.myInvoisSandbox ? "sandbox" : "production" } });
    return NextResponse.json({
      ok: true,
      submissionUID: r.submissionUID,
      uuid: r.uuid,
      message: "Submitted. Check status in a few seconds for Long ID.",
    });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
