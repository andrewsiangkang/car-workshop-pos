import { NextResponse } from "next/server";
import { requireAuth, getCurrentUser, isOwner } from "@/lib/auth";
import { redactInventoryItem } from "@/lib/redact";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const __denied = await requireAuth();
  if (__denied) return __denied;
  const { searchParams } = new URL(request.url);
  const q = String(searchParams.get("q") || "").trim();
  const lowOnly = searchParams.get("low") === "1";

  try {
    const items = await prisma.inventoryItem.findMany({
      where: q
        ? {
            OR: [
              { name: { contains: q } },
              { sku: { contains: q } },
              { category: { contains: q } },
            ],
          }
        : {},
      orderBy: { name: "asc" },
    });
    const owner = isOwner(await getCurrentUser());
    const result = lowOnly ? items.filter((i) => i.quantityOnHand <= i.minStockLevel) : items;
    return NextResponse.json(result.map((i) => redactInventoryItem(i, owner)));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to load inventory" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const __denied = await requireAuth();
  if (__denied) return __denied;
  try {
    const owner = isOwner(await getCurrentUser());
    const b = await request.json();
    const name = String(b.name || "").trim();
    if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

    const item = await prisma.inventoryItem.create({
      data: {
        name,
        sku: String(b.sku || "").trim() || null,
        category: String(b.category || "").trim() || null,
        unit: String(b.unit || "pcs").trim() || "pcs",
        quantityOnHand: Number(b.quantityOnHand) || 0,
        costPrice: owner ? Number(b.costPrice) || 0 : 0, // only the boss sets cost
        sellingPrice: Number(b.sellingPrice) || 0,
        minStockLevel: Number(b.minStockLevel) || 0,
        notes: String(b.notes || "").trim() || null,
      },
    });
    return NextResponse.json(redactInventoryItem(item, owner), { status: 201 });
  } catch (e: any) {
    console.error(e);
    if (e.code === "P2002") return NextResponse.json({ error: "SKU already exists" }, { status: 409 });
    return NextResponse.json({ error: "Failed to create item" }, { status: 500 });
  }
}
