import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { nextDocNumber } from "@/lib/docnumber";

export const dynamic = "force-dynamic";

export async function GET() {
  const __denied = await requireAuth();
  if (__denied) return __denied;
  try {
    const orders = await prisma.workOrder.findMany({
      orderBy: { createdAt: "desc" },
      include: { customer: true, vehicle: true, items: true, payments: true },
      take: 200,
    });
    return NextResponse.json(orders);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to load work orders" }, { status: 500 });
  }
}

type InItem = {
  type?: string;
  description?: string;
  quantity?: number;
  unitPrice?: number;
  costPrice?: number;
  inventoryItemId?: string | null;
};

export async function POST(request: Request) {
  const __denied = await requireAuth();
  if (__denied) return __denied;
  try {
    const body = await request.json();

    const plate = String(body.plate || "").trim().toUpperCase();
    const customerName = String(body.customerName || "").trim() || plate; // fallback to plate if no name
    const phone = String(body.phone || "").trim() || "N/A";
    if (!plate) {
      return NextResponse.json({ error: "Please fill in plate number" }, { status: 400 });
    }

    // Single-user local app: one owner record is created automatically
    let user = await prisma.user.findFirst({ where: { role: "OWNER" } });
    if (!user) {
      const bcrypt = await import("bcryptjs");
      const hash = await bcrypt.hash(Math.random().toString(36), 10);
      user = await prisma.user.create({
        data: { name: "Owner", email: "owner@local", passwordHash: hash, role: "OWNER" },
      });
    }

    let customer = await prisma.customer.findFirst({ where: { phone } });
    if (!customer) {
      customer = await prisma.customer.create({ data: { name: customerName, phone } });
    } else if (customerName !== customer.name) {
      customer = await prisma.customer.update({
        where: { id: customer.id },
        data: { name: customerName },
      });
    }

    const mileage = body.mileage ? parseInt(body.mileage, 10) || null : null;

    let vehicle = await prisma.vehicle.findUnique({ where: { plateNumber: plate } });
    if (!vehicle) {
      vehicle = await prisma.vehicle.create({
        data: {
          plateNumber: plate,
          make: String(body.make || "").trim() || "Unknown",
          model: String(body.model || "").trim() || "Unknown",
          year: body.year ? Number(body.year) || null : null,
          mileage,
          customerId: customer.id,
        },
      });
    } else {
      vehicle = await prisma.vehicle.update({
        where: { id: vehicle.id },
        data: {
          mileage: mileage ?? vehicle.mileage,
          customerId: customer.id,
          make: String(body.make || "").trim() || vehicle.make,
          model: String(body.model || "").trim() || vehicle.model,
        },
      });
    }

    const rawItems: InItem[] = Array.isArray(body.items) ? body.items : [];

    const items = rawItems
      .filter((it) => String(it.description || "").trim())
      .map((it) => {
        const quantity = Math.max(0, Number(it.quantity) || 1);
        const unitPrice = Math.max(0, Number(it.unitPrice) || 0);
        return {
          type: it.type === "LABOR" ? "LABOR" : "PART",
          description: String(it.description).trim(),
          quantity,
          unitPrice,
          costPrice: Number(it.costPrice) || 0,
          total: quantity * unitPrice,
          inventoryItemId: it.inventoryItemId || null,
        };
      });
    if (items.length === 0) {
      return NextResponse.json({ error: "Please add at least one line item" }, { status: 400 });
    }

    const partsAmount = items.filter((i) => i.type === "PART").reduce((s, i) => s + i.total, 0);
    const laborAmount = items.filter((i) => i.type === "LABOR").reduce((s, i) => s + i.total, 0);
    const discount = Math.max(0, Number(body.discount) || 0);
    const totalAmount = Math.max(0, partsAmount + laborAmount - discount);

    const order = await prisma.workOrder.create({
      data: {
        orderNumber: await nextDocNumber("WO", "orderNumber"),
        quotationNumber: await nextDocNumber("QT", "quotationNumber"),
        status: "QUOTED",
        description: body.description || null,
        diagnosis: body.diagnosis || null,
        mileageIn: mileage,
        totalAmount,
        partsAmount,
        laborAmount,
        discount,
        quotedAt: new Date(),
        customerId: customer.id,
        vehicleId: vehicle.id,
        createdById: user.id,
        items: { create: items },
      },
      include: { customer: true, vehicle: true, items: true },
    });

    // Deduct inventory for PART items that are linked
    for (const it of items) {
      if (it.type === "PART" && it.inventoryItemId) {
        const inv = await prisma.inventoryItem.findUnique({ where: { id: it.inventoryItemId } });
        if (inv) {
          const newQty = Math.max(0, inv.quantityOnHand - it.quantity);
          await prisma.inventoryItem.update({
            where: { id: inv.id },
            data: { quantityOnHand: newQty },
          });
          await prisma.stockMovement.create({
            data: {
              inventoryItemId: inv.id,
              type: "OUT",
              quantity: -it.quantity,
              notes: `Used in ${order.orderNumber}`,
              workOrderId: order.id,
            },
          });
        }
      }
    }

    return NextResponse.json(order, { status: 201 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to create work order" }, { status: 500 });
  }
}
