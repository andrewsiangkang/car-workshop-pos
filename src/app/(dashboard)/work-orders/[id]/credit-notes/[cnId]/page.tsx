import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { PrintButton } from "@/components/documents/PrintButton";
import { CreditNoteLayout } from "@/components/documents/CreditNoteLayout";
import { fullAddress } from "@/lib/docdata";
import { portalUrl } from "@/lib/myinvois";

export const dynamic = "force-dynamic";

export default async function CreditNotePage({ params }: { params: Promise<{ id: string; cnId: string }> }) {
  const { id, cnId } = await params;
  const cn = await prisma.creditNote.findUnique({
    where: { id: cnId },
    include: { workOrder: { include: { customer: true, vehicle: true } } },
  });
  if (!cn || cn.workOrderId !== id) notFound();
  const shop = await prisma.shopProfile.findFirst();
  const o = cn.workOrder;

  return (
    <div>
      <div className="no-print mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href={`/work-orders/${id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
            <ArrowLeft className="h-4 w-4" />
            Back to Work Order
          </Link>
          <h1 className="text-lg font-semibold text-slate-900">Credit Note Preview</h1>
        </div>
        <PrintButton />
      </div>
      <CreditNoteLayout
        data={{
          number: cn.number,
          date: cn.createdAt,
          invoiceNumber: o.invoiceNumber || "",
          invoiceDate: o.invoicedAt,
          orderNumber: o.orderNumber,
          reason: cn.reason,
          amount: cn.amount,
          taxAmount: cn.taxAmount,
          taxRate: o.taxRate,
          refundAmount: cn.refundAmount,
          refundMethod: cn.refundMethod,
          shop: {
            name: shop?.name || "My Workshop",
            address: fullAddress(shop),
            phone: shop?.phone,
            tin: shop?.tin,
            brn: shop?.brn,
            sstNumber: shop?.sstNumber,
          },
          customer: { name: o.customer.name, phone: o.customer.phone, tin: o.customer.tin },
          plateNumber: o.vehicle.plateNumber,
          eInvoice: cn.eInvoiceUuid
            ? { uuid: cn.eInvoiceUuid, longId: cn.eInvoiceLongId, portal: portalUrl(shop?.myInvoisSandbox ?? true) }
            : null,
        }}
      />
    </div>
  );
}
