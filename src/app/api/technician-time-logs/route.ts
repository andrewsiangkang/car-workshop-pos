import { NextResponse } from "next/server";
import { requireAuth, getCurrentUser, isOwner } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const denied = await requireAuth(); if (denied) return denied;
  const actor = await getCurrentUser();
  const url = new URL(request.url);
  const workOrderId = url.searchParams.get("workOrderId");
  const rows = await prisma.technicianTimeLog.findMany({ where: { ...(workOrderId ? { workOrderId } : {}), ...(!actor || isOwner(actor) ? {} : { technicianId: actor.id }) }, orderBy: { startedAt: "desc" }, take: 300, include: { technician: { select: { id: true, name: true } }, workOrder: { select: { orderNumber: true } } } });
  return NextResponse.json(rows);
}
export async function POST(request: Request) {
  const denied = await requireAuth(); if (denied) return denied;
  try {
    const actor = await getCurrentUser(); if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const b = await request.json();
    const action = String(b.action || "start");
    const technicianId = isOwner(actor) && b.technicianId ? String(b.technicianId) : actor.id;
    const technician = await prisma.user.findFirst({ where: { id: technicianId, role: "TECHNICIAN", disabledAt: null } });
    if (!technician) return NextResponse.json({ error: "Active technician account required" }, { status: 400 });
    const logId = String(b.id || "");
    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      if (action === "start") {
        const workOrderId = String(b.workOrderId || "");
        const order = await tx.workOrder.findUnique({ where: { id: workOrderId }, select: { id: true, status: true } });
        if (!order || order.status === "CANCELLED" || order.status === "COMPLETED") throw new Error("Active work order required");
        const running = await tx.technicianTimeLog.findFirst({ where: { technicianId, status: { in: ["RUNNING", "PAUSED"] } } });
        if (running) throw new Error("Technician already has an active time log");
        return tx.technicianTimeLog.create({ data: { workOrderId, technicianId, startedAt: now, status: "RUNNING" } });
      }
      const log = await tx.technicianTimeLog.findUnique({ where: { id: logId } });
      if (!log || (log.technicianId !== actor.id && !isOwner(actor))) throw new Error("Time log not found or not permitted");
      if (action === "pause" && log.status === "RUNNING") {
        const elapsed = Math.max(0, Math.floor((now.getTime() - log.startedAt.getTime()) / 1000));
        return tx.technicianTimeLog.update({ where: { id: log.id }, data: { status: "PAUSED", pausedAt: now, durationSeconds: { increment: elapsed } } });
      }
      if (action === "resume" && log.status === "PAUSED") return tx.technicianTimeLog.update({ where: { id: log.id }, data: { status: "RUNNING", startedAt: now, pausedAt: null } });
      if (action === "stop" && log.status === "RUNNING") {
        const elapsed = Math.max(0, Math.floor((now.getTime() - log.startedAt.getTime()) / 1000));
        return tx.technicianTimeLog.update({ where: { id: log.id }, data: { status: "STOPPED", endedAt: now, durationSeconds: { increment: elapsed }, note: b.note ? String(b.note).slice(0,1000) : log.note } });
      }
      if (action === "stop" && log.status === "PAUSED") return tx.technicianTimeLog.update({ where: { id: log.id }, data: { status: "STOPPED", endedAt: now, note: b.note ? String(b.note).slice(0,1000) : log.note } });
      throw new Error("Invalid time-log state transition");
    });
    await writeAuditLog({ actor, request, action: `TECHNICIAN_TIME_${action.toUpperCase()}`, entityType: "TechnicianTimeLog", entityId: result.id, summary: `Technician time log ${action}` });
    return NextResponse.json(result, { status: action === "start" ? 201 : 200 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update time log" }, { status: 400 }); }
}
