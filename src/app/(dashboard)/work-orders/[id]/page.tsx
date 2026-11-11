import { Header } from "@/components/layout/Header";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, Receipt, FileCheck, ArrowRight } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { STATUS_LABEL, STATUS_COLOR } from "@/lib/status";
import { OrderActions } from "@/components/work-orders/OrderActions";

export const dynamic = "force-dynamic";

export default async function WorkOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const order = await prisma.workOrder.findUnique({
    where: { id },
    include: { customer: true, vehicle: true, items: true, payments: true },
  });
  if (!order) notFound();

  const remaining = Math.max(0, order.totalAmount - order.paidAmount);

  const docs = [
    { href: "quotation", label: "Quotation", no: order.quotationNumber, empty: "Not generated", icon: FileText, color: "bg-blue-50 text-blue-700" },
    { href: "invoice", label: "Invoice", no: order.invoiceNumber, empty: "After completion", icon: FileCheck, color: "bg-violet-50 text-violet-700" },
    { href: "receipt", label: "Receipt", no: order.receiptNumber, empty: "After payment", icon: Receipt, color: "bg-emerald-50 text-emerald-700" },
  ];

  return (
    <div>
      <Header
        title={`Work Order ${order.orderNumber}`}
        description={`${order.vehicle.plateNumber} · ${order.customer.name}`}
        actions={
          <Link href="/work-orders" className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Back to List
          </Link>
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLOR[order.status] || ""}`}>
                {STATUS_LABEL[order.status] || order.status}
              </span>
              <h2 className="mt-2 text-lg font-semibold text-slate-900">
                {order.vehicle.plateNumber} · {order.vehicle.make} {order.vehicle.model}
              </h2>
              {order.description && <p className="mt-1 text-sm text-slate-500">{order.description}</p>}
              {order.diagnosis && <p className="mt-1 text-sm text-slate-500">Diagnosis: {order.diagnosis}</p>}
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-slate-900">{formatCurrency(order.totalAmount)}</div>
              <div className="text-xs text-slate-500">Total Amount</div>
              <div className="mt-1 text-xs text-slate-500">
                Paid {formatCurrency(order.paidAmount)} · Balance {formatCurrency(remaining)}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm text-slate-500">Customer</div>
          <div className="mt-1 font-medium text-slate-900">{order.customer.name}</div>
          <div className="text-sm text-slate-600">{order.customer.phone}</div>
          <div className="mt-3 text-sm text-slate-500">Created</div>
          <div className="text-sm text-slate-700">{formatDateTime(order.createdAt)}</div>
        </div>
      </div>

      <OrderActions
        id={order.id}
        status={order.status}
        hasInvoice={!!order.invoiceNumber}
        remaining={remaining}
      />

      <div className="mb-6">
        <h3 className="mb-3 text-sm font-semibold text-slate-700">Documents</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {docs.map((d) => {
            const Icon = d.icon;
            return (
              <Link key={d.href} href={`/work-orders/${order.id}/${d.href}`} className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-blue-300 hover:bg-blue-50/50">
                <div className={`flex h-12 w-12 items-center justify-center rounded-lg ${d.color}`}>
                  <Icon className="h-6 w-6" />
                </div>
                <div className="flex-1">
                  <div className="font-medium text-slate-900">{d.label}</div>
                  <div className="text-xs text-slate-500">{d.no || d.empty}</div>
                </div>
                <ArrowRight className="h-4 w-4 text-slate-400" />
              </Link>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4 font-semibold text-slate-900">Line Items</div>
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-5 py-2.5 text-left font-medium">Description</th>
              <th className="px-5 py-2.5 text-right font-medium">Qty</th>
              <th className="px-5 py-2.5 text-right font-medium">Unit Price</th>
              <th className="px-5 py-2.5 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {order.items.map((item) => (
              <tr key={item.id}>
                <td className="px-5 py-3">
                  {item.description}
                  {item.type === "LABOR" && <span className="ml-2 text-xs text-slate-400">Labor</span>}
                </td>
                <td className="px-5 py-3 text-right">{item.quantity}</td>
                <td className="px-5 py-3 text-right">{formatCurrency(item.unitPrice)}</td>
                <td className="px-5 py-3 text-right font-medium">{formatCurrency(item.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {order.payments.length > 0 && (
        <div className="mt-6 rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4 font-semibold text-slate-900">Payments</div>
          <div className="divide-y divide-slate-100 text-sm">
            {order.payments.map((p) => (
              <div key={p.id} className="flex justify-between px-5 py-3">
                <span className="text-slate-600">{formatDateTime(p.paidAt)} · {p.method}</span>
                <span className="font-medium">{formatCurrency(p.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
