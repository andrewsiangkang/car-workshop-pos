import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PrintButton } from "@/components/documents/PrintButton";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatDate } from "@/lib/utils";
import { PAYMENT_LABEL } from "@/lib/status";
import { VoidButton } from "@/components/suppliers/VoidButton";
import { fullAddress } from "@/lib/docdata";

export const dynamic = "force-dynamic";

/** 【中文】可打印的付款凭证：付款给谁、付什么、多少钱、付款方式，底部留签名栏。 */
export default async function VoucherPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = await prisma.paymentVoucher.findUnique({ where: { id }, include: { supplierInvoice: { select: { id: true, invoiceNo: true } } } });
  if (!v) notFound();
  const shop = await prisma.shopProfile.findFirst();

  return (
    <div>
      <div className="no-print mb-6 flex items-center justify-between">
        <Link href="/payment-vouchers" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
          <ArrowLeft className="h-4 w-4" />
          Back to List
        </Link>
        <div className="flex items-center gap-2">
          {!v.voidedAt && (
            <VoidButton
              url={`/api/payment-vouchers/${v.id}/void`}
              label="Void voucher"
              confirmText={v.supplierInvoice
                ? "Void this voucher? The supplier invoice will show this amount as unpaid again. The record is kept."
                : "Void this voucher? The record is kept and marked VOID."}
            />
          )}
          <PrintButton />
        </div>
      </div>
      {v.voidedAt && (
        <div className="mx-auto mb-4 max-w-2xl rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <b>VOID</b> since {formatDate(v.voidedAt)} — {v.voidReason}
        </div>
      )}
      <div className="mx-auto max-w-2xl rounded-xl border border-slate-200 bg-white p-8 shadow-sm print:border-0 print:shadow-none">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <div className="text-lg font-bold">{shop?.name || "Workshop"}</div>
            {fullAddress(shop) && <div className="whitespace-pre-line text-sm text-slate-600">{fullAddress(shop)}</div>}
            {shop?.phone && <div className="text-sm text-slate-600">{shop.phone}</div>}
          </div>
          <div className="text-right">
            <div className="text-xl font-bold tracking-wide">PAYMENT VOUCHER{v.voidedAt ? " (VOID)" : ""}</div>
            <div className="text-sm text-slate-600">{v.number}</div>
            <div className="text-sm text-slate-600">{formatDate(v.paidAt)}</div>
          </div>
        </div>
        <table className="mb-6 w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            <tr>
              <td className="w-40 py-2 text-slate-500">Pay to</td>
              <td className="py-2 font-medium">{v.payee}</td>
            </tr>
            <tr>
              <td className="py-2 text-slate-500">Purpose</td>
              <td className="py-2">{v.purpose}</td>
            </tr>
            {v.supplierInvoice && (
              <tr>
                <td className="py-2 text-slate-500">Supplier Invoice No.</td>
                <td className="py-2">{v.supplierInvoice.invoiceNo}</td>
              </tr>
            )}
            <tr>
              <td className="py-2 text-slate-500">Payment Method</td>
              <td className="py-2">{PAYMENT_LABEL[v.method] || v.method}</td>
            </tr>
            {v.reference && (
              <tr>
                <td className="py-2 text-slate-500">Reference / Transaction ID</td>
                <td className="py-2">{v.reference}</td>
              </tr>
            )}
            <tr>
              <td className="py-3 text-slate-500">Amount</td>
              <td className="py-3 text-xl font-bold">{formatCurrency(v.amount)}</td>
            </tr>
          </tbody>
        </table>
        <div className="mt-16 grid grid-cols-2 gap-10 text-center text-sm text-slate-600">
          <div className="border-t border-slate-400 pt-2">Prepared by</div>
          <div className="border-t border-slate-400 pt-2">Received by (signature &amp; date)</div>
        </div>
      </div>
    </div>
  );
}
