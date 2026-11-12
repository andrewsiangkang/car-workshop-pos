import { prisma } from "@/lib/prisma";
import { portalUrl } from "@/lib/myinvois";
import { MY_STATES } from "@/lib/my-states";
import { ensureEInvoiceToken, customerBaseUrl, requestLockReason } from "@/lib/einvoice-request";
import type { DocData } from "@/components/documents/DocumentLayout";

/** Street, then "postcode city", then state, one per line. */
export function fullAddress(
  shop: { address: string | null; postcode: string | null; city: string | null; stateCode: string | null } | null
) {
  if (!shop) return null;
  const state = shop.stateCode && shop.stateCode !== "17" ? MY_STATES[shop.stateCode] : null;
  return [shop.address, [shop.postcode, shop.city].filter(Boolean).join(" "), state].filter(Boolean).join("\n") || null;
}

export async function loadDocData(
  id: string,
  type: "quotation" | "invoice" | "receipt",
  hostHeader?: string | null
): Promise<{ data: DocData | null; missing: "order" | "number" | null }> {
  const order = await prisma.workOrder.findUnique({
    where: { id },
    include: { customer: true, vehicle: true, items: true, payments: { orderBy: { paidAt: "asc" } } },
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

  // Buyer-request QR: only on invoice / receipt while LHDN has not accepted a live e-Invoice yet.
  let buyerRequestUrl: string | null = null;
  if (type === "invoice" || type === "receipt") {
    const lock = requestLockReason(order);
    if (lock === "none") {
      const token = await ensureEInvoiceToken(order.id, order.eInvoiceToken);
      if (token) {
        buyerRequestUrl = `${customerBaseUrl(hostHeader || null)}/e-invoice/${token}`;
      }
    }
  }

  return {
    missing: null,
    data: {
      type,
      docNumber,
      orderNumber: order.orderNumber,
      date,
      shop: {
        name: shop?.name || "My Workshop",
        logoUrl: shop?.logoUrl,
        address: fullAddress(shop),
        phone: shop?.phone,
        email: shop?.email,
        tin: shop?.tin,
        brn: shop?.brn,
        bankName: shop?.bankName,
        bankAccount: shop?.bankAccount,
        paymentQrUrl: shop?.paymentQrUrl,
        sstNumber: shop?.sstNumber,
      },
      customer:
        order.buyerRequestedAt && order.buyerName
          ? { name: order.buyerName, phone: order.buyerPhone || order.customer.phone, tin: order.buyerTin }
          : { name: order.customer.name, phone: order.customer.phone, tin: order.customer.tin },
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
      taxRate: order.taxRate,
      taxScope: order.taxScope,
      taxAmount: order.taxAmount,
      totalAmount: order.totalAmount,
      paidAmount: order.paidAmount,
      notes: type === "quotation" ? order.diagnosis : null,
      paymentMethod: last ? last.method : null,
      paymentReference: last ? last.reference : null,
      payments: order.payments.map((p) => ({
        method: p.method,
        amount: p.amount,
        tendered: p.tendered,
        changeGiven: p.changeGiven,
        reference: p.reference,
        paidAt: p.paidAt,
      })),
      footer: shop?.receiptFooter,
      documentSettings: (() => { try { return shop?.documentSettings ? JSON.parse(shop.documentSettings) : undefined; } catch { return undefined; } })(),
      eInvoice: order.eInvoiceUuid
        ? { uuid: order.eInvoiceUuid, longId: order.eInvoiceLongId, portal: portalUrl(shop?.myInvoisSandbox ?? true) }
        : null,
      buyerRequestUrl,
      submissionUid: order.submissionUid || null,
      eInvoiceStatus: order.eInvoiceStatus || null,
    },
  };
}
