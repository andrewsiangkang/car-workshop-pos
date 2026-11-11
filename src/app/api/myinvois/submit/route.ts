import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAccessToken, getMyInvoisConfig, buildInvoiceJson, documentHashAndBase64 } from "@/lib/myinvois";

export const dynamic = "force-dynamic";

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

    const { shop, base } = await getMyInvoisConfig();
    if (!shop.tin) return NextResponse.json({ error: "Shop TIN not set in Settings" }, { status: 400 });

    const token = await getAccessToken();

    const now = new Date();
    const issueDate = now.toISOString().slice(0, 10);
    const issueTime = now.toISOString().slice(11, 19) + "Z";

    const doc = buildInvoiceJson({
      invoiceNumber: order.invoiceNumber,
      issueDate,
      issueTime,
      supplier: {
        name: shop.name,
        tin: shop.tin,
        brn: shop.brn || "NA",
        msic: shop.msicCode || "45201",
        msicDesc: shop.msicDesc || "Maintenance and repair of motor vehicles",
        phone: shop.phone || "NA",
        address: shop.address || "NA",
      },
      customer: {
        name: order.customer?.name || "General Public",
        tin: order.customer?.tin,
        phone: order.customer?.phone,
      },
      lines: order.items.map((i) => ({
        description: i.description,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        total: i.total,
      })),
      total: order.totalAmount,
    });

    const { hash, b64 } = documentHashAndBase64(doc);

    const submitBody = {
      documents: [{
        format: "JSON",
        document: b64,
        documentHash: hash,
        codeNumber: order.invoiceNumber,
      }],
    };

    const res = await fetch(`${base}/api/v1.0/documentsubmissions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(submitBody),
    });

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json({
        error: "Submission failed",
        detail: data,
        note: "MyInvois requires a digitally signed document. If you see a signature error, you need a Malaysian digital certificate (P12) to sign the invoice before submission.",
      }, { status: res.status });
    }

    const accepted = data.acceptedDocuments?.[0];
    if (accepted?.uuid) {
      await prisma.workOrder.update({
        where: { id: orderId },
        data: {
          eInvoiceUuid: accepted.uuid,
          eInvoiceStatus: "pending",
        },
      });
    }

    return NextResponse.json({
      ok: true,
      submissionUID: data.submissionUID,
      uuid: accepted?.uuid,
      message: "Submitted. Check status in a few seconds for Long ID.",
      raw: data,
    });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
