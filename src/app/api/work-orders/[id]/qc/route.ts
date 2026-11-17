import { NextResponse } from "next/server";
import { requireAuth, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
const DEFAULT_QC = ["Engine start and idle", "Warning lights", "Brake operation", "Tyre condition and pressure", "Fluid leaks", "Lights and indicators", "Tools and belongings returned", "Road test (if applicable)"];
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth(); if (denied) return denied;
  const { id } = await params;
  return NextResponse.json(await prisma.qCInspection.findMany({ where: { workOrderId: id }, include: { items: true }, orderBy: { createdAt: "desc" } }));
}
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth(); if (denied) return denied;
  try {
    const actor = await getCurrentUser(); if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const row = await prisma.qCInspection.create({ data: { workOrderId: id, inspectedById: actor.id, items: { create: DEFAULT_QC.map((label, sortOrder) => ({ label, sortOrder })) } }, include: { items: true } });
    await writeAuditLog({ actor, request, action: "QC_INSPECTION_CREATED", entityType: "QCInspection", entityId: row.id, summary: "Quality control checklist created" });
    return NextResponse.json(row, { status: 201 });
  } catch (error) { console.error(error); return NextResponse.json({ error: "Unable to create QC inspection" }, { status: 400 }); }
}
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth(); if (denied) return denied;
  try {
    const actor = await getCurrentUser(); if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const b = await request.json();
    const qcId = String(b.qcInspectionId || "");
    const current = await prisma.qCInspection.findFirst({ where: { id: qcId, workOrderId: id }, include: { items: true } });
    if (!current) return NextResponse.json({ error: "QC inspection not found" }, { status: 404 });
    if (current.status === "PASS" || current.status === "FAIL") return NextResponse.json({ error: "Finalized QC records are read-only. Create a new QC inspection for a re-check." }, { status: 409 });
    if (Array.isArray(b.items)) {
      await prisma.$transaction(b.items.map((item: { id: string; result: string; notes?: string }) => prisma.qCInspectionItem.updateMany({ where: { id: item.id, qcInspectionId: qcId }, data: { result: ["PASS", "FAIL", "NA", "PENDING"].includes(item.result) ? item.result : "PENDING", notes: item.notes ? String(item.notes).slice(0,1000) : null } })));
    }
    const refreshed = await prisma.qCInspection.findUnique({ where: { id: qcId }, include: { items: true } });
    if (b.status === "PASS" || b.status === "FAIL") {
      if (b.status === "PASS" && refreshed?.items.some((item) => item.result === "PENDING" || item.result === "FAIL")) return NextResponse.json({ error: "All QC items must pass or be marked not applicable before QC can pass" }, { status: 409 });
      const updated = await prisma.qCInspection.update({ where: { id: qcId }, data: { status: b.status, inspectedAt: new Date(), roadTestDone: b.roadTestDone === true, roadTestNotes: b.roadTestNotes ? String(b.roadTestNotes).slice(0,1000) : null, summary: b.summary ? String(b.summary).slice(0,2000) : null }, include: { items: true } });
      await writeAuditLog({ actor, request, action: `QC_${b.status}`, entityType: "QCInspection", entityId: qcId, summary: `Quality control ${b.status.toLowerCase()}` });
      return NextResponse.json(updated);
    }
    const saved = await prisma.qCInspection.update({ where: { id: qcId }, data: { roadTestDone: b.roadTestDone === true, roadTestNotes: b.roadTestNotes ? String(b.roadTestNotes).slice(0,1000) : null, summary: b.summary ? String(b.summary).slice(0,2000) : undefined }, include: { items: true } });
    return NextResponse.json(saved);
  } catch (error) { console.error(error); return NextResponse.json({ error: "Unable to update QC inspection" }, { status: 400 }); }
}
