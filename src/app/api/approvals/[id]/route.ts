import { NextResponse } from "next/server";
import { requireAuth, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth(); if (denied) return denied;
  try {
    const actor = await getCurrentUser(); if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params; const b = await request.json();
    const approval = await prisma.customerApproval.findUnique({ where: { id }, include: { lines: true } });
    if (!approval || approval.approvalStatus !== "PENDING") return NextResponse.json({ error: "Pending approval not found" }, { status: 404 });
    if (approval.expiresAt && approval.expiresAt < new Date()) return NextResponse.json({ error: "Approval link has expired" }, { status: 410 });
    const decisions = Array.isArray(b.lines) ? b.lines : [];
    const decisionIds = decisions.map((x: { id: string }) => String(x.id));
    if (!decisions.length || decisions.length !== approval.lines.length || new Set(decisionIds).size !== approval.lines.length || decisions.some((x: { id: string; decision: string }) => !approval.lines.some((line) => line.id === x.id) || !["APPROVED", "DECLINED"].includes(x.decision))) return NextResponse.json({ error: "A unique decision is required for every line" }, { status: 400 });
    const updated = await prisma.$transaction(async (tx) => {
      const claimed = await tx.customerApproval.updateMany({ where: { id, approvalStatus: "PENDING", ...(approval.expiresAt ? { expiresAt: { gt: new Date() } } : {}) }, data: { approvalStatus: "PROCESSING" } });
      if (claimed.count !== 1) throw new Error("Approval is no longer pending");
      for (const line of decisions) await tx.approvalLine.update({ where: { id: line.id }, data: { decision: line.decision, decidedAt: new Date() } });
      const lines = await tx.approvalLine.findMany({ where: { approvalId: id } });
      const approved = lines.filter((x) => x.decision === "APPROVED").length;
      const declined = lines.filter((x) => x.decision === "DECLINED").length;
      const status = approved === lines.length ? "APPROVED" : declined === lines.length ? "DECLINED" : "PARTIAL";
      return tx.customerApproval.update({ where: { id }, data: { approvalStatus: status, approvedAt: new Date(), customerName: b.customerName ? String(b.customerName).slice(0,120) : approval.customerName }, include: { lines: true } });
    });
    await writeAuditLog({ actor, request, action: "CUSTOMER_APPROVAL_RECORDED", entityType: "CustomerApproval", entityId: id, summary: `Customer approval recorded: ${updated.approvalStatus}` });
    return NextResponse.json(updated);
  } catch (error) { console.error(error); return NextResponse.json({ error: "Unable to record approval" }, { status: 400 }); }
}
