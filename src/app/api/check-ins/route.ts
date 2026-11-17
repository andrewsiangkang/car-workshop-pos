import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireAuth, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await requireAuth(); if (denied) return denied;
  const vehicleId = new URL(request.url).searchParams.get("vehicleId");
  const rows = await prisma.vehicleCheckIn.findMany({ where: vehicleId ? { vehicleId } : {}, orderBy: { checkedInAt: "desc" }, take: 200, include: { customer: true, vehicle: true, photos: true } });
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const denied = await requireAuth(); if (denied) return denied;
  try {
    const b = await request.json();
    const vehicle = await prisma.vehicle.findUnique({ where: { id: String(b.vehicleId || "") }, include: { customer: true } });
    if (!vehicle) return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
    const workOrderId = b.workOrderId ? String(b.workOrderId) : null;
    if (workOrderId) {
      const linkedOrder = await prisma.workOrder.findFirst({
        where: { id: workOrderId, vehicleId: vehicle.id, customerId: vehicle.customerId, status: { not: "CANCELLED" } },
        select: { id: true },
      });
      if (!linkedOrder) return NextResponse.json({ error: "Work order must belong to the checked-in customer and vehicle" }, { status: 400 });
    }
    const mileage = b.mileageIn === "" || b.mileageIn == null ? null : Number(b.mileageIn);
    if (mileage != null && (!Number.isInteger(mileage) || mileage < 0 || (vehicle.mileage != null && mileage < vehicle.mileage))) return NextResponse.json({ error: "Enter a valid mileage not lower than the last recorded mileage" }, { status: 400 });
    const actor = await getCurrentUser();
    const row = await prisma.$transaction(async (tx) => {
      const checkIn = await tx.vehicleCheckIn.create({ data: { checkInNo: `CI-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${randomUUID().slice(0,6).toUpperCase()}`, customerId: vehicle.customerId, vehicleId: vehicle.id, workOrderId, mileageIn: mileage, fuelLevel: b.fuelLevel ? String(b.fuelLevel).slice(0,30) : null, exteriorNotes: b.exteriorNotes ? String(b.exteriorNotes).slice(0,2000) : null, belongings: b.belongings ? String(b.belongings).slice(0,1000) : null, keyCount: Math.max(0, Math.min(10, Number(b.keyCount ?? 1))), checkedInById: actor?.id || null } });
      if (mileage != null) await tx.vehicle.update({ where: { id: vehicle.id }, data: { mileage } });
      return checkIn;
    });
    if (actor) await writeAuditLog({ actor, request, action: "VEHICLE_CHECKED_IN", entityType: "VehicleCheckIn", entityId: row.id, summary: `Vehicle ${vehicle.plateNumber} checked in` });
    return NextResponse.json(row, { status: 201 });
  } catch (error) { console.error(error); return NextResponse.json({ error: "Unable to check in vehicle" }, { status: 500 }); }
}
