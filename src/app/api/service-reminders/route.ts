import { NextResponse } from "next/server";
import { requireAuth, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

function parseOptionalInt(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 2_000_000) throw new Error("Enter a valid mileage");
  return n;
}

function parseOptionalDate(value: unknown): Date | null {
  if (value === undefined || value === null || value === "") return null;
  const d = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) throw new Error("Enter a valid service date");
  return d;
}

export async function PATCH(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const body = await request.json();
    const id = String(body.vehicleId || "");
    if (!id) return NextResponse.json({ error: "Vehicle is required" }, { status: 400 });

    const vehicle = await prisma.vehicle.findUnique({
      where: { id },
      include: { customer: true },
    });
    if (!vehicle) return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });

    const intervalKm = Number(body.serviceIntervalKm ?? vehicle.serviceIntervalKm);
    const intervalMonths = Number(body.serviceIntervalMonths ?? vehicle.serviceIntervalMonths);
    if (!Number.isInteger(intervalKm) || intervalKm < 500 || intervalKm > 100000) {
      return NextResponse.json({ error: "Service interval must be between 500 and 100,000 km" }, { status: 400 });
    }
    if (!Number.isInteger(intervalMonths) || intervalMonths < 1 || intervalMonths > 36) {
      return NextResponse.json({ error: "Service interval must be between 1 and 36 months" }, { status: 400 });
    }

    let data: {
      lastServiceDate?: Date | null;
      lastServiceMileage?: number | null;
      nextServiceDate?: Date | null;
      nextServiceMileage?: number | null;
      serviceIntervalKm: number;
      serviceIntervalMonths: number;
      mileage?: number | null;
    };

    if (body.action === "complete") {
      const currentMileage = parseOptionalInt(body.currentMileage);
      if (currentMileage === null) {
        return NextResponse.json({ error: "Enter the current vehicle mileage to complete the service" }, { status: 400 });
      }
      if (vehicle.mileage != null && currentMileage < vehicle.mileage) {
        return NextResponse.json({ error: "Current mileage cannot be lower than the mileage already recorded for this vehicle" }, { status: 400 });
      }
      const completedAt = new Date();
      const nextDate = new Date(completedAt);
      nextDate.setMonth(nextDate.getMonth() + intervalMonths);
      data = {
        lastServiceDate: completedAt,
        lastServiceMileage: currentMileage,
        nextServiceDate: nextDate,
        nextServiceMileage: currentMileage + intervalKm,
        serviceIntervalKm: intervalKm,
        serviceIntervalMonths: intervalMonths,
        mileage: currentMileage,
      };
    } else {
      const nextServiceDate = parseOptionalDate(body.nextServiceDate);
      const nextServiceMileage = parseOptionalInt(body.nextServiceMileage);
      const lastServiceDate = parseOptionalDate(body.lastServiceDate);
      const lastServiceMileage = parseOptionalInt(body.lastServiceMileage);
      if (!nextServiceDate && nextServiceMileage === null) {
        return NextResponse.json({ error: "Set at least a next service date or next service mileage" }, { status: 400 });
      }
      data = {
        lastServiceDate,
        lastServiceMileage,
        nextServiceDate,
        nextServiceMileage,
        serviceIntervalKm: intervalKm,
        serviceIntervalMonths: intervalMonths,
      };
    }

    const updated = await prisma.vehicle.update({
      where: { id },
      data,
      include: { customer: true },
    });
    const actor = await getCurrentUser();
    if (actor) {
      await writeAuditLog({
        actor,
        request,
        action: body.action === "complete" ? "SERVICE_REMINDER_COMPLETED" : "SERVICE_REMINDER_UPDATED",
        entityType: "Vehicle",
        entityId: id,
        summary: body.action === "complete"
          ? `Service completed for ${vehicle.plateNumber}`
          : `Service reminder updated for ${vehicle.plateNumber}`,
      });
    }
    return NextResponse.json({
      ...updated,
      lastServiceDate: updated.lastServiceDate?.toISOString() ?? null,
      nextServiceDate: updated.nextServiceDate?.toISOString() ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save service reminder";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
