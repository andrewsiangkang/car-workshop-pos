import { Header } from "@/components/layout/Header";
import { DollarSign, TrendingUp, TrendingDown, Calendar, Receipt } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";
import { redirect } from "next/navigation";
import { getCurrentUser, isOwner } from "@/lib/auth";

export const dynamic = "force-dynamic";

const RANGES: Record<string, string> = { month: "This Month", quarter: "This Quarter", year: "This Year" };

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  // Reports show turnover, cost and profit: boss only.
  if (!isOwner(await getCurrentUser())) redirect("/dashboard");

  const { range: r } = await searchParams;
  const range = r && RANGES[r] ? r : "month";
  const now = new Date();
  const start =
    range === "year"
      ? new Date(now.getFullYear(), 0, 1)
      : range === "quarter"
      ? new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)
      : new Date(now.getFullYear(), now.getMonth(), 1);

  const orders = await prisma.workOrder.findMany({
    where: { paidAt: { gte: start } },
    include: { items: true },
  });

  const revenue = orders.reduce((s, o) => s + o.paidAmount, 0);
  const partsCost = orders.reduce(
    (s, o) => s + o.items.reduce((c, i) => c + i.costPrice * i.quantity, 0),
    0
  );
  // Revenue mix by item type (only fully-recorded paid orders; pro-rated by paid ratio)
  let partsSales = 0;
  let laborSales = 0;
  let sstCollected = 0;
  for (const o of orders) {
    const ratio = o.totalAmount > 0 ? o.paidAmount / o.totalAmount : 0;
    partsSales += o.partsAmount * ratio;
    laborSales += o.laborAmount * ratio;
    sstCollected += o.taxAmount * ratio;
  }
  // SST collected is owed to Customs (JKDM) — it is not the shop's money.
  const profit = revenue - sstCollected - partsCost;
  const mixTotal = partsSales + laborSales;
  const partsPct = mixTotal > 0 ? Math.round((partsSales / mixTotal) * 100) : 0;
  const laborPct = mixTotal > 0 ? 100 - partsPct : 0;

  const cards = [
    { label: `${RANGES[range]}Collections`, value: formatCurrency(revenue), icon: DollarSign, cls: "bg-emerald-50 text-emerald-600" },
    { label: `${RANGES[range]}Parts Cost`, value: formatCurrency(partsCost), icon: TrendingDown, cls: "bg-red-50 text-red-600" },
    { label: `${RANGES[range]}Profit`, value: formatCurrency(profit), icon: TrendingUp, cls: "bg-blue-50 text-blue-600" },
    { label: "Paid Orders", value: String(orders.length), icon: Calendar, cls: "bg-violet-50 text-violet-600" },
    ...(sstCollected > 0
      ? [{ label: `${RANGES[range]}SST Collected (owed to JKDM)`, value: formatCurrency(sstCollected), icon: Receipt, cls: "bg-amber-50 text-amber-600" }]
      : []),
  ];

  return (
    <div>
      <Header
        title="Reports"
        description="View collections, parts cost and profit"
        actions={
          <form method="get">
            <select name="range" defaultValue={range} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none">
              {Object.entries(RANGES).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <button className="ml-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">View</button>
          </form>
        }
      />

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${c.cls}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm text-slate-500">{c.label}</p>
                  <p className="text-xl font-bold text-slate-900">{c.value}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-slate-900">Revenue Mix</h2>
        {mixTotal === 0 ? (
          <p className="text-sm text-slate-400">No collections in this period</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-600">Parts Sales</span>
              <span className="font-medium">{formatCurrency(partsSales)} ({partsPct}%)</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-blue-600" style={{ width: `${partsPct}%` }} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-600">Labor Sales</span>
              <span className="font-medium">{formatCurrency(laborSales)} ({laborPct}%)</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${laborPct}%` }} />
            </div>
          </div>
        )}
      </div>

      <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <strong>Note: </strong> Profit = Collections − SST collected − Parts Cost. Rent, wages, utilities etc. are not included.
      </div>
    </div>
  );
}
