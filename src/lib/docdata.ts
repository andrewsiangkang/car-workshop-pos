import { prisma } from "@/lib/prisma";
import { portalUrl } from "@/lib/myinvois";
import { SANDBOX, recordEnv } from "@/lib/einvoice-state.mjs";
import { MY_STATES } from "@/lib/my-states";
import { ensureEInvoiceToken, customerBaseUrl, buyerRequestLockFor } from "@/lib/einvoice-request";
import { addressText, customerBuyer, invoiceBuyer, parseDocSnapshot, sellerSnapshot, vehicleSnapshot } from "@/lib/doc-snapshot.mjs";
import type { DocData } from "@/components/documents/DocumentLayout";

/** Street, then "postcode city", then state, one per line. */
export function fullAddress(
  shop: { address: string | null; postcode: string | null; city: string | null; stateCode: string | null } | null
) {
  return addressText(shop, (code) => MY_STATES[code]);
}

/**
 * Settings fields copied into a document snapshot (seller particulars) plus the SST settings
 * the invoice needs. Never the MyInvois secret.
 */
export const SELLER_SELECT = {
  name: true, address: true, postcode: true, city: true, stateCode: true, phone: true, email: true,
  tin: true, brn: true, sstNumber: true, sstRate: true, sstScope: true, msicCode: true, msicDesc: true,
  bankName: true, bankAccount: true, paymentQrUrl: true,
} as const;

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

  // Invoices and receipts print the particulars frozen when the invoice was issued (H6);
  // quotations, and invoices issued before v0.3.29, use today's data.
  // 【中文】发票、收据用开票时冻结的卖方 / 买方 / 车辆资料；报价单和旧发票才用现在的资料。
  const snap = type === "quotation" ? null : parseDocSnapshot(order.docSnapshot);
  const seller = snap?.seller ?? sellerSnapshot(shop);
  const vehicle = snap?.vehicle ?? vehicleSnapshot(order.vehicle, order.mileageIn);
  // Same buyer rule as the e-Invoice sent to LHDN (buyerForOrder), so the two always match.
  const buyer = type === "quotation" ? customerBuyer(order.customer) : invoiceBuyer({ order, customer: order.customer });

  // Buyer-request QR: only on invoice / receipt while LHDN has not accepted a live e-Invoice yet.
  let buyerRequestUrl: string | null = null;
  if (type === "invoice" || type === "receipt") {
    // Same full check as the QR page itself: staff already saved the buyer, a real consolidated
    // e-Invoice reported it, or the deadline passed → no QR on the print.
    const { lock } = await buyerRequestLockFor(order);
    const base = customerBaseUrl(hostHeader || null);
    if (lock === "none" && base) {
      const token = await ensureEInvoiceToken(order.id, order.eInvoiceToken);
      if (token) {
        buyerRequestUrl = `${base}/e-invoice/${token}`;
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
        name: seller.name,
        logoUrl: shop?.logoUrl, // appearance, not a particular: always today's logo
        address: fullAddress(seller),
        phone: seller.phone,
        email: seller.email,
        tin: seller.tin,
        brn: seller.brn,
        bankName: seller.bankName,
        bankAccount: seller.bankAccount,
        paymentQrUrl: seller.paymentQrUrl,
        sstNumber: seller.sstNumber,
      },
      customer: {
        name: buyer.name,
        phone: buyer.phone || "",
        tin: buyer.tin,
        address: fullAddress(buyer),
      },
      vehicle,
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
      roundingAdjustment: order.roundingAdjustment,
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
        ? {
            uuid: order.eInvoiceUuid,
            longId: order.eInvoiceLongId,
            // The portal of the LHDN system that issued it (stored), not today's Settings checkbox.
            portal: portalUrl(recordEnv(order) === SANDBOX),
            sandbox: recordEnv(order) === SANDBOX,
          }
        : null,
      buyerRequestUrl,
      submissionUid: order.submissionUid || null,
      eInvoiceStatus: order.eInvoiceStatus || null,
      eInvoiceEnv: order.eInvoiceEnv || null,
    },
  };
}
