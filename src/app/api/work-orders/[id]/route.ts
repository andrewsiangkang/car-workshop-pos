import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { nextDocNumber } from "@/lib/docnumber";
import { VALID_STATUSES, PAYMENT_METHODS } from "@/lib/status";

export const dynamic = "force-dynamic";

const include = { customer: true, vehicle: true, items: true, payments: true };

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const __denied = await requireAuth();
  if (__denied) return __denied;
  try {
    const { id } = await params;
    const order = await prisma.workOrder.findUnique({
      where: { id },
      include: { ...include, createdBy: { select: { name: true } } },
    });
    if (!order) return NextResponse.json({ error: "Work order not found" }, { status: 404 });
    return NextResponse.json(order);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to load" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const __denied = await requireAuth();
  if (__denied) return __denied;
  try {
    const { id } = await params;
    const body = await request.json();
    const action = body.action as string;

    const order = await prisma.workOrder.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!order) return NextResponse.json({ error: "Work order not found" }, { status: 404 });

    if (action === "generate_invoice") {
      if (order.invoiceNumber) {
        return NextResponse.json(
          await prisma.workOrder.findUnique({ where: { id }, include })
        );
      }
      if (order.status === "CANCELLED") {
        return NextResponse.json({ error: "Cancelled work order cannot generate invoice" }, { status: 400 });
      }
      const invoiceNumber = await nextDocNumber("INV", "invoiceNumber");
      const updated = await prisma.workOrder.update({
        where: { id },
        data: {
          invoiceNumber,
          status: "COMPLETED",
          invoicedAt: new Date(),
          completedAt: order.completedAt || new Date(),
        },
        include,
      });
      return NextResponse.json(updated);
    }

    if (action === "record_payment") {
      if (!order.invoiceNumber) {
        return NextResponse.json({ error: "Please generate invoice before recording payment" }, { status: 400 });
      }
      const remaining = Math.max(0, order.totalAmount - order.paidAmount);
      if (remaining <= 0.0001) {
        return NextResponse.json({ error: "This work order is fully paid" }, { status: 400 });
      }
      const amount =
        body.amount === undefined || body.amount === "" ? remaining : Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ error: "Invalid payment amount" }, { status: 400 });
      }
      if (amount > remaining + 0.0001) {
        return NextResponse.json(
          { error: `Payment amount cannot exceed remaining balance RM ${remaining.toFixed(2)}` },
          { status: 400 }
        );
      }
      const method = PAYMENT_METHODS.includes(body.method) ? body.method : "CASH";
      const receiptNumber = order.receiptNumber || (await nextDocNumber("RC", "receiptNumber"));

      const updated = await prisma.$transaction(async (tx) => {
        await tx.payment.create({
          data: { amount, method, workOrderId: id, notes: body.notes || null, reference: body.reference || null },
        });
        return tx.workOrder.update({
          where: { id },
          data: {
            receiptNumber,
            paidAmount: order.paidAmount + amount,
            paidAt: new Date(),
          },
          include,
        });
      });
      return NextResponse.json(updated);
    }

    if (action === "save_einvoice") {
      const uuid = String(body.uuid || "").trim();
      const longId = String(body.longId || "").trim() || null;
      if (!uuid) {
        return NextResponse.json({ error: "UUID is required" }, { status: 400 });
      }
      const updated = await prisma.workOrder.update({
        where: { id },
        data: {
          eInvoiceUuid: uuid,
          eInvoiceLongId: longId,
          eInvoiceStatus: longId ? "valid" : "pending",
        },
        include,
      });
      return NextResponse.json(updated);
    }

    if (action === "update_status") {
      if (!VALID_STATUSES.includes(body.status)) {
        return NextResponse.json({ error: "状态无效" }, { status: 400 });
      }
      const data: Record<string, unknown> = { status: body.status };
      if (body.status === "CONFIRMED") data.confirmedAt = new Date();
      if (body.status === "COMPLETED") data.completedAt = order.completedAt || new Date();
      const updated = await prisma.workOrder.update({ where: { id }, data, include });
      return NextResponse.json(updated);
    }

    return NextResponse.json({ error: "未知操作" }, { status: 400 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "更新失败" }, { status: 500 });
  }
}
