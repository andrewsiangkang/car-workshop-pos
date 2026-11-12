import { NextResponse } from "next/server";
import { requireAuth, requireOwner, getCurrentUser, isOwner } from "@/lib/auth";
import { redactInventoryItem } from "@/lib/redact";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const __denied = await requireAuth();
  if (__denied) return __denied;
  const { id } = await params;
  try {
    const actor = await getCurrentUser();
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const owner = isOwner(actor);
    const b = await request.json();
    const data: any = {};
    if (b.name != null) {
      data.name = String(b.name).trim();
      if (!data.name) return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
    }
    if (b.sku != null) data.sku = String(b.sku).trim() || null;
    if (b.category != null) data.category = String(b.category).trim() || null;
    if (b.unit != null) data.unit = String(b.unit).trim() || "pcs";
    if (owner && b.costPrice != null) data.costPrice = Number(b.costPrice) || 0; // boss only
    if (b.sellingPrice != null) data.sellingPrice = Number(b.sellingPrice) || 0;
    if (b.minStockLevel != null) data.minStockLevel = Number(b.minStockLevel) || 0;
    if (b.notes != null) data.notes = String(b.notes).trim() || null;

    const item = await prisma.inventoryItem.update({ where: { id }, data });
    await writeAuditLog({ actor, request, action: "INVENTORY_UPDATED", entityType: "InventoryItem", entityId: id, summary: `Inventory item updated: ${item.name}`, details: { changedFields: Object.keys(data) } });
    return NextResponse.json(redactInventoryItem(item, owner));
  } catch (e: any) {
    console.error(e);
    if (e.code === "P2002") return NextResponse.json({ error: "SKU already exists" }, { status: 409 });
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const __denied = await requireOwner();
  if (__denied) return __denied;
  const actor = await getCurrentUser();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    // Deleting would also wipe its stock history (cascade). Business records must be
    // kept for 7 years (Income Tax Act s.82), so items already used on jobs stay.
    const used = await prisma.workOrderItem.count({ where: { inventoryItemId: id } });
    if (used > 0) {
      return NextResponse.json(
        { error: "This item is used on past work orders and cannot be deleted. Set its stock to 0 instead." },
        { status: 409 }
      );
    }
    const removed = await prisma.inventoryItem.findUnique({ where: { id }, select: { name: true, sku: true } });
    await prisma.inventoryItem.delete({ where: { id } });
    await writeAuditLog({ actor, action: "INVENTORY_DELETED", entityType: "InventoryItem", entityId: id, summary: `Inventory item deleted: ${removed?.name || id}`, details: { sku: removed?.sku || null } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}
