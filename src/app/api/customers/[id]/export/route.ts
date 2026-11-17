import { NextResponse } from "next/server";
import { requireOwner, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

function parseJson(text: string | null) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * "Export this customer's data" (boss only, PDPA access request): one JSON file with the customer
 * record, vehicles, jobs / invoices (with items, payments and credit notes, and the particulars
 * frozen on issued documents) and references to the audit entries about them. Cost prices and
 * other shop-internal numbers are left out. Every export is recorded in the audit trail.
 * 【中文】导出这位客户的资料（老板专用，PDPA 查阅请求）：客户记录、车辆、工单 / 发票（含项目、付款、退款单、
 * 开出时冻结的资料）以及相关审计记录的索引；不含成本价等内部数字。每次导出都写入审计日志。
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const { id } = await params;
    const actor = await getCurrentUser();
    const customer = await prisma.customer.findUnique({
      where: { id },
      include: {
        vehicles: { orderBy: { createdAt: "asc" } },
        workOrders: {
          orderBy: { createdAt: "asc" },
          include: {
            vehicle: { select: { plateNumber: true } },
            items: { select: { type: true, description: true, quantity: true, unitPrice: true, total: true } },
            payments: { select: { amount: true, method: true, reference: true, paidAt: true }, orderBy: { paidAt: "asc" } },
            creditNotes: {
              select: { id: true, number: true, amount: true, taxAmount: true, refundAmount: true, refundMethod: true, reason: true, createdAt: true, eInvoiceUuid: true, eInvoiceStatus: true, docSnapshot: true },
              orderBy: { createdAt: "asc" },
            },
          },
        },
      },
    });
    if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    const shop = await prisma.shopProfile.findFirst({ select: { name: true, phone: true, email: true } });

    const orderIds = customer.workOrders.map((o) => o.id);
    const vehicleIds = customer.vehicles.map((v) => v.id);
    const creditNoteIds = customer.workOrders.flatMap((o) => o.creditNotes.map((c) => c.id));
    const auditReferences = await prisma.auditLog.findMany({
      where: {
        OR: [
          { entityType: "Customer", entityId: id },
          ...(orderIds.length ? [{ entityType: "WorkOrder", entityId: { in: orderIds } }] : []),
          ...(vehicleIds.length ? [{ entityType: "Vehicle", entityId: { in: vehicleIds } }] : []),
          ...(creditNoteIds.length ? [{ entityType: "CreditNote", entityId: { in: creditNoteIds } }] : []),
        ],
      },
      orderBy: { createdAt: "asc" },
      take: 5000,
      select: { id: true, seq: true, createdAt: true, action: true, entityType: true, entityId: true, summary: true },
    });

    const exportedAt = new Date();
    const file = {
      about: "Personal data held about one customer, exported at the customer's request (PDPA). Amounts in RM.",
      exportedAt: exportedAt.toISOString(),
      exportedBy: actor?.name ?? null,
      shop: shop ?? null,
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        tin: customer.tin,
        address: customer.address,
        postcode: customer.postcode,
        city: customer.city,
        stateCode: customer.stateCode,
        notes: customer.notes,
        reminderLanguage: customer.language,
        reminderConsentAt: customer.reminderConsentAt,
        reminderOptOutAt: customer.reminderOptOutAt,
        anonymisedAt: customer.anonymisedAt,
        createdAt: customer.createdAt,
        updatedAt: customer.updatedAt,
      },
      vehicles: customer.vehicles.map((v) => ({
        plateNumber: v.plateNumber, make: v.make, model: v.model, year: v.year, color: v.color, vin: v.vin,
        mileage: v.mileage, notes: v.notes, lastServiceDate: v.lastServiceDate, lastServiceMileage: v.lastServiceMileage,
        nextServiceDate: v.nextServiceDate, nextServiceMileage: v.nextServiceMileage, createdAt: v.createdAt,
      })),
      workOrders: customer.workOrders.map((o) => ({
        orderNumber: o.orderNumber,
        quotationNumber: o.quotationNumber,
        invoiceNumber: o.invoiceNumber,
        receiptNumber: o.receiptNumber,
        status: o.status,
        plateNumber: o.vehicle?.plateNumber ?? null,
        description: o.description,
        diagnosis: o.diagnosis,
        mileageIn: o.mileageIn,
        mileageOut: o.mileageOut,
        createdAt: o.createdAt,
        invoicedAt: o.invoicedAt,
        paidAt: o.paidAt,
        totalAmount: o.totalAmount,
        discount: o.discount,
        taxAmount: o.taxAmount,
        paidAmount: o.paidAmount,
        creditedAmount: o.creditedAmount,
        items: o.items,
        payments: o.payments,
        creditNotes: o.creditNotes.map((c) => ({ ...c, id: undefined, docSnapshot: undefined, issuedParticulars: parseJson(c.docSnapshot) })),
        eInvoice: o.eInvoiceUuid ? { uuid: o.eInvoiceUuid, status: o.eInvoiceStatus, environment: o.eInvoiceEnv } : null,
        buyerRequest: o.buyerRequestedAt
          ? {
              requestedAt: o.buyerRequestedAt, consentAt: o.buyerConsentAt, consentNotice: o.buyerConsentNotice,
              name: o.buyerName, tin: o.buyerTin, idType: o.buyerIdType, idNo: o.buyerIdNo, email: o.buyerEmail,
              phone: o.buyerPhone, address: o.buyerAddress, postcode: o.buyerPostcode, city: o.buyerCity, stateCode: o.buyerStateCode,
            }
          : null,
        issuedParticulars: parseJson(o.docSnapshot),
      })),
      auditReferences,
    };

    if (actor) {
      await writeAuditLog({
        actor,
        request,
        action: "CUSTOMER_DATA_EXPORTED",
        entityType: "Customer",
        entityId: id,
        summary: "Customer's personal data exported",
        details: { vehicles: file.vehicles.length, workOrders: file.workOrders.length, auditReferences: auditReferences.length },
      });
    }
    const day = exportedAt.toISOString().slice(0, 10);
    return new NextResponse(JSON.stringify(file, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="customer-data-${id}-${day}.json"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
