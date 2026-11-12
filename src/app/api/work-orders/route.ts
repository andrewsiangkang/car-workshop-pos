import { NextResponse } from "next/server";
import { requireAuth, getCurrentUser, isOwner } from "@/lib/auth";
import { redactOrder } from "@/lib/redact";
import { prisma } from "@/lib/prisma";
import { nextDocNumber, money } from "@/lib/docnumber";
import { computeTotals, effectiveRate, normaliseScope } from "@/lib/tax";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET() {
  const __denied = await requireAuth();
  if (__denied) return __denied;
  try {
    const me = await getCurrentUser();
    const owner = isOwner(me);
    const orders = await prisma.workOrder.findMany({
      orderBy: { createdAt: "desc" },
      include: { customer: true, vehicle: true, items: true, payments: true },
      take: 200,
    });
    return NextResponse.json(orders.map((o) => redactOrder(o, owner)));
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

    // Normalise plates so "WXY 1234" and "wxy1234" are the same car.
    const plate = String(body.plate || "").replace(/\s+/g, "").trim().toUpperCase().slice(0, 20);
    const typedName = String(body.customerName || "").trim().slice(0, 200);
    const phone = String(body.phone || "").replace(/[\s-]/g, "").trim().slice(0, 30);
    if (!plate) {
      return NextResponse.json({ error: "Please fill in plate number" }, { status: 400 });
    }

    // The work order is created by whoever is logged in (boss or staff)
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const owner = isOwner(user);

    const mileage = body.mileage ? parseInt(body.mileage, 10) || null : null;
    const rawItems: InItem[] = Array.isArray(body.items) ? body.items.slice(0, 200) : [];
    if (!rawItems.some((it) => String(it?.description || "").trim())) {
      return NextResponse.json({ error: "Please add at least one line item" }, { status: 400 });
    }

    // Everything below runs in ONE transaction: customer, vehicle, order, document
    // numbers and stock. A failure part-way no longer leaves half-saved data, and two
    // people saving at the same time cannot receive the same document number.
    const order = await prisma.$transaction(async (tx) => {
    // Customers are matched by phone number. Walk-in customers without a phone
    // each get their own record (previously they were ALL merged into one "N/A"
    // customer, and every new walk-in renamed it — changing the name printed on
    // every old invoice of that customer).
    let customer = phone ? await tx.customer.findFirst({ where: { phone } }) : null;
    if (!customer) {
      customer = await tx.customer.create({
        data: { name: typedName || `Walk-in (${plate})`, phone: phone || "N/A" },
      });
    } else if (typedName && typedName !== customer.name) {
      customer = await tx.customer.update({
        where: { id: customer.id },
        data: { name: typedName },
      });
    }

    let vehicle = await tx.vehicle.findUnique({ where: { plateNumber: plate } });
    if (!vehicle) {
      vehicle = await tx.vehicle.create({
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
      vehicle = await tx.vehicle.update({
        where: { id: vehicle.id },
        data: {
          mileage: mileage ?? vehicle.mileage,
          customerId: customer.id,
          make: String(body.make || "").trim() || vehicle.make,
          model: String(body.model || "").trim() || vehicle.model,
        },
      });
    }

    // Cost price is boss-only data. For parts linked to inventory, the server always
    // looks the cost up itself (staff never see or send it). For free-typed parts,
    // only the boss can supply a cost price.
    const linkedIds = Array.from(
      new Set(rawItems.map((it) => it.inventoryItemId).filter((v): v is string => !!v))
    );
    const linked = linkedIds.length
      ? await tx.inventoryItem.findMany({
          where: { id: { in: linkedIds } },
          select: { id: true, costPrice: true },
        })
      : [];
    const costById = new Map(linked.map((i) => [i.id, i.costPrice]));

    const items = rawItems
      .filter((it) => String(it.description || "").trim())
      .map((it) => {
        const quantity = Math.min(100000, Math.max(0, Number(it.quantity) || 1));
        const unitPrice = money(Math.min(10_000_000, Math.max(0, Number(it.unitPrice) || 0)));
        // Ignore links to inventory items that no longer exist (used to crash the save).
        const invId = it.inventoryItemId && costById.has(it.inventoryItemId) ? it.inventoryItemId : null;
        const costPrice =
          invId && costById.has(invId)
            ? (costById.get(invId) as number)
            : owner
            ? Math.max(0, Number(it.costPrice) || 0)
            : 0;
        return {
          type: it.type === "LABOR" ? "LABOR" : "PART",
          description: String(it.description).trim().slice(0, 500),
          quantity,
          unitPrice,
          costPrice,
          total: money(quantity * unitPrice),
          inventoryItemId: invId,
        };
      });

    // Totals incl. SST at the shop's current rate (0 if not SST-registered).
    // The discount can never be more than the bill.
    const shop = await tx.shopProfile.findFirst({ select: { sstNumber: true, sstRate: true, sstScope: true } });
    const { partsAmount, laborAmount, discount, taxRate, taxScope, taxAmount, totalAmount } = computeTotals(
      items,
      Number(body.discount) || 0,
      effectiveRate(shop),
      normaliseScope(shop?.sstScope)
    );

    const created = await tx.workOrder.create({
      data: {
        orderNumber: await nextDocNumber("WO", "orderNumber", tx),
        quotationNumber: await nextDocNumber("QT", "quotationNumber", tx),
        status: "QUOTED",
        description: String(body.description || "").slice(0, 2000) || null,
        diagnosis: String(body.diagnosis || "").slice(0, 2000) || null,
        mileageIn: mileage,
        totalAmount,
        partsAmount,
        laborAmount,
        discount,
        taxRate,
        taxScope,
        taxAmount,
        quotedAt: new Date(),
        customerId: customer.id,
        vehicleId: vehicle.id,
        createdById: user.id,
        items: { create: items },
      },
      include: { customer: true, vehicle: true, items: true },
    });

    // Deduct inventory for PART items that are linked. The movement records the
    // amount actually taken off (stock is never pushed below zero), so the stock
    // history always adds up to the quantity on hand.
    for (const it of items) {
      if (it.type === "PART" && it.inventoryItemId) {
        const inv = await tx.inventoryItem.findUnique({ where: { id: it.inventoryItemId } });
        if (inv) {
          const taken = Math.min(it.quantity, Math.max(0, inv.quantityOnHand));
          await tx.inventoryItem.update({
            where: { id: inv.id },
            data: { quantityOnHand: { decrement: taken } },
          });
          await tx.stockMovement.create({
            data: {
              inventoryItemId: inv.id,
              type: "OUT",
              quantity: -taken,
              notes:
                `Used in ${created.orderNumber}` +
                (taken < it.quantity ? ` (short ${it.quantity - taken} - stock was ${inv.quantityOnHand})` : ""),
              workOrderId: created.id,
            },
          });
        }
      }
    }
    return created;
    }, { timeout: 15000 });

    await writeAuditLog({ actor: user, request, action: "WORK_ORDER_CREATED", entityType: "WorkOrder", entityId: order.id, summary: `Work order ${order.orderNumber} created`, details: { orderNumber: order.orderNumber, itemCount: order.items.length, totalAmount: order.totalAmount } });
    return NextResponse.json(redactOrder(order, owner), { status: 201 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to create work order" }, { status: 500 });
  }
}
