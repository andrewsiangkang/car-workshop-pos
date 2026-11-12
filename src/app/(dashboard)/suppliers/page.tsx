import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** 【中文】供应商账户：录入供应商发票时自动建立，记录联系方式、买过什么、欠多少钱。 */
export default async function SuppliersPage() {
  const list = await prisma.supplier.findMany({
    orderBy: { name: "asc" },
    include: { invoices: { where: { voidedAt: null }, select: { totalAmount: true, paidAmount: true, invoiceDate: true } } },
  });
  return (
    <div className="max-w-5xl">
      <Header title="Suppliers" description="Added automatically when you record a supplier invoice." />
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-5 py-3 font-medium">Supplier</th>
              <th className="px-5 py-3 font-medium">Phone</th>
              <th className="px-5 py-3 font-medium">Last order</th>
              <th className="px-5 py-3 text-right font-medium">Total purchases</th>
              <th className="px-5 py-3 text-right font-medium">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-slate-500">
                  No suppliers yet
                </td>
              </tr>
            )}
            {list.map((s) => {
              const total = s.invoices.reduce((a, i) => a + i.totalAmount, 0);
              const owing = s.invoices.reduce((a, i) => a + Math.max(0, i.totalAmount - i.paidAmount), 0);
              const last = s.invoices.reduce<Date | null>((a, i) => (!a || i.invoiceDate > a ? i.invoiceDate : a), null);
              return (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <Link href={`/suppliers/${s.id}`} className="font-medium text-blue-700 hover:underline">
                      {s.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3">{s.phone || "-"}</td>
                  <td className="px-5 py-3">{last ? formatDate(last) : "-"}</td>
                  <td className="px-5 py-3 text-right">{formatCurrency(total)}</td>
                  <td className="px-5 py-3 text-right">{formatCurrency(owing)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
