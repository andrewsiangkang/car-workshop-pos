import Link from "next/link";
import { Plus } from "lucide-react";
import { Header } from "@/components/layout/Header";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const COLOR: Record<string, string> = {
  UNPAID: "bg-red-50 text-red-700",
  PARTIAL: "bg-amber-50 text-amber-700",
  PAID: "bg-emerald-50 text-emerald-700",
};
const LABEL: Record<string, string> = { UNPAID: "Unpaid", PARTIAL: "Partly paid", PAID: "Paid" };

export default async function SupplierInvoicesPage() {
  const list = await prisma.supplierInvoice.findMany({
    orderBy: { invoiceDate: "desc" },
    take: 300,
    include: { supplier: { select: { id: true, name: true } } },
  });
  const owing = list.reduce((s, i) => s + Math.max(0, i.totalAmount - i.paidAmount), 0);

  return (
    <div>
      <Header
        title="Supplier Invoices"
        description="Invoices from suppliers. Saving one adds the items to stock."
        actions={
          <Link href="/supplier-invoices/new" className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-800">
            <Plus className="h-4 w-4" />
            New / Scan Invoice
          </Link>
        }
      />
      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
        Total owed to suppliers: <span className="font-semibold text-red-700">{formatCurrency(owing)}</span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-5 py-3 font-medium">Date</th>
              <th className="px-5 py-3 font-medium">Supplier</th>
              <th className="px-5 py-3 font-medium">Invoice No.</th>
              <th className="px-5 py-3 text-right font-medium">Total</th>
              <th className="px-5 py-3 text-right font-medium">Balance</th>
              <th className="px-5 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-slate-500">
                  No supplier invoices yet
                </td>
              </tr>
            )}
            {list.map((i) => (
              <tr key={i.id} className="hover:bg-slate-50">
                <td className="px-5 py-3">{formatDate(i.invoiceDate)}</td>
                <td className="px-5 py-3">
                  <Link href={`/suppliers/${i.supplier.id}`} className="text-blue-700 hover:underline">
                    {i.supplier.name}
                  </Link>
                </td>
                <td className="px-5 py-3">
                  <Link href={`/supplier-invoices/${i.id}`} className="font-medium text-blue-700 hover:underline">
                    {i.invoiceNo}
                  </Link>
                </td>
                <td className="px-5 py-3 text-right">{formatCurrency(i.totalAmount)}</td>
                <td className="px-5 py-3 text-right">{formatCurrency(Math.max(0, i.totalAmount - i.paidAmount))}</td>
                <td className="px-5 py-3">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${COLOR[i.status] || ""}`}>{LABEL[i.status] || i.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
