import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireAuth, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const denied = await requireAuth(); if (denied) return denied;
  const workOrderId = new URL(request.url).searchParams.get("workOrderId");
  const rows = await prisma.vehicleInspection.findMany({ where: workOrderId ? { workOrderId } : {}, orderBy: { createdAt: "desc" }, take: 200, include: { findings: { include: { photos: true } }, template: true } });
  return NextResponse.json(rows);
}
export async function POST(request: Request) {
  const denied = await requireAuth(); if (denied) return denied;
  try {
    const b = await request.json();
    const workOrderId = String(b.workOrderId || "");
    const order = await prisma.workOrder.findUnique({ where: { id: workOrderId }, select: { id: true, status: true } });
    if (!order || order.status === "CANCELLED") return NextResponse.json({ error: "A valid active work order is required" }, { status: 400 });
    const template = b.templateId ? await prisma.inspectionTemplate.findFirst({ where: { id: String(b.templateId), isActive: true }, include: { items: { orderBy: { sortOrder: "asc" } } } }) : null;
    const actor = await getCurrentUser();
    const row = await prisma.vehicleInspection.create({ data: { inspectionNo: `DVI-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${randomUUID().slice(0,6).toUpperCase()}`, workOrderId, templateId: template?.id || null, inspectedById: actor?.id || null, status: "IN_PROGRESS", findings: { create: template?.items.map((i) => ({ category: i.category, itemLabel: i.label, sortOrder: i.sortOrder })) || [] } }, include: { findings: true } });
    if (actor) await writeAuditLog({ actor, request, action: "VEHICLE_INSPECTION_CREATED", entityType: "VehicleInspection", entityId: row.id, summary: `Digital inspection ${row.inspectionNo} created` });
    return NextResponse.json(row, { status: 201 });
  } catch (error) { console.error(error); return NextResponse.json({ error: "Unable to create inspection" }, { status: 500 }); }
}
