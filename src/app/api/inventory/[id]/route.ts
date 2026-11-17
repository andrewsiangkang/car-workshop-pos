import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requireAuth, requireOwner, getCurrentUser, isOwner, type CurrentUser } from "@/lib/auth";
import { redactInventoryItem } from "@/lib/redact";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { archiveCheck, OPEN_JOB_STATUSES } from "@/lib/money-inventory.mjs";

export const dynamic = "force-dynamic";

class UserError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const EDITABLE = ["name", "sku", "category", "unit", "costPrice", "sellingPrice", "minStockLevel", "notes"] as const;
type Editable = (typeof EDITABLE)[number];

/**
 * Edit an item. The boss can also archive it ({ archived: true }, same as DELETE) or restore an
 * archived item ({ archived: false }). The audit log keeps the before / after value of every
 * field that really changed. 【中文】修改库存项目；老板也可以归档 / 恢复。审计日志记录每个真正改动字段的前后值。
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const __denied = await requireAuth();
  if (__denied) return __denied;
  const { id } = await params;
  try {
    const actor = await getCurrentUser();
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const owner = isOwner(actor);
    const b = await request.json();

    if (b.archived === true || b.archived === false) {
      if (!owner) return NextResponse.json({ error: "Only the boss can archive or restore stock items" }, { status: 403 });
      // awaited here so a refusal (409 "Stock on hand is …") reaches the catch below, not a bare 500.
      return b.archived ? await archiveItem(id, actor, request) : await restoreItem(id, actor, request);
    }

    const data: Prisma.InventoryItemUpdateInput = {};
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

    const result = await prisma.$transaction(async (tx) => {
      const before = await tx.inventoryItem.findUnique({ where: { id } });
      if (!before) return null;
      const item = await tx.inventoryItem.update({ where: { id }, data });
      return { before, item };
    });
    if (!result) return NextResponse.json({ error: "Item not found" }, { status: 404 });
    const { before, item } = result;
    // Only the fields whose value really changed (the edit form sends every field).
    const changed = EDITABLE.filter((k: Editable) => k in data && before[k] !== item[k]);
    if (changed.length) {
      const pick = (o: typeof item) => Object.fromEntries(changed.map((k) => [k, o[k]]));
      await writeAuditLog({
        actor, request, action: "INVENTORY_UPDATED", entityType: "InventoryItem", entityId: id,
        summary: `Inventory item updated: ${item.name}`,
        details: { changedFields: changed, before: pick(before), after: pick(item) },
      });
    }
    return NextResponse.json(redactInventoryItem(item, owner));
  } catch (e: unknown) {
    if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(e);
    if ((e as { code?: string } | null)?.code === "P2002") return NextResponse.json({ error: "SKU already exists" }, { status: 409 });
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}

/**
 * "Delete" archives the item: its stock movements, and the jobs and supplier invoices that used
 * it, are kept (7-year record keeping, Income Tax Act s.82). Refused while stock on hand is not 0
 * or while quotations / jobs not yet invoiced use it. 【中文】"删除"改为归档：进出库记录、用过它的工单和供应商发票都保留。库存不是 0 或有还没开发票的报价单 / 工单在用时不能归档。
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const __denied = await requireOwner();
  if (__denied) return __denied;
  const actor = await getCurrentUser();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    return await archiveItem(id, actor, request);
  } catch (e) {
    if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(e);
    return NextResponse.json({ error: "Failed to archive" }, { status: 500 });
  }
}

async function archiveItem(id: string, actor: CurrentUser, request: Request) {
  const item = await prisma.$transaction(async (tx) => {
    const cur = await tx.inventoryItem.findUnique({ where: { id } });
    if (!cur) throw new UserError("Item not found", 404);
    const openJobs = await tx.workOrder.findMany({
      where: { status: { in: OPEN_JOB_STATUSES }, invoiceNumber: null, items: { some: { inventoryItemId: id } } },
      select: { orderNumber: true },
      orderBy: { createdAt: "asc" },
    });
    const check = archiveCheck(cur, openJobs);
    if (!check.ok) throw new UserError(check.error, 409);
    return tx.inventoryItem.update({ where: { id }, data: { archivedAt: new Date() } });
  });
  await writeAuditLog({
    actor, request, action: "INVENTORY_ARCHIVED", entityType: "InventoryItem", entityId: id,
    summary: `Inventory item archived: ${item.name}`,
    details: { sku: item.sku, before: { archived: false }, after: { archived: true } },
  });
  return NextResponse.json({ ok: true, archived: true });
}

async function restoreItem(id: string, actor: CurrentUser, request: Request) {
  const cur = await prisma.inventoryItem.findUnique({ where: { id } });
  if (!cur) return NextResponse.json({ error: "Item not found" }, { status: 404 });
  if (!cur.archivedAt) return NextResponse.json({ error: "This item is not archived" }, { status: 400 });
  const item = await prisma.inventoryItem.update({ where: { id }, data: { archivedAt: null } });
  await writeAuditLog({
    actor, request, action: "INVENTORY_RESTORED", entityType: "InventoryItem", entityId: id,
    summary: `Inventory item restored: ${item.name}`,
    details: { sku: item.sku, before: { archived: true }, after: { archived: false } },
  });
  return NextResponse.json(redactInventoryItem(item, true));
}
