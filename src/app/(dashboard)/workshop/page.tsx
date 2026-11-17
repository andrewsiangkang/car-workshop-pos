import Link from "next/link";
import { CalendarClock, Clock3, Gauge, Plus, Wrench } from "lucide-react";
import { Header } from "@/components/layout/Header";
import { prisma } from "@/lib/prisma";
import { requirePageUser } from "@/lib/auth";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { STATUS_LABEL, STATUS_COLOR } from "@/lib/status";

export const dynamic = "force-dynamic";

const LANES = [
  { key: "QUOTED", title: "Ready to Confirm", hint: "Quotes awaiting customer confirmation" },
  { key: "CONFIRMED", title: "Ready for Workshop", hint: "Approved jobs waiting to start" },
  { key: "IN_PROGRESS", title: "In Progress", hint: "Vehicles currently being serviced" },
  { key: "COMPLETED", title: "Completed", hint: "Finished jobs" },
] as const;

const PRIORITY: Record<string, { label: string; style: string }> = {
  LOW: { label: "Low", style: "bg-slate-100 text-slate-600" },
  NORMAL: { label: "Normal", style: "bg-blue-50 text-blue-700" },
  HIGH: { label: "High", style: "bg-amber-50 text-amber-700" },
  URGENT: { label: "Urgent", style: "bg-red-50 text-red-700" },
};

export default async function WorkshopBoardPage() {
  await requirePageUser();
  const orders = await prisma.workOrder.findMany({
    where: { status: { in: LANES.map((lane) => lane.key) } },
    orderBy: [{ estimatedCompletionAt: "asc" }, { createdAt: "asc" }],
    take: 300,
    include: {
      customer: { select: { name: true } },
      vehicle: { select: { plateNumber: true, make: true, model: true } },
      assignedTo: { select: { name: true } },
    },
  });

  const priorityRank: Record<string, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
  orders.sort((a, b) => (priorityRank[a.priority] ?? 2) - (priorityRank[b.priority] ?? 2));
  const now = new Date();
  const active = orders.filter((order) => order.status === "CONFIRMED" || order.status === "IN_PROGRESS");
  const overdue = active.filter((order) => order.estimatedCompletionAt && order.estimatedCompletionAt < now);
  const urgent = active.filter((order) => order.priority === "URGENT" || order.priority === "HIGH");

  return (
    <div className="space-y-6">
      <Header
        title="Workshop Board"
        description="A live overview of workshop jobs, priorities and expected completion."
        actions={
          <Link href="/work-orders/new" className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-800">
            <Plus className="h-4 w-4" /> New Work Order
          </Link>
        }
      />

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between text-sm text-slate-500"><span>Active Workshop Jobs</span><Wrench className="h-4 w-4" /></div>
          <div className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{active.length}</div>
          <div className="mt-1 text-xs text-slate-500">Confirmed and in progress</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between text-sm text-slate-500"><span>Overdue Estimates</span><Clock3 className="h-4 w-4" /></div>
          <div className="mt-2 text-3xl font-bold tracking-tight text-red-600">{overdue.length}</div>
          <div className="mt-1 text-xs text-slate-500">Past their estimated completion time</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between text-sm text-slate-500"><span>High / Urgent Priority</span><Gauge className="h-4 w-4" /></div>
          <div className="mt-2 text-3xl font-bold tracking-tight text-amber-600">{urgent.length}</div>
          <div className="mt-1 text-xs text-slate-500">Active jobs marked high or urgent</div>
        </div>
      </section>

      <div className="flex items-center gap-2 text-xs text-slate-500">
        <CalendarClock className="h-4 w-4" /> Showing the latest 300 active and recently completed work orders. Cancelled jobs remain in Work Orders.
      </div>

      <section className="grid gap-4 xl:grid-cols-4">
        {LANES.map((lane) => {
          const rows = orders.filter((order) => order.status === lane.key);
          return (
            <div key={lane.key} className="min-w-0 rounded-xl border border-slate-200 bg-slate-50/80 p-3">
              <div className="mb-3 flex items-start justify-between gap-2 px-1">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">{lane.title}</h2>
                  <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{lane.hint}</p>
                </div>
                <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-slate-600 shadow-sm">{rows.length}</span>
              </div>
              <div className="space-y-3">
                {rows.length === 0 && <div className="rounded-lg border border-dashed border-slate-300 bg-white/70 px-3 py-8 text-center text-xs text-slate-400">No jobs in this stage</div>}
                {rows.map((order) => {
                  const priority = PRIORITY[order.priority] || PRIORITY.NORMAL;
                  const isOverdue = !!order.estimatedCompletionAt && order.estimatedCompletionAt < now && order.status !== "COMPLETED";
                  return (
                    <Link key={order.id} href={`/work-orders/${order.id}`} className="block rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-semibold text-blue-700">{order.orderNumber}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${priority.style}`}>{priority.label}</span>
                      </div>
                      <div className="mt-2 font-semibold text-slate-900">{order.vehicle.plateNumber}</div>
                      <div className="text-xs text-slate-500">{order.vehicle.make} {order.vehicle.model}</div>
                      <div className="mt-2 text-xs text-slate-700">{order.customer.name}</div>
                      <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-xs">
                        <span className="text-slate-500">{order.assignedTo?.name || "Unassigned"}</span>
                        <span className="font-semibold text-slate-800">{formatCurrency(order.totalAmount)}</span>
                      </div>
                      {order.startedAt && <div className="mt-2 text-[10px] text-slate-500">Started · {formatDateTime(order.startedAt)}</div>}
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_COLOR[order.status] || ""}`}>{STATUS_LABEL[order.status] || order.status}</span>
                        {order.estimatedCompletionAt ? (
                          <span className={`text-[10px] ${isOverdue ? "font-semibold text-red-600" : "text-slate-500"}`}>{isOverdue ? "Overdue · " : "Due · "}{formatDateTime(order.estimatedCompletionAt)}</span>
                        ) : <span className="text-[10px] text-slate-400">No due estimate</span>}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
