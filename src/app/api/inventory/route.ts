import { NextResponse } from "next/server";
import { requireAuth, getCurrentUser, isOwner } from "@/lib/auth";
import { redactInventoryItem } from "@/lib/redact";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { archivedWhere } from "@/lib/money-inventory.mjs";

export const dynamic = "force-dynamic";

/**
 * Inventory list. Archived ("deleted") items are left out by default, so they never appear in the
 * part pickers; ?archived=1 adds them (the inventory page's "Show archived"), ?archived=only lists
 * just those. 【中文】默认不列出已归档（已删除）的项目，选零件时也看不到；archived=1 连归档的一起列出。
 */
export async function GET(request: Request) {
  const __denied = await requireAuth();
  if (__denied) return __denied;
  const { searchParams } = new URL(request.url);
  const q = String(searchParams.get("q") || "").trim();
  const lowOnly = searchParams.get("low") === "1";
  const archivedParam = searchParams.get("archived");
  const mode = archivedParam === "1" ? "all" : archivedParam === "only" ? "archived" : "active";

  try {
    const items = await prisma.inventoryItem.findMany({
      where: {
        ...archivedWhere(mode),
        ...(q
          ? {
              OR: [
                { name: { contains: q } },
                { sku: { contains: q } },
                { category: { contains: q } },
              ],
            }
          : {}),
      },
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
    const actor = await getCurrentUser();
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const owner = isOwner(actor);
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
    await writeAuditLog({ actor, request, action: "INVENTORY_CREATED", entityType: "InventoryItem", entityId: item.id, summary: `Inventory item created: ${item.name}`, details: { sku: item.sku, quantityOnHand: item.quantityOnHand } });
    return NextResponse.json(redactInventoryItem(item, owner), { status: 201 });
  } catch (e: unknown) {
    console.error(e);
    if ((e as { code?: string } | null)?.code === "P2002") return NextResponse.json({ error: "SKU already exists" }, { status: 409 });
    return NextResponse.json({ error: "Failed to create item" }, { status: 500 });
  }
}
