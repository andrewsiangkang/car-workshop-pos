import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Header } from "@/components/layout/Header";
import { PrintButton } from "@/components/documents/PrintButton";
import { SupplierForm } from "@/components/suppliers/SupplierForm";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Bought = {
  key: string;
  description: string;
  category: string;
  lastCost: number;
  lastQty: number;
  lastDate: Date;
  inventoryItemId: string | null;
};

export default async function SupplierDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await prisma.supplier.findUnique({
    where: { id },
    include: {
      invoices: { orderBy: { invoiceDate: "desc" }, include: { items: true } },
    },
  });
  if (!s) notFound();

  // 【中文】这个供应商买过的东西：同名合并，只保留最近一次的价格、数量和日期
  const map = new Map<string, Bought>();
  for (const inv of s.invoices) {
    for (const it of inv.items) {
      const key = it.description.toLowerCase();
      if (!map.has(key)) {
        map.set(key, {
          key,
          description: it.description,
          category: it.category || "",
          lastCost: it.unitCost,
          lastQty: it.quantity,
          lastDate: inv.invoiceDate,
          inventoryItemId: it.inventoryItemId,
        });
      }
    }
  }
  const bought = [...map.values()];
  const ids = bought.map((b) => b.inventoryItemId).filter((x): x is string => !!x);
  const stock = ids.length
    ? await prisma.inventoryItem.findMany({ where: { id: { in: ids } }, select: { id: true, quantityOnHand: true, minStockLevel: true } })
    : [];
  const stockById = new Map(stock.map((x) => [x.id, x]));
  const reorder = bought.filter((b) => {
    const st = b.inventoryItemId ? stockById.get(b.inventoryItemId) : undefined;
    return !!st && st.minStockLevel > 0 && st.quantityOnHand <= st.minStockLevel;
  });
  const owing = s.invoices.reduce((a, i) => a + Math.max(0, i.totalAmount - i.paidAmount), 0);

  return (
    <div className="max-w-5xl">
      <Link href="/suppliers" className="no-print mb-4 inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900">
        <ArrowLeft className="h-4 w-4" />
        Back to List
      </Link>
      <Header title={s.name} description={`Balance owed: ${formatCurrency(owing)}`} />

      <div className="no-print mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 font-semibold text-slate-900">Contact</h2>
        <SupplierForm id={s.id} phone={s.phone || ""} address={s.address || ""} notes={s.notes || ""} />
      </div>

      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Reorder List (low stock)</h2>
          <div className="no-print">
            <PrintButton />
          </div>
        </div>
        {reorder.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing to reorder from this supplier right now.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 font-medium">Item</th>
                <th className="py-2 text-right font-medium">In stock</th>
                <th className="py-2 text-right font-medium">Last qty</th>
                <th className="py-2 text-right font-medium">Last cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {reorder.map((b) => (
                <tr key={b.key}>
                  <td className="py-2">{b.description}</td>
                  <td className="py-2 text-right">{b.inventoryItemId ? stockById.get(b.inventoryItemId)?.quantityOnHand : ""}</td>
                  <td className="py-2 text-right">{b.lastQty}</td>
                  <td className="py-2 text-right">{formatCurrency(b.lastCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="mb-6 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-3 font-semibold text-slate-900">Items bought before</div>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-5 py-3 font-medium">Item</th>
              <th className="px-5 py-3 font-medium">Category</th>
              <th className="px-5 py-3 text-right font-medium">Last cost</th>
              <th className="px-5 py-3 text-right font-medium">Last qty</th>
              <th className="px-5 py-3 font-medium">Last order</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {bought.map((b) => (
              <tr key={b.key}>
                <td className="px-5 py-3">{b.description}</td>
                <td className="px-5 py-3 text-slate-500">{b.category}</td>
                <td className="px-5 py-3 text-right">{formatCurrency(b.lastCost)}</td>
                <td className="px-5 py-3 text-right">{b.lastQty}</td>
                <td className="px-5 py-3">{formatDate(b.lastDate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="no-print overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-3 font-semibold text-slate-900">Supplier Invoices</div>
        <table className="w-full text-left text-sm">
          <tbody className="divide-y divide-slate-100">
            {s.invoices.map((i) => (
              <tr key={i.id}>
                <td className="px-5 py-3">{formatDate(i.invoiceDate)}</td>
                <td className="px-5 py-3">
                  <Link href={`/supplier-invoices/${i.id}`} className="text-blue-700 hover:underline">
                    {i.invoiceNo}
                  </Link>
                </td>
                <td className="px-5 py-3 text-right">{formatCurrency(i.totalAmount)}</td>
                <td className="px-5 py-3 text-right">{formatCurrency(Math.max(0, i.totalAmount - i.paidAmount))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
