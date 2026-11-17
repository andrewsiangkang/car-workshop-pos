import { NextResponse } from "next/server";
import { requireOwner, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { createAuditChainVerifier } from "@/lib/privacy-audit.mjs";

export const dynamic = "force-dynamic";

const BATCH = 2000;

/**
 * Boss only: recompute the audit trail's hash chain (v0.3.30 entries; older entries have no
 * seq and are outside the chain) and report "intact" or the first missing / altered entry.
 * Entries written after the chain started but without a link (e.g. the database was busy) are
 * counted separately. The check itself is recorded in the audit trail.
 * 【中文】老板专用：重新计算审计日志的哈希链，报告「完好」或第一条缺失 / 被修改的记录。
 */
export async function POST(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const verifier = createAuditChainVerifier();
    let cursor: string | null = null;
    let first: { createdAt: Date } | null = null;
    for (;;) {
      const rows: Array<Record<string, unknown> & { id: string; createdAt: Date }> = await prisma.auditLog.findMany({
        where: { seq: { not: null } },
        orderBy: [{ seq: "asc" }, { id: "asc" }],
        take: BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (!rows.length) break;
      if (!first) first = rows[0];
      let stop = false;
      for (const r of rows) {
        if (verifier.push(r)) {
          stop = true;
          break;
        }
      }
      if (stop || rows.length < BATCH) break;
      cursor = rows[rows.length - 1].id;
    }
    const result = verifier.result();
    const [unchained, before] = await Promise.all([
      first ? prisma.auditLog.count({ where: { seq: null, createdAt: { gte: first.createdAt } } }) : Promise.resolve(0),
      first ? prisma.auditLog.count({ where: { seq: null, createdAt: { lt: first.createdAt } } }) : prisma.auditLog.count({ where: { seq: null } }),
    ]);
    const report = { ...result, unchainedSinceStart: unchained, olderUnchained: before, checkedAt: new Date().toISOString() };

    const actor = await getCurrentUser();
    if (actor) {
      await writeAuditLog({
        actor,
        request,
        action: "AUDIT_TRAIL_VERIFIED",
        entityType: "AuditLog",
        entityId: null,
        summary: result.ok ? `Audit trail checked: intact (${result.checked} entries)` : `Audit trail checked: problem at entry #${result.problem?.seq}`,
        details: { ok: result.ok, checked: result.checked, lastSeq: result.last?.seq ?? null, problem: result.problem, unchainedSinceStart: unchained },
      });
    }
    return NextResponse.json(report, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Unable to check the audit trail" }, { status: 500 });
  }
}
