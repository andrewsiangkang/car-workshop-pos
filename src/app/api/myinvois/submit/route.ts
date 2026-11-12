import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
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

export const dynamic = "force-dynamic";

const SIGNATURE_NOTE =
  "MyInvois may require a digitally signed document. If you see a signature error, you need a Malaysian digital certificate to sign the invoice before submission.";

/** Submit one invoice to LHDN as an individual e-Invoice (buyer asked for one). */
export async function POST(request: Request) {
  const __denied = await requireAuth();
  if (__denied) return __denied;
  try {
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
    const { supplier, missing } = supplierFromShop(shop);
    if (missing.length) {
      return NextResponse.json({ error: `Fill in Settings → Shop first: ${missing.join(", ")}` }, { status: 400 });
    }

    const doc = buildInvoiceJson({
      invoiceNumber: order.invoiceNumber,
      ...issueStamp(),
      supplier,
      customer: buyerForOrder(order), // the customer's own details if they sent them by QR
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
      return NextResponse.json({ error: "Submission failed", detail: r.detail, note: SIGNATURE_NOTE }, { status: r.status });
    }
    await prisma.workOrder.update({
      where: { id: orderId },
      data: { eInvoiceUuid: r.uuid, eInvoiceLongId: null, eInvoiceStatus: "pending" },
    });
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
