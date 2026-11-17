import { NextResponse } from "next/server";
import { requireAuth, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
export const dynamic = "force-dynamic";
const NEXT: Record<string, string[]> = {
  LEGACY: ["CHECK_IN", "INSPECTING", "WAITING", "HANDED_OVER"],
  WAITING: ["CHECK_IN", "INSPECTING", "CANCELLED"],
  CHECK_IN: ["INSPECTING", "AWAITING_APPROVAL", "WAITING_PARTS", "IN_REPAIR"],
  INSPECTING: ["AWAITING_APPROVAL", "WAITING_PARTS", "IN_REPAIR"],
  AWAITING_APPROVAL: ["WAITING_PARTS", "IN_REPAIR", "CANCELLED"],
  WAITING_PARTS: ["IN_REPAIR", "CANCELLED"],
  IN_REPAIR: ["QC_PENDING", "WAITING_PARTS"],
  QC_PENDING: ["REWORK", "READY"],
  REWORK: ["IN_REPAIR", "QC_PENDING"],
  READY: ["HANDED_OVER", "REWORK"],
  HANDED_OVER: [],
  CANCELLED: [],
};
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth(); if (denied) return denied;
  try {
    const actor = await getCurrentUser(); if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params; const b = await request.json(); const toStage = String(b.toStage || "");
    if (!Object.prototype.hasOwnProperty.call(NEXT, toStage)) return NextResponse.json({ error: "Invalid workshop stage" }, { status: 400 });
    const updated = await prisma.$transaction(async (tx) => {
      const order = await tx.workOrder.findUnique({ where: { id } });
      if (!order) throw new Error("Work order not found");
      const fromStage = order.workflowStage || "LEGACY";
      if (fromStage === toStage) return order;
      if (!(NEXT[fromStage] || []).includes(toStage)) throw new Error(`Cannot move workshop stage from ${fromStage} to ${toStage}`);
      if (toStage === "READY") {
        const qc = await tx.qCInspection.findFirst({ where: { workOrderId: id, status: "PASS" } });
        if (!qc) throw new Error("A passed quality-control inspection is required before marking ready");
      }
      const row = await tx.workOrder.update({ where: { id }, data: { workflowStage: toStage } });
      await tx.workOrderStageHistory.create({ data: { workOrderId: id, fromStage, toStage, note: b.note ? String(b.note).slice(0,1000) : null, actorUserId: actor.id, actorName: actor.name } });
      return row;
    });
    await writeAuditLog({ actor, request, action: "WORK_ORDER_STAGE_CHANGED", entityType: "WorkOrder", entityId: id, summary: `Workshop stage changed to ${updated.workflowStage}` });
    return NextResponse.json(updated);
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to change workshop stage" }, { status: 400 }); }
}
