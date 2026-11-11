import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getMyInvoisConfig,
  buildCreditNoteJson,
  supplierFromShop,
  submitDocument,
  payableOf,
  issueStamp,
} from "@/lib/myinvois";

export const dynamic = "force-dynamic";

const isLive = (s: string | null | undefined) => !["invalid", "cancelled", "consolidated"].includes((s || "").toLowerCase());

/**
 * Submit a credit note to LHDN (type 02). It must refer to the e-Invoice that
 * reported the original sale: the invoice's own e-Invoice, or the monthly
 * consolidated e-Invoice that included it.
 */
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const { id } = await params;
    const cn = await prisma.creditNote.findUnique({
      where: { id },
      include: { workOrder: { include: { customer: true } } },
    });
    if (!cn) return NextResponse.json({ error: "Credit note not found" }, { status: 404 });
    if (cn.eInvoiceUuid && isLive(cn.eInvoiceStatus)) {
      return NextResponse.json({ error: `Already submitted (UUID ${cn.eInvoiceUuid})` }, { status: 409 });
    }
    if ((cn.eInvoiceStatus || "") === "consolidated") {
      return NextResponse.json(
        { error: "This credit note was already netted into the monthly consolidated e-Invoice. Nothing to submit." },
        { status: 409 }
      );
    }

    const o = cn.workOrder;
    let reference: { number: string; uuid: string } | null = null;
    let customer: { name: string; tin: string | null; phone: string | null } = {
      name: o.customer?.name || "General Public",
      tin: o.customer?.tin ?? null,
      phone: o.customer?.phone ?? null,
    };
    if (o.eInvoiceUuid && isLive(o.eInvoiceStatus) && o.invoiceNumber) {
      reference = { number: o.invoiceNumber, uuid: o.eInvoiceUuid };
    } else if (o.consolidatedId) {
      const con = await prisma.consolidatedInvoice.findUnique({ where: { id: o.consolidatedId } });
      if (con?.eInvoiceUuid && isLive(con.eInvoiceStatus)) {
        reference = { number: con.number, uuid: con.eInvoiceUuid };
        customer = { name: "General Public", tin: null, phone: null };
      }
    }
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

    const { shop } = await getMyInvoisConfig();
    const { supplier, missing } = supplierFromShop(shop);
    if (missing.length) {
      return NextResponse.json({ error: `Fill in Settings → Shop first: ${missing.join(", ")}` }, { status: 400 });
    }

    const doc = buildCreditNoteJson({
      number: cn.number,
      ...issueStamp(),
      supplier,
      customer,
      originalInvoiceNumber: o.invoiceNumber || "",
      reference,
      reason: cn.reason,
      amount: cn.amount,
      taxAmount: cn.taxAmount,
      taxRate: o.taxRate,
    });
    if (Math.abs(payableOf(doc) - cn.amount) > 0.005) {
      return NextResponse.json({ error: "Credit note total mismatch - not submitted" }, { status: 400 });
    }

    const r = await submitDocument(doc, cn.number);
    if (!r.ok) return NextResponse.json({ error: "Submission failed", detail: r.detail }, { status: r.status });
    await prisma.creditNote.update({
      where: { id },
      data: { eInvoiceUuid: r.uuid, eInvoiceStatus: "pending", submissionUid: r.submissionUID },
    });
    return NextResponse.json({ ok: true, submissionUID: r.submissionUID, uuid: r.uuid });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
