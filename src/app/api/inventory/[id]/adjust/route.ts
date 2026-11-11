import { NextResponse } from "next/server";
import { requireAuth, getCurrentUser, isOwner } from "@/lib/auth";
import { redactInventoryItem } from "@/lib/redact";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const TYPES = ["IN", "OUT", "ADJUST"];

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const __denied = await requireAuth();
  if (__denied) return __denied;
  const { id } = await params;
  try {
    const b = await request.json();
    const qty = Number(b.quantity);
    const type = String(b.type || "ADJUST").toUpperCase();
    const notes = String(b.notes || "").trim().slice(0, 500) || null;

    if (!TYPES.includes(type)) {
      return NextResponse.json({ error: "Type must be IN, OUT or ADJUST" }, { status: 400 });
    }
    if (!Number.isFinite(qty) || qty === 0 || Math.abs(qty) > 1_000_000) {
      return NextResponse.json({ error: "Quantity required" }, { status: 400 });
    }

    let delta = 0;
    if (type === "IN") delta = Math.abs(qty);
    else if (type === "OUT") delta = -Math.abs(qty);
    else delta = qty; // ADJUST can be positive or negative

    // Read + check + write in one transaction so two simultaneous adjustments
    // cannot overwrite each other's stock count.
    const updated = await prisma.$transaction(async (tx) => {
      const item = await tx.inventoryItem.findUnique({ where: { id } });
      if (!item) return null;
      if (item.quantityOnHand + delta < 0) return "insufficient" as const;
      await tx.stockMovement.create({ data: { inventoryItemId: id, type, quantity: delta, notes } });
      return tx.inventoryItem.update({ where: { id }, data: { quantityOnHand: { increment: delta } } });
    });

    if (!updated) return NextResponse.json({ error: "Item not found" }, { status: 404 });
    if (updated === "insufficient") return NextResponse.json({ error: "Insufficient stock" }, { status: 400 });
    return NextResponse.json(redactInventoryItem(updated, isOwner(await getCurrentUser())));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Adjustment failed" }, { status: 500 });
  }
}
