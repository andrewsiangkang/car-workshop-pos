import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const __denied = await requireAuth();
  if (__denied) return __denied;
  const { searchParams } = new URL(request.url);
  const plate = String(searchParams.get("plate") || "").trim().toUpperCase();
  if (!plate) {
    return NextResponse.json({ error: "Plate required" }, { status: 400 });
  }

  try {
    const vehicle = await prisma.vehicle.findUnique({
      where: { plateNumber: plate },
      include: { customer: true },
    });
    if (!vehicle) {
      return NextResponse.json({ found: false });
    }
    return NextResponse.json({
      found: true,
      vehicle: {
        plateNumber: vehicle.plateNumber,
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year,
        color: vehicle.color,
        mileage: vehicle.mileage,
      },
      customer: vehicle.customer
        ? { name: vehicle.customer.name, phone: vehicle.customer.phone }
        : null,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }
}
