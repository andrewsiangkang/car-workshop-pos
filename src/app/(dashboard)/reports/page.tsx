import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { DollarSign, TrendingUp, TrendingDown, Calendar, Receipt, Users, Package } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { SERVICE_CATEGORY } from "@/lib/supplier-parse";
import { formatCurrency } from "@/lib/utils";
import { requirePageOwner } from "@/lib/auth";
import { itemSales, operatingExpenses, periodTotals, type ReportJob } from "@/lib/money-reports.mjs";
import { monthLabel, myMonthKey, myMonthStart, myRangeEnd, myRangeStart, shiftMonthKey } from "@/lib/money-time.mjs";

export const dynamic = "force-dynamic";

const RANGES: Record<string, string> = { month: "This Month", quarter: "This Quarter", year: "This Year" };
const money = (n: number) => formatCurrency(Number.isFinite(n) ? n : 0);

// Every payment and credit note of a job is loaded (not only the period's), so the share of the job
// already paid before the period is known. 【中文】工单的全部收款和退款单都要读，才能知道期间开始前已付多少。
const jobInclude = {
  items: true,
  assignedTo: true,
  payments: { select: { amount: true, paidAt: true } },
  // Credited lines: which invoice line, how many units and how much (Top Selling and the revenue mix
  // leave out what a credit note took back). 【中文】退款单明细：哪一行、几件、多少钱（热销项目和营收结构扣掉退回的部分）。
  // Oldest first: Top Selling reads each split note's SST against the SST left before it.
  // 【中文】按时间先后：热销项目要用每张拆分退款单之前剩下的 SST 来判断。
  creditNotes: {
    orderBy: { createdAt: "asc" },
    select: {
      amount: true, taxAmount: true, createdAt: true,
      lines: { select: { workOrderItemId: true, returnedToStock: true, type: true, quantity: true, total: true } },
    },
  },
} as const;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  await requirePageOwner();
  const { range: r } = await searchParams;
  const range = r && RANGES[r] ? r : "month";
  // Periods follow the Malaysian calendar whatever time zone the PC is set to.
  // 【中文】期间按马来西亚日历计算，不受电脑时区影响。
  const now = new Date();
  const start = myRangeStart(range, now) as Date;
  // Costs dated after the period (a forward-dated supplier invoice) belong to their own period,
  // the same [start, end) the Expenses page uses. 【中文】日期在本期间之后的费用算到它自己的期间，不提前计入。
  const end = myRangeEnd(range, now) as Date;
  const trendStart = myMonthStart(now, -11);
  const since = start < trendStart ? start : trendStart;

  // Collections come from the Payment ledger (refunds are negative rows), dated when the money was
  // received — not from the job's last payment date. Jobs with a credit note in the range are read
  // too: a credit against an unpaid balance changes the parts cost earned in that month.
  // 【中文】收款按实际收款记录（Payment）计算，退款为负数；期间内开过退款单的工单也要读。
  const [ledgerRows, creditRows] = await Promise.all([
    prisma.payment.findMany({ where: { paidAt: { gte: since } }, select: { workOrderId: true }, distinct: ["workOrderId"] }),
    prisma.creditNote.findMany({ where: { createdAt: { gte: since } }, select: { workOrderId: true }, distinct: ["workOrderId"] }),
  ]);
  const jobIds = [...new Set([...ledgerRows, ...creditRows].map((p) => p.workOrderId))];
  const [ledgerJobs, legacyJobs, expenses, vouchers, supplierCharges, supplierTax] = await Promise.all([
    jobIds.length ? prisma.workOrder.findMany({ where: { id: { in: jobIds } }, include: jobInclude }) : Promise.resolve([]),
    // Very old jobs paid before payments were recorded one by one: their paid amount counts on the paid date.
    prisma.workOrder.findMany({ where: { paidAt: { gte: since }, paidAmount: { gt: 0 }, payments: { none: {} } }, include: jobInclude }),
    prisma.expense.findMany({ where: { voidedAt: null, expenseDate: { gte: start, lt: end } }, select: { amount: true, voidedAt: true } }),
    prisma.paymentVoucher.findMany({
      where: { voidedAt: null, supplierInvoiceId: null, paidAt: { gte: start, lt: end } },
      select: { amount: true, voidedAt: true, supplierInvoiceId: true },
    }),
    // Delivery / service lines of supplier invoices (never stock, so never parts cost), by invoice date.
    prisma.supplierInvoiceItem.findMany({
      where: { inventoryItemId: null, category: SERVICE_CATEGORY, invoice: { voidedAt: null, invoiceDate: { gte: start, lt: end } } },
      select: { total: true },
    }),
    // Tax paid on supplier invoices: parts cost is before tax, so the tax is counted here, by invoice date.
    prisma.supplierInvoice.findMany({
      where: { voidedAt: null, taxAmount: { gt: 0 }, invoiceDate: { gte: start, lt: end } },
      select: { taxAmount: true },
    }),
  ]);
  // A job paid before payments were recorded one by one has no Payment row: its paid amount counts on its paid date.
  const seen = new Set(jobIds);
  type Job = (typeof ledgerJobs)[number] & ReportJob;
  const jobs: Job[] = [...ledgerJobs, ...legacyJobs.filter((o) => !seen.has(o.id))].map((o) => ({
    ...o,
    payments: o.payments.length ? o.payments : o.paidAt && o.paidAmount > 0 ? [{ amount: o.paidAmount, paidAt: o.paidAt }] : [],
  }));

  const period = periodTotals(jobs, (at) => at >= start);
  const revenue = period.collections;
  const partsCost = period.partsCost;
  const sstCollected = period.sst;
  const partsSales = period.partsSales;
  const laborSales = period.laborSales;
  const opex = operatingExpenses({ expenses, vouchers, supplierCharges, supplierTax });
  const operatingExpensesTotal = opex.total;
  const grossProfit = period.grossProfit;
  const estimatedNet = grossProfit - operatingExpensesTotal;
  const mixTotal = partsSales + laborSales;
  const partsPct = mixTotal > 0 ? Math.round(partsSales / mixTotal * 100) : 0;
  const laborPct = mixTotal > 0 ? 100 - partsPct : 0;

  const thisMonth = myMonthKey(now);
  const monthly = Array.from({ length: 12 }, (_, idx) => {
    const key = shiftMonthKey(thisMonth, idx - 11);
    const t = periodTotals(jobs, (at) => myMonthKey(at) === key);
    return { key, label: monthLabel(key), sales: t.collections, profit: t.grossProfit };
  });
  const maxSales = Math.max(1, ...monthly.map(m => m.sales));

  // Top items and technicians follow the money received in the period: a job counts by the share of
  // it collected in the period (a job paid over two months is split between them), and a month with
  // only a refund adds no item sales and no job, but the refund still lowers the technician's revenue.
  // Units and value a credit note took back by line are left out (a part returned and credited is not
  // "sold"). With SST on labour only, a credit note with no lines (split into labour and parts, or the
  // whole remainder) takes its labour off the labour items and its parts off the part items, told
  // apart by its SST; any other note with no lines (amount only) lowers the share instead, the same
  // share off every item. Both as in the Revenue Mix (money-reports.mjs itemSales / splitMixSen).
  // 【中文】热销项目和技师业绩按本期间实收计算：工单按本期间收到的比例计入（跨月付清的分摊到各月）；只有退款的月份不算销售和工单数，但退款照样扣技师的收入。
  // 按明细行退回的数量和金额不算卖出；只对工钱收 SST 的发票，没有明细的退款单（拆分或退掉全部余额）按 SST 分出工钱和零件，分别从工钱项目和零件项目扣；
  // 其他只有金额的退款单改为降低比例，每个项目扣同样的比例。两者都和营收结构一致。
  const jobById = new Map(jobs.map((o) => [o.id, o]));
  const itemTotals = itemSales(jobs, period.perJob);
  const topItems = [...itemTotals.entries()].filter(([, v]) => v.sales > 0).sort((a,b) => b[1].sales - a[1].sales).slice(0, 5);
  const staffTotals = new Map<string, { jobs: number; revenue: number }>();
  for (const j of period.perJob) {
    const name = jobById.get(j.id)?.assignedTo?.name || "Unassigned";
    const old = staffTotals.get(name) || { jobs: 0, revenue: 0 };
    staffTotals.set(name, { jobs: old.jobs + (j.collected > 0 ? 1 : 0), revenue: old.revenue + j.collected });
  }
  const staff = [...staffTotals.entries()].sort((a,b) => b[1].revenue - a[1].revenue).slice(0, 8);
  const cards = [
    { label: `${RANGES[range]} Collections`, value: money(revenue), icon: DollarSign, cls: "bg-emerald-50 text-emerald-600" },
    { label: `${RANGES[range]} Parts Cost`, value: money(partsCost), icon: TrendingDown, cls: "bg-red-50 text-red-600" },
    { label: "Gross Profit (estimated)", value: money(grossProfit), icon: TrendingUp, cls: "bg-blue-50 text-blue-600" },
    { label: "Operating Expenses", value: money(operatingExpensesTotal), icon: Receipt, cls: "bg-amber-50 text-amber-600" },
    { label: "Estimated Net Profit", value: money(estimatedNet), icon: TrendingUp, cls: "bg-violet-50 text-violet-600" },
    { label: "Paid Orders", value: String(period.paidJobs), icon: Calendar, cls: "bg-slate-100 text-slate-600" },
  ];

  return <div>
    <Header title="Business Intelligence" description="Collections, profitability, operating costs and workshop performance" actions={<form method="get"><select name="range" defaultValue={range} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">{Object.entries(RANGES).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select><button className="ml-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">View</button></form>} />
    <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">{cards.map(c => { const Icon=c.icon; return <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-3"><div className={`flex h-10 w-10 items-center justify-center rounded-lg ${c.cls}`}><Icon className="h-5 w-5"/></div><div><p className="text-sm text-slate-500">{c.label}</p><p className="text-xl font-bold text-slate-900">{c.value}</p></div></div></div>; })}</div>

    <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm xl:col-span-2">
        <div className="mb-4 flex items-center gap-2"><TrendingUp className="h-5 w-5 text-blue-600"/><h2 className="font-semibold text-slate-900">12-Month Collections & Gross Profit Trend</h2></div>
        <div className="grid h-52 grid-cols-12 items-end gap-2">{monthly.map((m) => <div key={m.key} className="flex h-full flex-col items-center justify-end gap-1"><div title={`Collections ${money(m.sales)} · Gross profit ${money(m.profit)}`} className="w-full rounded-t bg-blue-500" style={{height:`${Math.max(2,m.sales/maxSales*100)}%`}}/><span className="text-[10px] text-slate-500">{m.label}</span></div>)}</div>
        <div className="mt-3 text-xs text-slate-500">Blue bars represent monthly collections. Hover a bar for its collection and estimated gross profit figures.</div>
      </section>
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 font-semibold text-slate-900">Revenue Mix</h2>
        <div className="mb-2 flex justify-between text-sm"><span className="text-slate-600">Parts Sales</span><b>{money(partsSales)} ({partsPct}%)</b></div><div className="mb-5 h-2 overflow-hidden rounded bg-slate-100"><div className="h-full bg-blue-600" style={{width:`${partsPct}%`}}/></div>
        <div className="mb-2 flex justify-between text-sm"><span className="text-slate-600">Labor Sales</span><b>{money(laborSales)} ({laborPct}%)</b></div><div className="h-2 overflow-hidden rounded bg-slate-100"><div className="h-full bg-emerald-500" style={{width:`${laborPct}%`}}/></div>
        <div className="mt-5 border-t pt-4 text-sm">
          <div className="flex justify-between"><span>SST / Tax collected</span><b>{money(sstCollected)}</b></div>
          <div className="mt-2 flex justify-between"><span>Parts cost</span><b>{money(partsCost)}</b></div>
          {period.refunds > 0 && <div className="mt-2 flex justify-between"><span>Refunds paid back (already taken off collections)</span><b>{money(period.refunds)}</b></div>}
        </div>
      </section>
    </div>

    <section className="mb-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2"><Receipt className="h-5 w-5 text-amber-600"/><h2 className="font-semibold text-slate-900">Operating Expenses</h2></div>
        <Link href="/expenses" className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-blue-700 hover:bg-slate-50">Record expenses</Link>
      </div>
      <div className="space-y-1.5 text-sm">
        <div className="flex justify-between"><span className="text-slate-600">Expenses recorded on the Expenses page</span><b>{money(opex.expenses)}</b></div>
        <div className="flex justify-between"><span className="text-slate-600">Payment vouchers not for a supplier invoice (rent, utilities, wages…)</span><b>{money(opex.vouchers)}</b></div>
        <div className="flex justify-between"><span className="text-slate-600">Delivery and service charges on supplier invoices</span><b>{money(opex.supplierCharges)}</b></div>
        <div className="flex justify-between"><span className="text-slate-600">Tax on supplier invoices</span><b>{money(opex.supplierTax)}</b></div>
        <div className="flex justify-between border-t border-slate-200 pt-1.5 font-semibold"><span>Total operating expenses</span><span>{money(operatingExpensesTotal)}</span></div>
      </div>
      <p className="mt-3 text-xs text-slate-500">Each cost is counted once. Paying a supplier invoice is not counted here: the parts it bought are counted as parts cost (before tax) when they are sold, and only its delivery and service charges and its tax are expenses. Voided expenses, vouchers and supplier invoices are not counted.</p>
    </section>

    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"><div className="mb-4 flex items-center gap-2"><Package className="h-5 w-5 text-blue-600"/><h2 className="font-semibold">Top Selling Work Items</h2></div>{topItems.length ? <div className="space-y-3">{topItems.map(([name,v])=><div key={name} className="flex items-center justify-between gap-4 border-b border-slate-100 pb-2 text-sm"><span className="truncate">{name}<span className="ml-2 text-xs text-slate-400">× {Math.round(v.quantity * 100) / 100}</span></span><b>{money(v.sales)}</b></div>)}</div> : <p className="text-sm text-slate-400">No item sales in this period.</p>}</section>
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"><div className="mb-4 flex items-center gap-2"><Users className="h-5 w-5 text-blue-600"/><h2 className="font-semibold">Technician Performance (by assigned paid jobs)</h2></div>{staff.length ? <div className="space-y-3">{staff.map(([name,v])=><div key={name} className="flex items-center justify-between gap-4 border-b border-slate-100 pb-2 text-sm"><span>{name}<span className="ml-2 text-xs text-slate-400">{v.jobs} jobs</span></span><b>{money(v.revenue)}</b></div>)}</div> : <p className="text-sm text-slate-400">No assigned paid jobs in this period.</p>}</section>
    </div>
    <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="mb-1 font-semibold text-slate-900">Export Data (CSV)</h2>
      <p className="mb-4 text-sm text-slate-500">Download a spreadsheet file that opens in Excel. Invoices and expenses follow the period selected above. Every download is recorded in the audit log.</p>
      <div className="flex flex-wrap gap-2">{[
        ["invoices", `Invoices (${RANGES[range]})`, `?range=${range}`],
        ["expenses", `Expenses (${RANGES[range]})`, `?range=${range}`],
        ["customers", "Customers", ""],
        ["vehicles", "Vehicles", ""],
        ["inventory", "Inventory", ""],
      ].map(([kind, label, qs]) => <a key={kind} href={`/api/export/${kind}${qs}`} download className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50">{label}</a>)}</div>
    </section>
    <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"><strong>Important:</strong> Collections are the payments received in the period (refunds taken off), in Malaysia time. SST and parts cost are shared out by the part of each job paid in the period. Estimated Net Profit = Collections − tax collected − recorded parts cost − recorded operating expenses. It excludes costs that were never recorded (e.g. depreciation). Technician figures use assigned paid work orders, not time-clock productivity.</div>
  </div>;
}
