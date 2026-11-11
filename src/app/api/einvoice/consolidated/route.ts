import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { consolidationPreview, isValidMonth, currentMonth } from "@/lib/consolidation";
import {
  getMyInvoisConfig,
  buildConsolidatedJson,
  supplierFromShop,
  submitDocument,
  payableOf,
  issueStamp,
} from "@/lib/myinvois";

export const dynamic = "force-dynamic";

const isLive = (s: string | null | undefined) => !["invalid", "cancelled"].includes((s || "").toLowerCase());

/** Preview what would go into the consolidated e-Invoice for ?month=YYYY-MM (boss only). */
export async function GET(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  const month = new URL(request.url).searchParams.get("month") || "";
  if (!isValidMonth(month)) return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
  return NextResponse.json(await consolidationPreview(month));
}

/** Build and submit the consolidated e-Invoice for { month } (boss only). */
export async function POST(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const { month } = await request.json();
    if (!isValidMonth(String(month || ""))) {
      return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
    }
    if (month >= currentMonth()) {
      return NextResponse.json({ error: "A month can only be consolidated after it has ended." }, { status: 400 });
    }

    const p = await consolidationPreview(month);
    if (p.existing?.eInvoiceUuid && isLive(p.existing.eInvoiceStatus)) {
      return NextResponse.json(
        { error: `Already submitted for ${month} (UUID ${p.existing.eInvoiceUuid}). New items for this month need individual e-Invoices.` },
        { status: 409 }
      );
    }
    if (p.reportable.length === 0) {
      return NextResponse.json({ error: "Nothing to consolidate for this month." }, { status: 400 });
    }

    const { shop } = await getMyInvoisConfig();
    const { supplier, missing } = supplierFromShop(shop);
    if (missing.length) {
      return NextResponse.json({ error: `Fill in Settings → Shop first: ${missing.join(", ")}` }, { status: 400 });
    }

    // A retry after LHDN rejected the first attempt needs a new document number.
    const ym = month.replace("-", "");
    const attempt = p.existing ? Number(p.existing.number.split("-")[2] || "1") + 1 : 1;
    const number = attempt > 1 ? `CON-${ym}-${attempt}` : `CON-${ym}`;

    const doc = buildConsolidatedJson({
      number,
      ...issueStamp(),
      supplier,
      lines: p.reportable.map((l) => ({ invoiceNumber: l.invoiceNumber, net: l.net, tax: l.tax, rate: l.rate })),
    });
    if (Math.abs(payableOf(doc) - p.totals.total) > 0.005) {
      return NextResponse.json({ error: "Consolidated total mismatch - not submitted" }, { status: 400 });
    }

    const r = await submitDocument(doc, number);
    if (!r.ok) return NextResponse.json({ error: "Submission failed", detail: r.detail }, { status: r.status });

    // Record it and mark everything it covers, so nothing is reported twice.
    const record = await prisma.$transaction(async (tx) => {
      const data = {
        number,
        orderCount: p.reportable.length,
        netAmount: p.totals.net,
        taxAmount: p.totals.tax,
        totalAmount: p.totals.total,
        eInvoiceUuid: r.uuid,
        eInvoiceLongId: null,
        eInvoiceStatus: "pending",
        submissionUid: r.submissionUID,
      };
      const con = p.existing
        ? await tx.consolidatedInvoice.update({ where: { id: p.existing.id }, data })
        : await tx.consolidatedInvoice.create({ data: { month, ...data } });
      // Fully-credited invoices (total 0) are also marked: nothing left to report.
      await tx.workOrder.updateMany({
        where: { id: { in: p.lines.map((l) => l.orderId) } },
        data: { consolidatedId: con.id },
      });
      const cnIds = p.lines.flatMap((l) => l.creditNoteIds);
      if (cnIds.length) {
        await tx.creditNote.updateMany({ where: { id: { in: cnIds } }, data: { eInvoiceStatus: "consolidated" } });
      }
      return con;
    });

    return NextResponse.json({ ok: true, id: record.id, number, submissionUID: r.submissionUID, uuid: r.uuid });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
