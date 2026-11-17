import { NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { requireAuth, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const denied = await requireAuth(); if (denied) return denied;
  try {
    const actor = await getCurrentUser(); if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const b = await request.json();
    const workOrderId = String(b.workOrderId || "");
    const order = await prisma.workOrder.findUnique({ where: { id: workOrderId }, include: { items: true, customer: { select: { name: true } }, vehicle: { select: { plateNumber: true } } } });
    if (!order || order.status === "CANCELLED") return NextResponse.json({ error: "Active work order required" }, { status: 400 });
    if (order.items.length === 0) return NextResponse.json({ error: "Add at least one quotation line before requesting customer approval" }, { status: 400 });
    const latest = await prisma.customerApproval.findFirst({ where: { workOrderId }, orderBy: { revision: "desc" }, select: { revision: true } });
    const revision = (latest?.revision || 0) + 1;
    const token = randomUUID() + randomUUID();
    const snapshot = { orderNumber: order.orderNumber, customerName: order.customer.name, plateNumber: order.vehicle.plateNumber, items: order.items.map((i) => ({ workOrderItemId: i.id, description: i.description, quantity: i.quantity, unitPrice: i.unitPrice, total: i.total })) };
    const row = await prisma.customerApproval.create({ data: { workOrderId, revision, approvalMethod: b.approvalMethod === "SECURE_LINK" ? "SECURE_LINK" : "IN_PERSON", customerName: order.customer.name, snapshotJson: JSON.stringify(snapshot), tokenHash: b.approvalMethod === "SECURE_LINK" ? createHash("sha256").update(token).digest("hex") : null, expiresAt: b.approvalMethod === "SECURE_LINK" ? new Date(Date.now() + 48 * 60 * 60 * 1000) : null, lines: { create: order.items.map((i) => ({ workOrderItemId: i.id, description: i.description, quantity: i.quantity, unitPrice: i.unitPrice, total: i.total })) } }, include: { lines: true } });
    await writeAuditLog({ actor, request, action: "CUSTOMER_APPROVAL_CREATED", entityType: "CustomerApproval", entityId: row.id, summary: `Approval revision ${revision} created` });
    // The token is returned once to the authenticated staff UI; only its hash is stored.
    return NextResponse.json({ ...row, secureToken: b.approvalMethod === "SECURE_LINK" ? token : undefined }, { status: 201 });
  } catch (error) { console.error(error); return NextResponse.json({ error: "Unable to create approval request" }, { status: 400 }); }
}
