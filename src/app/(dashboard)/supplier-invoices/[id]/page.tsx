import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Header } from "@/components/layout/Header";
import { PayForm } from "@/components/suppliers/PayForm";
import { VoidButton } from "@/components/suppliers/VoidButton";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function SupplierInvoiceDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const inv = await prisma.supplierInvoice.findUnique({
    where: { id },
    include: { supplier: true, items: true, vouchers: { orderBy: { paidAt: "asc" } } },
  });
  if (!inv) notFound();
  const balance = inv.voidedAt ? 0 : Math.max(0, inv.totalAmount - inv.paidAmount);
  const liveVouchers = inv.vouchers.filter((v) => !v.voidedAt);

  return (
    <div className="max-w-4xl">
      <Link href="/supplier-invoices" className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900">
        <ArrowLeft className="h-4 w-4" />
        Back to List
      </Link>
      <Header title={`Invoice ${inv.invoiceNo}`} description={`${inv.supplier.name} · ${formatDate(inv.invoiceDate)} · ${inv.internalNo}`} />

      {inv.voidedAt ? (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <b>VOID</b> since {formatDate(inv.voidedAt)} — {inv.voidReason}. The stock it added was taken back out.
        </div>
      ) : (
        <div className="mb-4 flex justify-end">
          <VoidButton
            url={`/api/supplier-invoices/${inv.id}/void`}
            label="Void this invoice"
            confirmText={liveVouchers.length
              ? "Void its payment vouchers first (open each voucher below)."
              : "Void this supplier invoice? Its items will be taken back out of stock. The record is kept."}
          />
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">Total Amount</div>
          <div className="text-xl font-semibold">{formatCurrency(inv.totalAmount)}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">Paid</div>
          <div className="text-xl font-semibold text-emerald-700">{formatCurrency(inv.paidAmount)}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">Balance</div>
          <div className="text-xl font-semibold text-red-700">{formatCurrency(balance)}</div>
        </div>
      </div>

      <div className="mb-6 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-5 py-3 font-medium">Description</th>
              <th className="px-5 py-3 font-medium">Category</th>
              <th className="px-5 py-3 text-right font-medium">Qty</th>
              <th className="px-5 py-3 text-right font-medium">Unit Cost</th>
              <th className="px-5 py-3 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {inv.items.map((it) => (
              <tr key={it.id}>
                <td className="px-5 py-3">{it.description}</td>
                <td className="px-5 py-3 text-slate-500">
                  {it.category}
                  {!it.inventoryItemId && <span className="ml-1 text-xs text-slate-400">(not stocked)</span>}
                </td>
                <td className="px-5 py-3 text-right">{it.quantity}</td>
                <td className="px-5 py-3 text-right">{formatCurrency(it.unitCost)}</td>
                <td className="px-5 py-3 text-right">{formatCurrency(it.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-t border-slate-100 px-5 py-3 text-right text-sm text-slate-600">
          Subtotal {formatCurrency(inv.subtotal)} · SST {formatCurrency(inv.taxAmount)}
        </div>
      </div>

      {inv.imageUrl && (
        <div className="mb-6">
          <a href={inv.imageUrl} target="_blank" rel="noreferrer" className="text-sm text-blue-700 hover:underline">
            View scanned copy
          </a>
        </div>
      )}

      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 font-semibold text-slate-900">Payment Vouchers</h2>
        {inv.vouchers.length === 0 ? (
          <p className="text-sm text-slate-500">No payments yet</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {inv.vouchers.map((v) => (
              <li key={v.id} className="flex items-center justify-between">
                <Link href={`/payment-vouchers/${v.id}`} className="text-blue-700 hover:underline">
                  {v.number}
                </Link>
                <span className="text-slate-500">{formatDate(v.paidAt)}</span>
                <span className={`font-medium ${v.voidedAt ? "text-slate-400 line-through" : ""}`}>
                  {formatCurrency(v.amount)}
                  {v.voidedAt && <span className="ml-2 text-xs no-underline">VOID</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {inv.voidedAt ? null : balance > 0.005 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-semibold text-slate-900">Pay Supplier</h2>
          <PayForm invoiceId={inv.id} balance={balance} />
        </div>
      ) : (
        <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">✓ Fully Paid</div>
      )}
    </div>
  );
}
