import { prisma } from "@/lib/prisma";
import type { DocData } from "@/components/documents/DocumentLayout";

export async function loadDocData(
  id: string,
  type: "quotation" | "invoice" | "receipt"
): Promise<{ data: DocData | null; missing: "order" | "number" | null }> {
  const order = await prisma.workOrder.findUnique({
    where: { id },
    include: { customer: true, vehicle: true, items: true, payments: true },
  });
  if (!order) return { data: null, missing: "order" };

  const docNumber =
    type === "quotation" ? order.quotationNumber : type === "invoice" ? order.invoiceNumber : order.receiptNumber;
  if (!docNumber) return { data: null, missing: "number" };

  const shop = await prisma.shopProfile.findFirst();
  const date =
    type === "quotation"
      ? order.quotedAt || order.createdAt
      : type === "invoice"
      ? order.invoicedAt || order.createdAt
      : order.paidAt || order.createdAt;
  const last = order.payments[order.payments.length - 1];

  return {
    missing: null,
    data: {
      type,
      docNumber,
      orderNumber: order.orderNumber,
      date,
      shop: {
        name: shop?.name || "My Workshop",
        address: shop?.address,
        phone: shop?.phone,
        email: shop?.email,
        tin: shop?.tin,
        brn: shop?.brn,
        bankName: shop?.bankName,
        bankAccount: shop?.bankAccount,
        paymentQrUrl: shop?.paymentQrUrl,
      },
      customer: { name: order.customer.name, phone: order.customer.phone, tin: order.customer.tin },
      vehicle: {
        plateNumber: order.vehicle.plateNumber,
        make: order.vehicle.make,
        model: order.vehicle.model,
        year: order.vehicle.year,
        mileage: order.mileageIn ?? order.vehicle.mileage,
      },
      items: order.items.map((i) => ({
        description: i.description,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        total: i.total,
        type: i.type,
      })),
      partsAmount: order.partsAmount,
      laborAmount: order.laborAmount,
      discount: order.discount,
      totalAmount: order.totalAmount,
      paidAmount: order.paidAmount,
      notes: type === "quotation" ? order.diagnosis : null,
      paymentMethod: last ? last.method : null,
      paymentReference: last ? last.reference : null,
      footer: shop?.receiptFooter,
      eInvoice: order.eInvoiceUuid
        ? { uuid: order.eInvoiceUuid, longId: order.eInvoiceLongId }
        : null,
    },
  };
}
