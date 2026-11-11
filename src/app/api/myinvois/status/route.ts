import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAccessToken, getMyInvoisConfig } from "@/lib/myinvois";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const __denied = await requireAuth();
  if (__denied) return __denied;
  try {
    const { orderId, submissionUID } = await request.json();
    if (!orderId || !submissionUID) {
      return NextResponse.json({ error: "orderId and submissionUID required" }, { status: 400 });
    }

    const { base } = await getMyInvoisConfig();
    const token = await getAccessToken();

    const res = await fetch(`${base}/api/v1.0/documentsubmissions/${submissionUID}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json({ error: "Status check failed", detail: data }, { status: res.status });
    }

    const doc = data.documentSummary?.[0] || data.documents?.[0];
    const uuid = doc?.uuid;
    const longId = doc?.longId;
    const status = doc?.status || data.overallStatus;

    if (uuid) {
      await prisma.workOrder.update({
        where: { id: orderId },
        data: {
          eInvoiceUuid: uuid,
          eInvoiceLongId: longId || undefined,
          eInvoiceStatus: status || "pending",
        },
      });
    }

    return NextResponse.json({ ok: true, status, uuid, longId, raw: data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
