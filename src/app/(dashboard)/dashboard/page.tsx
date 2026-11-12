import { Header } from "@/components/layout/Header";
import { Wrench, DollarSign, TrendingUp, Car, Package } from "lucide-react";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { STATUS_LABEL, STATUS_COLOR } from "@/lib/status";
import { getCurrentUser, isOwner } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const owner = isOwner(await getCurrentUser());

  const [todayPayments, activeCount, quotedCount, monthOrders, recentOrders, invItems] =
    await Promise.all([
      // Money figures (collections / cost / profit) are boss-only: staff queries are skipped entirely.
      owner
        ? prisma.payment.aggregate({ _sum: { amount: true }, where: { paidAt: { gte: startOfDay } } })
        : Promise.resolve(null),
      prisma.workOrder.count({ where: { status: { in: ["CONFIRMED", "IN_PROGRESS"] } } }),
      prisma.workOrder.count({ where: { status: "QUOTED" } }),
      owner
        ? prisma.workOrder.findMany({
            where: { paidAt: { gte: startOfMonth } },
            include: { items: true },
          })
        : Promise.resolve([]),
      prisma.workOrder.findMany({
        orderBy: { createdAt: "desc" },
        take: 6,
        include: { customer: true, vehicle: true },
      }),
      prisma.inventoryItem.findMany({ select: { quantityOnHand: true, minStockLevel: true } }),
    ]);

  const lowStock = invItems.filter((i) => i.quantityOnHand <= i.minStockLevel).length;

  const monthRevenue = monthOrders.reduce((s, o) => s + o.paidAmount, 0);
  const monthCost = monthOrders.reduce(
    (s, o) => s + o.items.reduce((c, i) => c + i.costPrice * i.quantity, 0),
    0
  );

  const stats = [
    ...(owner
      ? [{ name: "Today's Collections", value: formatCurrency(todayPayments?._sum.amount || 0), note: "Amount received today", icon: DollarSign, color: "bg-emerald-50 text-emerald-700" }]
      : []),
    { name: "Active Orders", value: String(activeCount), note: `${quotedCount}  awaiting confirmation`, icon: Wrench, color: "bg-blue-50 text-blue-700" },
    ...(owner
      ? [{ name: "This Month Profit", value: formatCurrency(monthRevenue - monthCost), note: "Collections − parts cost", icon: TrendingUp, color: "bg-violet-50 text-violet-700" }]
      : []),
    { name: "Low Stock Items", value: String(lowStock), note: "Need restock", icon: Package, color: "bg-amber-50 text-amber-700" },
  ];

  return (
    <div>
      <Header
        title="Dashboard"
        description={`Today is ${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`}
        actions={
          <Link href="/work-orders/new" className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-800">
            <Wrench className="h-4 w-4" />
            New Work Order
          </Link>
        }
      />

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
