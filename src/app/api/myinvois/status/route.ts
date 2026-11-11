import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSubmissionStatus } from "@/lib/myinvois";

export const dynamic = "force-dynamic";

/**
 * Check an LHDN submission and store UUID / Long ID / status on the right record.
 * Body: { submissionUID, orderId | creditNoteId | consolidatedId }
 */
export async function POST(request: Request) {
  const __denied = await requireAuth();
  if (__denied) return __denied;
  try {
    const { orderId, creditNoteId, consolidatedId, submissionUID } = await request.json();
    if (!submissionUID || !(orderId || creditNoteId || consolidatedId)) {
      return NextResponse.json({ error: "submissionUID and a record id are required" }, { status: 400 });
    }

    const r = await getSubmissionStatus(String(submissionUID));
    if (!r.ok) return NextResponse.json({ error: "Status check failed", detail: r.detail }, { status: r.status });

    if (r.uuid) {
      const data = { eInvoiceUuid: r.uuid, eInvoiceLongId: r.longId || undefined, eInvoiceStatus: r.status };
      if (orderId) await prisma.workOrder.update({ where: { id: orderId }, data });
      else if (creditNoteId) await prisma.creditNote.update({ where: { id: creditNoteId }, data });
      else await prisma.consolidatedInvoice.update({ where: { id: consolidatedId }, data });
    }
    return NextResponse.json({ ok: true, status: r.status, uuid: r.uuid, longId: r.longId });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
