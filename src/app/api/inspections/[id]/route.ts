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
    const inspection = await prisma.vehicleInspection.findUnique({ where: { id }, include: { findings: true } });
    if (!inspection) return NextResponse.json({ error: "Inspection not found" }, { status: 404 });
    if (inspection.status === "SUBMITTED" || inspection.status === "APPROVED") return NextResponse.json({ error: "Submitted inspections are read-only. Create a new inspection revision for further changes." }, { status: 409 });
    if (Array.isArray(b.findings)) {
      await prisma.$transaction(b.findings.map((f: { id: string; result: string; severity?: string; recommendation?: string; technicianNote?: string }) => prisma.inspectionFinding.updateMany({ where: { id: f.id, inspectionId: id }, data: { result: ["GOOD", "ATTENTION", "REPLACE", "NOT_CHECKED"].includes(f.result) ? f.result : "NOT_CHECKED", severity: ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(String(f.severity)) ? f.severity : "INFO", recommendation: f.recommendation ? String(f.recommendation).slice(0,1000) : null, technicianNote: f.technicianNote ? String(f.technicianNote).slice(0,2000) : null } })));
    }
    if (b.status === "SUBMITTED") {
      const latest = await prisma.inspectionFinding.findMany({ where: { inspectionId: id }, select: { result: true } });
      if (latest.some((f) => f.result === "NOT_CHECKED")) return NextResponse.json({ error: "Complete every inspection finding before submitting" }, { status: 409 });
    }
    const updated = await prisma.vehicleInspection.update({ where: { id }, data: { ...(b.status === "SUBMITTED" ? { status: "SUBMITTED", completedAt: new Date() } : {}), ...(b.summary !== undefined ? { summary: String(b.summary).slice(0,3000) } : {}) }, include: { findings: { include: { photos: true } } } });
    await writeAuditLog({ actor, request, action: "VEHICLE_INSPECTION_UPDATED", entityType: "VehicleInspection", entityId: id, summary: "Vehicle inspection updated" });
    return NextResponse.json(updated);
  } catch (error) { console.error(error); return NextResponse.json({ error: "Unable to update inspection" }, { status: 400 }); }
}
