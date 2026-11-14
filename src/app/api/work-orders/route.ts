import { NextResponse } from "next/server";
import { requireAuth, getCurrentUser, isOwner } from "@/lib/auth";
import { redactOrder, redactBuyerForList } from "@/lib/redact";
import { prisma } from "@/lib/prisma";
import { nextDocNumber, money } from "@/lib/docnumber";
import { computeTotals, effectiveRate, normaliseScope } from "@/lib/tax";
import { writeAuditLog } from "@/lib/audit";
import { auditFieldChanges } from "@/lib/privacy-audit.mjs";
import { normalisePlate, customerPhoneKey, sameCustomerName } from "@/lib/customer-match.mjs";
import { findCustomerByPhone } from "@/lib/customer-lookup";

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
    // Staff: no cost prices, and no buyer ID / TIN / e-mail / address in this bulk list.
    return NextResponse.json(orders.map((o) => redactBuyerForList(redactOrder(o, owner), owner)));
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

/** Thrown inside the transaction to answer with a specific status / body instead of 500. */
class ReplyError extends Error {
  constructor(public status: number, public body: Record<string, unknown>) {
    super(String(body.error || "Request failed"));
  }
}

export async function POST(request: Request) {
  const __denied = await requireAuth();
  if (__denied) return __denied;
  try {
    const body = await request.json();

    // Same plate / phone rules as the plate lookup and the Customers page
    // ("WXY 1234" = "wxy1234"; "012-345 6789" = "0123456789"; "N/A" = no phone).
    const plate = normalisePlate(body.plate);
    const typedName = String(body.customerName || "").replace(/\s+/g, " ").trim().slice(0, 200);
    const phone = customerPhoneKey(body.phone);
    if (!plate) {
      return NextResponse.json({ error: "Please fill in plate number" }, { status: 400 });
    }

    // The work order is created by whoever is logged in (boss or staff)
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const owner = isOwner(user);

    const mileage = body.mileage ? parseInt(body.mileage, 10) || null : null;
    const rawItems: InItem[] = Array.isArray(body.items) ? body.items.slice(0, 200) : [];
    const typedItems = rawItems.filter((it) => String(it?.description || "").trim());
    if (!typedItems.length) {
      return NextResponse.json({ error: "Please add at least one line item" }, { status: 400 });
    }
    // A blank or 0 quantity used to be saved and charged as 1 (and took 1 off stock) while the
    // preview showed RM0.00. Refuse it instead.
    if (typedItems.some((it) => !(Number(it.quantity) > 0))) {
      return NextResponse.json({ error: "Every line needs a quantity greater than 0" }, { status: 400 });
    }
    // true = rename the existing customer to the typed name, false = keep the existing name,
    // undefined = not asked yet.
    const renameCustomer: boolean | undefined =
      body.renameCustomer === true ? true : body.renameCustomer === false ? false : undefined;

    // Everything below runs in ONE transaction: customer, vehicle, order and document
    // numbers. A failure part-way no longer leaves half-saved data, and two people saving
    // at the same time cannot receive the same document number.
    const { order, renamed } = await prisma.$transaction(async (tx) => {
    let renamed: { id: string; from: string; to: string } | null = null;
    // Customers are matched by phone number only — never by an empty or placeholder phone
    // ("N/A", "-"…): that used to merge a returning walk-in into the oldest "N/A" customer
    // and rename them. A walk-in without a phone keeps the car's current walk-in record
    // when the name still matches; otherwise they get their own record.
    const existingVehicle = await tx.vehicle.findUnique({ where: { plateNumber: plate }, include: { customer: true } });
    let customer = phone ? await findCustomerByPhone(tx, phone) : null;
    if (!customer && !phone) {
      const vc = existingVehicle?.customer;
      // An anonymised customer (PDPA) is never given new jobs: the car gets a new walk-in record.
      if (vc && !vc.anonymisedAt && !customerPhoneKey(vc.phone) && (!typedName || sameCustomerName(typedName, vc.name))) customer = vc;
    }
    if (!customer) {
      customer = await tx.customer.create({
        data: { name: typedName || `Walk-in (${plate})`, phone: phone || "N/A" },
      });
    } else if (typedName && !sameCustomerName(typedName, customer.name)) {
      // A different name on a known phone: ask first, never rename silently (the name is
      // printed on this customer's invoices).
      if (renameCustomer === undefined) {
        throw new ReplyError(409, {
          code: "CUSTOMER_NAME_DIFFERS",
          error: "This phone number belongs to an existing customer with a different name",
          currentName: customer.name,
          typedName,
        });
      }
      if (renameCustomer) {
        renamed = { id: customer.id, from: customer.name, to: typedName };
        customer = await tx.customer.update({
          where: { id: customer.id },
          data: { name: typedName },
        });
      }
    }

    // Make / model: only a real value replaces what is on file; "Unknown" is the default
    // for a NEW car only (an older page sent "Unknown" for blank fields and wiped them).
    const typedMake = String(body.make || "").trim().slice(0, 100);
    const typedModel = String(body.model || "").trim().slice(0, 100);
    const real = (v: string) => (v && v.toLowerCase() !== "unknown" ? v : "");
    let vehicle = existingVehicle;
    if (!vehicle) {
      vehicle = await tx.vehicle.create({
        data: {
          plateNumber: plate,
          make: typedMake || "Unknown",
          model: typedModel || "Unknown",
          year: body.year ? Number(body.year) || null : null,
          mileage,
          customerId: customer.id,
        },
        include: { customer: true },
      });
    } else {
      vehicle = await tx.vehicle.update({
        where: { id: vehicle.id },
        data: {
          mileage: mileage ?? vehicle.mileage,
          customerId: customer.id,
          make: real(typedMake) || vehicle.make,
          model: real(typedModel) || vehicle.model,
        },
        include: { customer: true },
      });
    }

    // Cost price is boss-only data. For parts linked to inventory, the server always
    // looks the cost up itself (staff never see or send it). For free-typed parts,
    // only the boss can supply a cost price.
    const linkedIds = Array.from(
      new Set(typedItems.map((it) => it.inventoryItemId).filter((v): v is string => !!v))
    );
    const linked = linkedIds.length
      ? await tx.inventoryItem.findMany({
          where: { id: { in: linkedIds } },
          select: { id: true, costPrice: true, archivedAt: true },
        })
      : [];
    // The pickers hide archived items; a stale form must not link one either (it could not be
    // invoiced). 【中文】已归档的库存项目不能加进新工单，请先恢复。
    if (linked.some((i) => i.archivedAt && typedItems.some((it) => it.type !== "LABOR" && it.inventoryItemId === i.id))) {
      throw new ReplyError(400, { error: "This item is archived. Restore it first.", code: "ITEM_ARCHIVED" });
    }
    const costById = new Map(linked.map((i) => [i.id, i.costPrice]));

    const items = typedItems.map((it) => {
        const quantity = Math.min(100000, Number(it.quantity));
        const unitPrice = money(Math.min(10_000_000, Math.max(0, Number(it.unitPrice) || 0)));
        // Ignore links to inventory items that no longer exist (used to crash the save), and on
        // labour lines: stock is only deducted / returned for PART lines, so a linked LABOR line
        // would sell the item without it ever leaving stock. 【中文】工钱行不保留库存关联。
        const invId = it.type !== "LABOR" && it.inventoryItemId && costById.has(it.inventoryItemId) ? it.inventoryItemId : null;
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

    // Stock is NOT taken here any more: a quote that never goes ahead must not hold parts.
    // Parts are taken off stock when the invoice is issued (generate_invoice).
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
    return { order: created, renamed };
    }, { timeout: 15000 });

    if (renamed) {
      // Names only as "changed" (as CUSTOMER_UPDATED): the hash-chained audit trail can never be
      // edited, so it must not keep a customer's names after they are anonymised.
      // 【中文】名字只记「已修改」：审计日志不能修改，客户匿名化后不能还留着名字。
      await writeAuditLog({ actor: user, request, action: "CUSTOMER_RENAMED", entityType: "Customer", entityId: renamed.id, summary: `Customer renamed while creating ${order.orderNumber}`, details: { ...auditFieldChanges({ name: renamed.from }, { name: renamed.to }, { opaque: ["name"] }), workOrderId: order.id } });
    }
    await writeAuditLog({ actor: user, request, action: "WORK_ORDER_CREATED", entityType: "WorkOrder", entityId: order.id, summary: `Work order ${order.orderNumber} created`, details: { orderNumber: order.orderNumber, itemCount: order.items.length, totalAmount: order.totalAmount } });
    return NextResponse.json(redactOrder(order, owner), { status: 201 });
  } catch (e) {
    if (e instanceof ReplyError) return NextResponse.json(e.body, { status: e.status });
    console.error(e);
    return NextResponse.json({ error: "Failed to create work order" }, { status: 500 });
  }
}
