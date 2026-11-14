import { NextResponse } from "next/server";
import { requireOwner, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { anonymiseRefusal } from "@/lib/privacy-customer.mjs";
import { anonymiseCustomer, ORDER_DATES_SELECT } from "@/lib/privacy-anonymise";

export const dynamic = "force-dynamic";

const REFUSALS: Record<string, { status: number; error: string }> = {
  ALREADY: { status: 409, error: "This customer was already anonymised" },
  OPEN_JOB: { status: 409, error: "This customer has a job that is confirmed or in progress. Finish or cancel it first." },
  RECORD_KEEPING: {
    status: 409,
    error: "This customer has invoices, receipts or credit notes still inside the 7-year keeping period. Confirm that you understand they must be kept, then try again.",
  },
};

/**
 * Anonymise one customer (boss only, PDPA erasure request). Refused while a job is open, and —
 * unless the boss confirms they understand the 7-year record-keeping duty — when any invoice,
 * receipt or credit note of this customer is still inside the keeping period (7 years from the end
 * of its year). Those documents keep printing the buyer: older ones without frozen particulars get
 * them frozen first (anonymiseCustomer). Recorded in the audit trail (without the personal details).
 * 【中文】匿名化一位客户（老板专用，PDPA 删除请求）。有进行中的工单时拒绝；有还在保存期内的单据时，必须老板确认了解保存义务才继续。
 * 这些单据照旧印出买方（旧单据先冻结资料）。写入审计日志（不含个人资料）。
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const { id } = await params;
    const actor = await getCurrentUser();
    const body = (await request.json().catch(() => null)) ?? {};
    const confirmRecordKeeping = body.confirmRecordKeeping === true;
    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({
        where: { id },
        select: { id: true, anonymisedAt: true, workOrders: { select: ORDER_DATES_SELECT } },
      });
      if (!customer) return { refused: { status: 404, body: { error: "Customer not found" } } };
      const refusal = anonymiseRefusal({ customer, orders: customer.workOrders, now, confirmRecordKeeping });
      if (refusal) {
        const r = REFUSALS[refusal.code];
        return { refused: { status: r.status, body: { error: r.error, code: refusal.code, count: refusal.count ?? 0, latest: refusal.latest ?? null } } };
      }
      const recent = anonymiseRefusal({ customer, orders: customer.workOrders, now, confirmRecordKeeping: false });
      const done = await anonymiseCustomer(tx, id, now);
      return { done, recentTaxDocuments: recent?.code === "RECORD_KEEPING" ? recent.count ?? 0 : 0, latest: recent?.latest ?? null };
    });
    if ("refused" in result && result.refused) return NextResponse.json(result.refused.body, { status: result.refused.status });

    if (actor && "done" in result) {
      await writeAuditLog({
        actor,
        request,
        action: "CUSTOMER_ANONYMISED",
        entityType: "Customer",
        entityId: id,
        summary: "Customer anonymised at their request (invoices and amounts kept)",
        details: {
          reason: "request",
          recentTaxDocuments: result.recentTaxDocuments,
          latestTaxDocumentAt: result.latest,
          confirmedRecordKeeping: confirmRecordKeeping,
          ...result.done,
        },
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Anonymising failed" }, { status: 500 });
  }
}
