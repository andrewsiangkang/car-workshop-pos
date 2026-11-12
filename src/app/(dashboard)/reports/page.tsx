import { Header } from "@/components/layout/Header";
import { DollarSign, TrendingUp, TrendingDown, Calendar, Receipt, Users, Wrench, Package } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";
import { redirect } from "next/navigation";
import { getCurrentUser, isOwner } from "@/lib/auth";

export const dynamic = "force-dynamic";

const RANGES: Record<string, string> = { month: "This Month", quarter: "This Quarter", year: "This Year" };
const money = (n: number) => formatCurrency(Number.isFinite(n) ? n : 0);

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  if (!isOwner(await getCurrentUser())) redirect("/dashboard");
  const { range: r } = await searchParams;
  const range = r && RANGES[r] ? r : "month";
  const now = new Date();
  const start = range === "year"
    ? new Date(now.getFullYear(), 0, 1)
    : range === "quarter"
      ? new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)
      : new Date(now.getFullYear(), now.getMonth(), 1);

  const [orders, trendOrders, expenses] = await Promise.all([
    prisma.workOrder.findMany({ where: { paidAt: { gte: start }, paidAmount: { gt: 0 } }, include: { items: true, assignedTo: true } }),
    prisma.workOrder.findMany({ where: { paidAt: { gte: new Date(now.getFullYear(), now.getMonth() - 11, 1) }, paidAmount: { gt: 0 } }, include: { items: true, assignedTo: true } }),
    prisma.expense.findMany({ where: { expenseDate: { gte: start } } }),
  ]);

  const revenue = orders.reduce((s, o) => s + o.paidAmount, 0);
  const partsCost = orders.reduce((s, o) => s + o.items.reduce((c, i) => c + i.costPrice * i.quantity, 0), 0);
  const operatingExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  let partsSales = 0, laborSales = 0, sstCollected = 0;
  for (const o of orders) {
    const ratio = o.totalAmount > 0 ? Math.min(1, Math.max(0, o.paidAmount / o.totalAmount)) : 0;
    partsSales += o.partsAmount * ratio;
    laborSales += o.laborAmount * ratio;
    sstCollected += o.taxAmount * ratio;
  }
  const grossProfit = revenue - sstCollected - partsCost;
  const estimatedNet = grossProfit - operatingExpenses;
  const mixTotal = partsSales + laborSales;
  const partsPct = mixTotal > 0 ? Math.round(partsSales / mixTotal * 100) : 0;
  const laborPct = mixTotal > 0 ? 100 - partsPct : 0;

  const monthly = Array.from({ length: 12 }, (_, idx) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 11 + idx, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const monthOrders = trendOrders.filter(o => o.paidAt && `${o.paidAt.getFullYear()}-${String(o.paidAt.getMonth() + 1).padStart(2, "0")}` === key);
    const sales = monthOrders.reduce((sum, o) => sum + o.paidAmount, 0);
    const cost = monthOrders.reduce((sum, o) => sum + o.items.reduce((c, i) => c + i.costPrice * i.quantity, 0), 0);
    return { label: d.toLocaleDateString("en", { month: "short" }), sales, profit: sales - cost - monthOrders.reduce((sum, o) => sum + o.taxAmount * (o.totalAmount > 0 ? Math.min(1, o.paidAmount / o.totalAmount) : 0), 0) };
  });
  const maxSales = Math.max(1, ...monthly.map(m => m.sales));
  const itemTotals = new Map<string, { quantity: number; sales: number }>();
  for (const o of orders) for (const item of o.items) {
    const old = itemTotals.get(item.description) || { quantity: 0, sales: 0 };
    itemTotals.set(item.description, { quantity: old.quantity + item.quantity, sales: old.sales + item.total });
  }
  const topItems = [...itemTotals.entries()].sort((a,b) => b[1].sales - a[1].sales).slice(0, 5);
  const staffTotals = new Map<string, { jobs: number; revenue: number }>();
  for (const o of orders) {
    const name = o.assignedTo?.name || "Unassigned";
    const old = staffTotals.get(name) || { jobs: 0, revenue: 0 };
    staffTotals.set(name, { jobs: old.jobs + 1, revenue: old.revenue + o.paidAmount });
  }
  const staff = [...staffTotals.entries()].sort((a,b) => b[1].revenue - a[1].revenue).slice(0, 8);
  const cards = [
    { label: `${RANGES[range]} Collections`, value: money(revenue), icon: DollarSign, cls: "bg-emerald-50 text-emerald-600" },
    { label: `${RANGES[range]} Parts Cost`, value: money(partsCost), icon: TrendingDown, cls: "bg-red-50 text-red-600" },
    { label: "Gross Profit (estimated)", value: money(grossProfit), icon: TrendingUp, cls: "bg-blue-50 text-blue-600" },
    { label: "Operating Expenses", value: money(operatingExpenses), icon: Receipt, cls: "bg-amber-50 text-amber-600" },
    { label: "Estimated Net Profit", value: money(estimatedNet), icon: TrendingUp, cls: "bg-violet-50 text-violet-600" },
    { label: "Paid Orders", value: String(orders.length), icon: Calendar, cls: "bg-slate-100 text-slate-600" },
  ];

  return <div>
    <Header title="Business Intelligence" description="Collections, profitability, operating costs and workshop performance" actions={<form method="get"><select name="range" defaultValue={range} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">{Object.entries(RANGES).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select><button className="ml-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">View</button></form>} />
    <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">{cards.map(c => { const Icon=c.icon; return <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-3"><div className={`flex h-10 w-10 items-center justify-center rounded-lg ${c.cls}`}><Icon className="h-5 w-5"/></div><div><p className="text-sm text-slate-500">{c.label}</p><p className="text-xl font-bold text-slate-900">{c.value}</p></div></div></div>; })}</div>

    <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm xl:col-span-2">
        <div className="mb-4 flex items-center gap-2"><TrendingUp className="h-5 w-5 text-blue-600"/><h2 className="font-semibold text-slate-900">12-Month Collections & Gross Profit Trend</h2></div>
        <div className="grid h-52 grid-cols-12 items-end gap-2">{monthly.map((m,i) => <div key={`${m.label}-${i}`} className="flex h-full flex-col items-center justify-end gap-1"><div title={`Collections ${money(m.sales)} · Gross profit ${money(m.profit)}`} className="w-full rounded-t bg-blue-500" style={{height:`${Math.max(2,m.sales/maxSales*100)}%`}}/><span className="text-[10px] text-slate-500">{m.label}</span></div>)}</div>
        <div className="mt-3 text-xs text-slate-500">Blue bars represent monthly collections. Hover a bar for its collection and estimated gross profit figures.</div>
      </section>
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 font-semibold text-slate-900">Revenue Mix</h2>
        <div className="mb-2 flex justify-between text-sm"><span className="text-slate-600">Parts Sales</span><b>{money(partsSales)} ({partsPct}%)</b></div><div className="mb-5 h-2 overflow-hidden rounded bg-slate-100"><div className="h-full bg-blue-600" style={{width:`${partsPct}%`}}/></div>
        <div className="mb-2 flex justify-between text-sm"><span className="text-slate-600">Labor Sales</span><b>{money(laborSales)} ({laborPct}%)</b></div><div className="h-2 overflow-hidden rounded bg-slate-100"><div className="h-full bg-emerald-500" style={{width:`${laborPct}%`}}/></div>
        <div className="mt-5 border-t pt-4 text-sm"><div className="flex justify-between"><span>SST / Tax collected</span><b>{money(sstCollected)}</b></div><div className="mt-2 flex justify-between"><span>Parts cost</span><b>{money(partsCost)}</b></div></div>
      </section>
    </div>

    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"><div className="mb-4 flex items-center gap-2"><Package className="h-5 w-5 text-blue-600"/><h2 className="font-semibold">Top Selling Work Items</h2></div>{topItems.length ? <div className="space-y-3">{topItems.map(([name,v])=><div key={name} className="flex items-center justify-between gap-4 border-b border-slate-100 pb-2 text-sm"><span className="truncate">{name}<span className="ml-2 text-xs text-slate-400">× {v.quantity}</span></span><b>{money(v.sales)}</b></div>)}</div> : <p className="text-sm text-slate-400">No item sales in this period.</p>}</section>
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"><div className="mb-4 flex items-center gap-2"><Users className="h-5 w-5 text-blue-600"/><h2 className="font-semibold">Technician Performance (by assigned paid jobs)</h2></div>{staff.length ? <div className="space-y-3">{staff.map(([name,v])=><div key={name} className="flex items-center justify-between gap-4 border-b border-slate-100 pb-2 text-sm"><span>{name}<span className="ml-2 text-xs text-slate-400">{v.jobs} jobs</span></span><b>{money(v.revenue)}</b></div>)}</div> : <p className="text-sm text-slate-400">No assigned paid jobs in this period.</p>}</section>
    </div>
    <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"><strong>Important:</strong> Estimated Net Profit = Collections − tax collected − recorded parts cost − recorded operating expenses. It excludes unrecorded wages, rent, utilities, depreciation and other costs. Technician figures use assigned paid work orders, not time-clock productivity.</div>
  </div>;
}
