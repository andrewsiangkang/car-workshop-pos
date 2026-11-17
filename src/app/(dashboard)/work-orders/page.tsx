import { Header } from "@/components/layout/Header";
import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { STATUS_LABEL, STATUS_COLOR, VALID_STATUSES } from "@/lib/status";
import type { WorkOrderStatus } from "@prisma/client";
import { requirePageUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function WorkOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  await requirePageUser();
  const { q = "", status = "" } = await searchParams;
  const term = q.trim();

  const orders = await prisma.workOrder.findMany({
    where: {
      // Ignore unknown values (an invalid enum used to crash the page).
      ...(VALID_STATUSES.includes(status) ? { status: status as WorkOrderStatus } : {}),
      ...(term
        ? {
            OR: [
              { orderNumber: { contains: term } },
              { vehicle: { plateNumber: { contains: term.toUpperCase() } } },
              { customer: { name: { contains: term } } },
              { customer: { phone: { contains: term } } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { customer: true, vehicle: true },
  });

  return (
    <div>
      <Header
        title="Work Orders"
        description="Manage all work orders and progress"
        actions={
          <Link href="/work-orders/new" className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-800">
            <Plus className="h-4 w-4" />
            New Work Order
          </Link>
        }
      />

      <form method="get" className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input name="q" defaultValue={q} type="text" placeholder="Search order no.、Plate、Customer name or phone..." className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
        </div>
        <select name="status" defaultValue={status} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none">
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <button className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">Search</button>
      </form>

      {/* On a phone (375 px) Status and Created move under the order number, so the Amount column stays
          on screen; the table can still scroll sideways instead of being cut off.
          【中文】手机上把状态和日期放到单号下面，金额栏不会被切掉；太窄时表格可以左右滑动。 */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-3 font-medium sm:px-5">Order No.</th>
              <th className="px-3 py-3 font-medium sm:px-5">Vehicle / Customer</th>
              <th className="hidden px-5 py-3 font-medium sm:table-cell">Status</th>
              <th className="hidden px-5 py-3 font-medium md:table-cell">Created</th>
              <th className="px-3 py-3 text-right font-medium sm:px-5">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {orders.length === 0 && (
              <tr><td colSpan={5} className="px-5 py-10 text-center text-slate-400">No work orders</td></tr>
            )}
            {orders.map((o) => (
              <tr key={o.id} className="hover:bg-slate-50">
                <td className="px-3 py-3.5 align-top sm:px-5">
                  <Link href={`/work-orders/${o.id}`} className="whitespace-nowrap font-medium text-blue-600 hover:underline">{o.orderNumber}</Link>
                  <div className="mt-1 sm:hidden">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_COLOR[o.status] || ""}`}>
                      {STATUS_LABEL[o.status] || o.status}
                    </span>
                  </div>
                  <div className="mt-1 whitespace-nowrap text-xs text-slate-500 md:hidden">{formatDateTime(o.createdAt)}</div>
                </td>
                <td className="px-3 py-3.5 align-top sm:px-5">
                  <div className="font-medium text-slate-900">{o.vehicle.plateNumber}</div>
                  <div className="break-words text-xs text-slate-500">{o.customer.name} · {o.vehicle.make} {o.vehicle.model}</div>
                </td>
                <td className="hidden px-5 py-3.5 sm:table-cell">
                  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLOR[o.status] || ""}`}>
                    {STATUS_LABEL[o.status] || o.status}
                  </span>
                </td>
                <td className="hidden px-5 py-3.5 text-slate-500 md:table-cell">{formatDateTime(o.createdAt)}</td>
                <td className="whitespace-nowrap px-3 py-3.5 text-right align-top font-medium text-slate-900 sm:px-5">{formatCurrency(o.totalAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
