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
    const current = await prisma.appointment.findUnique({ where: { id } });
    if (!current) return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
    const allowed = ["BOOKED", "CONFIRMED", "CHECKED_IN", "COMPLETED", "CANCELLED", "NO_SHOW"];
    const status = b.status ? String(b.status) : current.status;
    if (!allowed.includes(status)) return NextResponse.json({ error: "Invalid appointment status" }, { status: 400 });
    const startAt = b.startAt ? new Date(b.startAt) : current.startAt;
    const endAt = b.endAt ? new Date(b.endAt) : current.endAt;
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) return NextResponse.json({ error: "Invalid appointment time range" }, { status: 400 });
    const assignedTechnicianId = b.assignedTechnicianId === undefined ? current.assignedTechnicianId : (b.assignedTechnicianId || null);
    const serviceBayId = b.serviceBayId === undefined ? current.serviceBayId : (b.serviceBayId || null);
    if (assignedTechnicianId) {
      const tech = await prisma.user.findFirst({ where: { id: assignedTechnicianId, role: "TECHNICIAN", disabledAt: null } });
      if (!tech) return NextResponse.json({ error: "Select an active technician account" }, { status: 400 });
    }
    if (serviceBayId && !await prisma.serviceBay.findFirst({ where: { id: serviceBayId, isActive: true } })) return NextResponse.json({ error: "Select an active service bay" }, { status: 400 });
    if (assignedTechnicianId || serviceBayId) {
      const overlap = await prisma.appointment.findFirst({ where: { id: { not: id }, status: { notIn: ["CANCELLED", "NO_SHOW"] }, startAt: { lt: endAt }, endAt: { gt: startAt }, OR: [ ...(assignedTechnicianId ? [{ assignedTechnicianId }] : []), ...(serviceBayId ? [{ serviceBayId }] : []) ] } });
      if (overlap) return NextResponse.json({ error: "Technician or service bay conflict" }, { status: 409 });
    }
    const row = await prisma.appointment.update({ where: { id }, data: { status, startAt, endAt, assignedTechnicianId, serviceBayId, notes: b.notes === undefined ? current.notes : (b.notes ? String(b.notes).slice(0,2000) : null) } });
    await writeAuditLog({ actor, request, action: "APPOINTMENT_UPDATED", entityType: "Appointment", entityId: id, summary: `Appointment ${row.appointmentNo} updated` });
    return NextResponse.json(row);
  } catch (error) { console.error(error); return NextResponse.json({ error: "Unable to update appointment" }, { status: 400 }); }
}
