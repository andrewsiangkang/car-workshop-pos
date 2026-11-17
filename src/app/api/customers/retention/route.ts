import { NextResponse } from "next/server";
import { requireOwner, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { isRetentionDue, yearsBefore } from "@/lib/privacy-customer.mjs";
import { anonymiseCustomer, ORDER_DATES_SELECT, sweepExpiredBuyerData } from "@/lib/privacy-anonymise";
import { expiredBuyerDataSummary } from "@/lib/privacy-freeze.mjs";

export const dynamic = "force-dynamic";

/** Customers due under the retention schedule: not anonymised, no visit for `years` years. */
async function dueCustomers(years: number, now: Date) {
  const candidates = await prisma.customer.findMany({
    // Cheap first cut: the record itself must be older than the period.
    where: { anonymisedAt: null, createdAt: { lt: yearsBefore(now, years) } },
    select: { id: true, createdAt: true, anonymisedAt: true, workOrders: { select: ORDER_DATES_SELECT } },
  });
  return candidates.filter((c) => isRetentionDue(c, years, now)).map((c) => c.id);
}

async function retentionYears() {
  const shop = await prisma.shopProfile.findFirst({ select: { customerRetentionYears: true } });
  return shop?.customerRetentionYears ?? null;
}

/**
 * Retention schedule (boss only). GET: how many customers have had no visit for the number of
 * years set in Settings → Privacy (shown before anything is changed). POST {"expectedCount": n}:
 * anonymise exactly those customers; refused if the count changed since it was shown.
 * Each customer gets its own audit entry, plus one summary entry.
 * 【中文】客户资料保留期限（老板专用）。GET：先显示有多少客户超过设定年限没来过；POST：匿名化这些客户
 * （数量和刚才显示的不同就拒绝）。每位客户一条审计记录，另加一条汇总记录。
 */
export async function GET() {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const years = await retentionYears();
    if (!years) return NextResponse.json({ years: null, count: 0 });
    const now = new Date();
    const ids = await dueCustomers(years, now);
    return NextResponse.json({ years, count: ids.length, noVisitSince: yearsBefore(now, years).toISOString() });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Unable to count customers" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const actor = await getCurrentUser();
    const body = (await request.json().catch(() => null)) ?? {};
    const years = await retentionYears();
    if (!years) return NextResponse.json({ error: "Set how many years customer records are kept first" }, { status: 400 });
    const now = new Date();
    const ids = await dueCustomers(years, now);
    // The rule the boss was shown must be the one applied (the setting may have been saved
    // again since the count). 【中文】显示给老板的年限必须就是要执行的年限。
    if (body.years !== years) {
      return NextResponse.json(
        { error: "The retention setting changed. Check the new number, then confirm again.", count: ids.length, years },
        { status: 409 }
      );
    }
    if (!Number.isInteger(body.expectedCount) || body.expectedCount !== ids.length) {
      return NextResponse.json(
        { error: "The number of customers changed. Check the new number, then confirm again.", count: ids.length, years },
        { status: 409 }
      );
    }
    let done = 0;
    for (const id of ids) {
      // One transaction per customer; re-checked inside, in case the customer came back meanwhile.
      const result = await prisma.$transaction(async (tx) => {
        const c = await tx.customer.findUnique({
          where: { id },
          select: { id: true, createdAt: true, anonymisedAt: true, workOrders: { select: ORDER_DATES_SELECT } },
        });
        if (!c || !isRetentionDue(c, years, now)) return null;
        return anonymiseCustomer(tx, id, now);
      });
      if (!result) continue;
      done++;
      if (actor) {
        await writeAuditLog({
          actor,
          request,
          action: "CUSTOMER_ANONYMISED",
          entityType: "Customer",
          entityId: id,
          summary: `Customer anonymised: no visit for ${years} years (retention schedule)`,
          details: { reason: "retention", years, ...result },
        });
      }
    }
    if (actor) {
      await writeAuditLog({
        actor,
        request,
        action: "CUSTOMER_RETENTION_RUN",
        entityType: "Customer",
        entityId: null,
        summary: `Retention schedule: ${done} customer(s) with no visit for ${years} years anonymised`,
        details: { years, anonymised: done, noVisitSince: yearsBefore(now, years).toISOString() },
      });
    }
    // Customers anonymised earlier, while their documents were still inside the record-keeping
    // period: documents that have passed it since lose their buyer data now (counts only). After the
    // run is recorded and on its own: a failure here is logged (and tried again at the next server
    // start), never reported as a failed anonymisation that already happened.
    // 【中文】以前匿名化时单据还在保存期内的客户：现在已过保存期的单据清除买方资料（只记数量）。在汇总记录之后单独执行：
    // 这里失败只记录（下次启动会再试），不会把已经完成的匿名化说成失败。
    try {
      const expired = await sweepExpiredBuyerData(prisma, now);
      // Also when a customer could not be cleared and nothing else was (counts only).
      // 【中文】有客户清除失败、即使没有清除任何单据也要记录（只有数量）。
      const summary = expiredBuyerDataSummary(expired);
      if (actor && summary) {
        await writeAuditLog({
          actor,
          request,
          action: "CUSTOMER_EXPIRED_BUYER_DATA_CLEARED",
          entityType: "Customer",
          entityId: null,
          summary,
          details: { customers: expired.customers, documents: expired.documents, failed: expired.failed },
        });
      }
    } catch (e) {
      console.error("[privacy] could not clear expired buyer data", e);
    }
    return NextResponse.json({ ok: true, anonymised: done });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Anonymising failed" }, { status: 500 });
  }
}
