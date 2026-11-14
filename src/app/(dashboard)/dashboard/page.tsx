import { Header } from "@/components/layout/Header";
import { Wrench, DollarSign, TrendingUp, Car, Package } from "lucide-react";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { STATUS_LABEL, STATUS_COLOR } from "@/lib/status";
import { isOwner, requirePageUser } from "@/lib/auth";
import { periodTotals } from "@/lib/money-reports.mjs";
import { myDateKey, myDayStart, myMonthStart } from "@/lib/money-time.mjs";
import { waitingBuyerRequests } from "@/lib/consolidation";
import { BUYER_REQUEST_ALERT_DAYS } from "@/lib/einvoice-rules.mjs";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const me = await requirePageUser();
  // "Today" and "this month" are Malaysian calendar days, whatever the PC's time zone is.
  // 【中文】"今天"、"本月"按马来西亚日历，不受电脑时区影响。
  const now = new Date();
  const startOfDay = myDayStart(now);
  const startOfMonth = myMonthStart(now);

  const owner = isOwner(me);
  // Customers who asked for their own e-Invoice more than 3 days ago (boss only; the list is on /einvoice).
  // 【中文】要求个别电子发票超过 3 天还没开出的顾客（只有老板看到，详细清单在电子发票页）。
  const waiting = owner ? await waitingBuyerRequests() : { list: [], total: 0, more: false };

  const [todayPayments, activeCount, quotedCount, monthPayments, monthCredits, recentOrders, invItems] =
    await Promise.all([
      // Money figures (collections / cost / profit) are boss-only: staff queries are skipped entirely.
      owner
        ? prisma.payment.aggregate({ _sum: { amount: true }, where: { paidAt: { gte: startOfDay } } })
        : Promise.resolve(null),
      prisma.workOrder.count({ where: { status: { in: ["CONFIRMED", "IN_PROGRESS"] } } }),
      prisma.workOrder.count({ where: { status: "QUOTED" } }),
      // This month's money is read from the Payment ledger (same rule as the reports page): jobs paid,
      // refunded or credited this month. 【中文】本月数字按收款记录计算（与报表同一规则）。
      owner
        ? prisma.payment.findMany({ where: { paidAt: { gte: startOfMonth } }, select: { workOrderId: true }, distinct: ["workOrderId"] })
        : Promise.resolve([]),
      owner
        ? prisma.creditNote.findMany({ where: { createdAt: { gte: startOfMonth } }, select: { workOrderId: true }, distinct: ["workOrderId"] })
        : Promise.resolve([]),
      prisma.workOrder.findMany({
        orderBy: { createdAt: "desc" },
        take: 6,
        include: { customer: true, vehicle: true },
      }),
      // Archived (deleted) stock items are not counted.
      prisma.inventoryItem.findMany({ where: { archivedAt: null }, select: { quantityOnHand: true, minStockLevel: true } }),
    ]);

  const lowStock = invItems.filter((i) => i.quantityOnHand <= i.minStockLevel).length;

  const monthJobIds = [...new Set([...monthPayments, ...monthCredits].map((p) => p.workOrderId))];
  // Every payment and credit note of those jobs is read, so what was paid before this month is known.
  const monthJobs = monthJobIds.length
    ? await prisma.workOrder.findMany({
        where: { id: { in: monthJobIds } },
        include: {
          items: true,
          payments: { select: { amount: true, paidAt: true } },
          creditNotes: {
            select: { amount: true, taxAmount: true, createdAt: true, lines: { select: { workOrderItemId: true, returnedToStock: true } } },
          },
        },
      })
    : [];
  // Collections − SST − parts cost (parts returned to stock by a credit note are no longer a cost).
  const month = periodTotals(monthJobs, (at) => at >= startOfMonth);

  const stats = [
    ...(owner
      ? [{ name: "Today's Collections", value: formatCurrency(todayPayments?._sum.amount || 0), note: "Amount received today", icon: DollarSign, color: "bg-emerald-50 text-emerald-700" }]
      : []),
    { name: "Active Orders", value: String(activeCount), note: `${quotedCount}  awaiting confirmation`, icon: Wrench, color: "bg-blue-50 text-blue-700" },
    ...(owner
      ? [{ name: "This Month Profit", value: formatCurrency(month.grossProfit), note: "Collections − SST − parts cost", icon: TrendingUp, color: "bg-violet-50 text-violet-700" }]
      : []),
    { name: "Low Stock Items", value: String(lowStock), note: "Need restock", icon: Package, color: "bg-amber-50 text-amber-700" },
  ];

  return (
    <div>
      <Header
        title="Dashboard"
        description={`Today is ${myDateKey(now)}`}
        actions={
          <Link href="/work-orders/new" className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-800">
            <Wrench className="h-4 w-4" />
            New Work Order
          </Link>
        }
      />

      {waiting.total > 0 && (
        <Link
          href="/einvoice"
          className="mb-6 block rounded-xl border-2 border-red-300 bg-red-50 p-4 text-sm font-semibold text-red-900 hover:bg-red-100"
        >
          {`Customers waiting for their own e-Invoice for more than ${BUYER_REQUEST_ALERT_DAYS} days: ${waiting.total}${waiting.more ? "+" : ""}`}
        </Link>
      )}

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.name} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500">{stat.name}</p>
                  <p className="mt-1 text-2xl font-bold text-slate-900">{stat.value}</p>
                  <p className="mt-1 text-xs text-slate-400">{stat.note}</p>
                </div>
                <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${stat.color}`}>
                  <Icon className="h-6 w-6" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-1">
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm ">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h2 className="font-semibold text-slate-900">Recent Orders</h2>
            <Link href="/work-orders" className="text-sm text-blue-600 hover:underline">View all</Link>
          </div>
          {recentOrders.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-slate-400">No work orders yet. Click “New Work Order” to start.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {recentOrders.map((o) => (
                <Link key={o.id} href={`/work-orders/${o.id}`} className="flex items-center justify-between px-5 py-4 hover:bg-slate-50">
                  <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100">
                      <Car className="h-5 w-5 text-slate-600" />
                    </div>
                    <div>
                      <div className="font-medium text-slate-900">{o.vehicle.plateNumber} · {o.customer.name}</div>
                      <div className="text-xs text-slate-500">{o.orderNumber} · {formatDateTime(o.createdAt)}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium text-slate-900">{formatCurrency(o.totalAmount)}</div>
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[o.status] || ""}`}>
                      {STATUS_LABEL[o.status] || o.status}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
