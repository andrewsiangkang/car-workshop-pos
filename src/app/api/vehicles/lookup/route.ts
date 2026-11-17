import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalisePlate, customerPhoneKey } from "@/lib/customer-match.mjs";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const __denied = await requireAuth();
  if (__denied) return __denied;
  const { searchParams } = new URL(request.url);
  // Same normalisation as saving ("WXY 1234" -> "WXY1234"); a mismatch used to treat an
  // existing car as new and move it to a new walk-in customer.
  const plate = normalisePlate(searchParams.get("plate"));
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
      // A walk-in's placeholder phone ("N/A") is not sent back: put into the phone box it used
      // to match (and rename) a random other walk-in on save.
      // An anonymised customer's name is not offered again (PDPA): the car is treated as a walk-in.
      customer: vehicle.customer && !vehicle.customer.anonymisedAt
        ? { name: vehicle.customer.name, phone: customerPhoneKey(vehicle.customer.phone) ? vehicle.customer.phone : "" }
        : null,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }
}
