import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireAuth, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const rows = await prisma.appointment.findMany({
    where: {
      ...(from || to ? { startAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}),
      ...(url.searchParams.get("status") ? { status: url.searchParams.get("status")! } : {}),
    },
    orderBy: { startAt: "asc" }, take: 500,
    include: { customer: { select: { id: true, name: true, phone: true } }, vehicle: { select: { id: true, plateNumber: true, make: true, model: true } }, assignedTechnician: { select: { id: true, name: true } }, serviceBay: true },
  });
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  try {
    const body = await request.json();
    const customerId = String(body.customerId || "");
    const vehicleId = String(body.vehicleId || "");
    const startAt = new Date(body.startAt);
    const endAt = new Date(body.endAt);
    if (!customerId || !vehicleId || Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
      return NextResponse.json({ error: "Customer, vehicle and a valid time range are required" }, { status: 400 });
    }
    const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, customerId }, select: { id: true } });
    if (!vehicle) return NextResponse.json({ error: "Vehicle does not belong to this customer" }, { status: 400 });
    const technicianId = body.assignedTechnicianId ? String(body.assignedTechnicianId) : null;
    const serviceBayId = body.serviceBayId ? String(body.serviceBayId) : null;
    if (technicianId) {
      const tech = await prisma.user.findFirst({ where: { id: technicianId, role: "TECHNICIAN", disabledAt: null } });
      if (!tech) return NextResponse.json({ error: "Select an active technician account" }, { status: 400 });
    }
    if (serviceBayId && !await prisma.serviceBay.findFirst({ where: { id: serviceBayId, isActive: true } })) return NextResponse.json({ error: "Select an active service bay" }, { status: 400 });
    const overlap = (technicianId || serviceBayId) ? await prisma.appointment.findFirst({ where: { status: { notIn: ["CANCELLED", "NO_SHOW"] }, startAt: { lt: endAt }, endAt: { gt: startAt }, OR: [ ...(technicianId ? [{ assignedTechnicianId: technicianId }] : []), ...(serviceBayId ? [{ serviceBayId }] : []) ] } }) : null;
    if (overlap) return NextResponse.json({ error: "The selected technician or service bay is already booked in this time range" }, { status: 409 });
    const appointment = await prisma.appointment.create({
      data: { appointmentNo: `APT-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${randomUUID().slice(0,6).toUpperCase()}`, customerId, vehicleId, startAt, endAt, serviceType: body.serviceType ? String(body.serviceType).slice(0,120) : null, notes: body.notes ? String(body.notes).slice(0,2000) : null, source: ["WALK_IN","PHONE","ONLINE","WHATSAPP"].includes(body.source) ? body.source : "WALK_IN", assignedTechnicianId: technicianId, serviceBayId },
      include: { customer: true, vehicle: true, assignedTechnician: true, serviceBay: true },
    });
    const actor = await getCurrentUser();
    if (actor) await writeAuditLog({ actor, request, action: "APPOINTMENT_CREATED", entityType: "Appointment", entityId: appointment.id, summary: `Appointment ${appointment.appointmentNo} created` });
    return NextResponse.json(appointment, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Unable to create appointment" }, { status: 500 });
  }
}
