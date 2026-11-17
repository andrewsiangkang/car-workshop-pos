import { NextResponse } from "next/server";
import { requireAuth, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth(); if (denied) return denied;
  const { id } = await params;
  const rows = await prisma.partReservation.findMany({ where: { workOrderId: id }, include: { inventoryItem: true, issues: true }, orderBy: { reservedAt: "desc" } });
  return NextResponse.json(rows);
}
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth(); if (denied) return denied;
  try {
    const actor = await getCurrentUser(); if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id: workOrderId } = await params;
    const b = await request.json();
    const action = String(b.action || "reserve");
    const inventoryItemId = String(b.inventoryItemId || "");
    const quantity = Number(b.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) return NextResponse.json({ error: "Quantity must be greater than zero" }, { status: 400 });
    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.workOrder.findUnique({ where: { id: workOrderId }, select: { id: true, status: true } });
      if (!order || order.status === "CANCELLED") throw new Error("Active work order required");
      const item = await tx.inventoryItem.findUnique({ where: { id: inventoryItemId } });
      if (!item || item.archivedAt) throw new Error("Active inventory item not found");
      if (action === "reserve") {
        const reserved = await tx.partReservation.aggregate({ where: { inventoryItemId, status: "RESERVED" }, _sum: { quantity: true } });
        const available = item.quantityOnHand - (reserved._sum.quantity || 0);
        if (available + 1e-9 < quantity) throw new Error(`Insufficient available stock. Available: ${Math.max(0, available)}`);
        return tx.partReservation.create({ data: { workOrderId, inventoryItemId, quantity, reservedById: actor.id, notes: b.notes ? String(b.notes).slice(0,500) : null } });
      }
      const reservationId = String(b.reservationId || "");
      const reservation = reservationId ? await tx.partReservation.findFirst({ where: { id: reservationId, workOrderId, inventoryItemId } }) : null;
      if (action === "release") {
        if (!reservation || reservation.status !== "RESERVED") throw new Error("Active reservation not found");
        return tx.partReservation.update({ where: { id: reservation.id }, data: { status: "RELEASED" } });
      }
      if (action === "issue" || action === "return") {
        const idempotencyKey = String(b.idempotencyKey || "").trim();
        if (idempotencyKey.length < 12 || idempotencyKey.length > 128) throw new Error("A client-generated idempotency key (12–128 characters) is required");
        const duplicate = await tx.partIssue.findUnique({ where: { idempotencyKey } });
        if (duplicate) {
          if (duplicate.workOrderId !== workOrderId || duplicate.inventoryItemId !== inventoryItemId || duplicate.reservationId !== (reservation?.id || null) || duplicate.movementType !== (action === "issue" ? "ISSUE" : "RETURN") || Math.abs(duplicate.quantity - quantity) > 0.000001) throw new Error("Idempotency key was already used for a different parts operation");
          return duplicate;
        }
        if (action === "issue") {
          if (!reservation || reservation.status !== "RESERVED") throw new Error("An active reservation is required before issuing parts");
          if (Math.abs(reservation.quantity - quantity) > 0.000001) throw new Error("Issue the full reserved quantity in one transaction; partial issue is not supported yet");
          if (item.quantityOnHand + 1e-9 < quantity) throw new Error("Insufficient stock");
          await tx.inventoryItem.update({ where: { id: item.id }, data: { quantityOnHand: { decrement: quantity } } });
          await tx.stockMovement.create({ data: { type: "OUT", quantity: -quantity, notes: `Work order ${workOrderId} part issue`, inventoryItemId, workOrderId } });
          if (reservation) await tx.partReservation.update({ where: { id: reservation.id }, data: { status: "ISSUED" } });
        } else {
          if (!reservation || reservation.status !== "ISSUED") throw new Error("A previously issued reservation is required before returning parts");
          const prior = await tx.partIssue.findMany({ where: { reservationId: reservation.id }, select: { movementType: true, quantity: true } });
          const issued = prior.filter((x) => x.movementType === "ISSUE").reduce((sum, x) => sum + x.quantity, 0);
          const returned = prior.filter((x) => x.movementType === "RETURN").reduce((sum, x) => sum + x.quantity, 0);
          const outstanding = issued - returned;
          if (quantity - outstanding > 0.000001) throw new Error(`Return quantity exceeds issued quantity. Remaining returnable: ${Math.max(0, outstanding)}`);
          if (outstanding - quantity <= 0.000001) await tx.partReservation.update({ where: { id: reservation.id }, data: { status: "RELEASED" } });
          await tx.inventoryItem.update({ where: { id: item.id }, data: { quantityOnHand: { increment: quantity } } });
          await tx.stockMovement.create({ data: { type: "IN", quantity, notes: `Work order ${workOrderId} part return`, inventoryItemId, workOrderId } });
        }
        return tx.partIssue.create({ data: { reservationId: reservation?.id || null, workOrderId, inventoryItemId, quantity, movementType: action === "issue" ? "ISSUE" : "RETURN", idempotencyKey, createdById: actor.id, notes: b.notes ? String(b.notes).slice(0,500) : null } });
      }
      throw new Error("Unsupported parts action");
    });
    await writeAuditLog({ actor, request, action: `WORK_ORDER_PART_${action.toUpperCase()}`, entityType: "WorkOrder", entityId: workOrderId, summary: `Work order parts ${action}` });
    return NextResponse.json(result, { status: action === "reserve" ? 201 : 200 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update parts" }, { status: 400 }); }
}
