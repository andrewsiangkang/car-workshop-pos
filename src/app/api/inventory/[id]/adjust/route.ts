import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const __denied = await requireAuth();
  if (__denied) return __denied;
  const { id } = await params;
  try {
    const b = await request.json();
    const qty = Number(b.quantity);
    const type = String(b.type || "ADJUST"); // IN, OUT, ADJUST
    const notes = String(b.notes || "").trim() || null;

    if (!qty || isNaN(qty)) {
      return NextResponse.json({ error: "Quantity required" }, { status: 400 });
    }

    const item = await prisma.inventoryItem.findUnique({ where: { id } });
    if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });

    let delta = 0;
    if (type === "IN") delta = Math.abs(qty);
    else if (type === "OUT") delta = -Math.abs(qty);
    else delta = qty; // ADJUST can be positive or negative

    const newQty = item.quantityOnHand + delta;
    if (newQty < 0) {
      return NextResponse.json({ error: "Insufficient stock" }, { status: 400 });
    }

    const [updated] = await prisma.$transaction([
      prisma.inventoryItem.update({
        where: { id },
        data: { quantityOnHand: newQty },
      }),
      prisma.stockMovement.create({
        data: {
          inventoryItemId: id,
          type,
          quantity: delta,
          notes,
        },
      }),
    ]);

    return NextResponse.json(updated);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Adjustment failed" }, { status: 500 });
  }
}
