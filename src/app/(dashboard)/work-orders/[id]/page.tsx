import { Header } from "@/components/layout/Header";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, Receipt, FileCheck, ArrowRight } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { STATUS_LABEL, STATUS_COLOR } from "@/lib/status";
import { OrderActions } from "@/components/work-orders/OrderActions";
import { CreditNotePanel } from "@/components/work-orders/CreditNotePanel";
import { isOwner, requirePageUser } from "@/lib/auth";
import { envFromSandboxFlag, isReportedFor } from "@/lib/einvoice-state.mjs";
import { consolidationTreatment } from "@/lib/einvoice-rules.mjs";
import { getOpenShift } from "@/lib/counter";
import { jobProfit } from "@/lib/order-profit.mjs";
import { amountDueCents } from "@/lib/credit-calc.mjs";

export const dynamic = "force-dynamic";

export default async function WorkOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requirePageUser();
  const { id } = await params;
  const owner = isOwner(me);
  const order = await prisma.workOrder.findUnique({
    where: { id },
    include: {
      customer: true, vehicle: true, items: true, payments: true,
      // Only what the credit-note panel shows (the frozen docSnapshot stays on the server).
      creditNotes: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true, number: true, amount: true, taxAmount: true, refundAmount: true, reason: true, createdAt: true,
          eInvoiceUuid: true, eInvoiceStatus: true, eInvoiceEnv: true, eInvoiceType: true, submissionUid: true,
          eInvoiceSubmittingAt: true,
          lines: { select: { id: true, description: true, quantity: true, returnedToStock: true, workOrderItemId: true } },
        },
      },
    },
  });
  if (!order) notFound();
  const counterOpen = !!(await getOpenShift());

  // Same rule as the payment route and refundLimits: a fully credited invoice owes nothing.
  const remaining = amountDueCents(order) / 100;
  const consolidated = order.consolidatedId
    ? await prisma.consolidatedInvoice.findUnique({ where: { id: order.consolidatedId } })
    : null;
  // Reported for the LHDN system in use: a real e-Invoice always; while testing, a sandbox one too.
  const shopEnv = envFromSandboxFlag((await prisma.shopProfile.findFirst({ select: { myInvoisSandbox: true } }))?.myInvoisSandbox);
  const originalReported = isReportedFor(order, shopEnv) || isReportedFor(consolidated, shopEnv);
  // Not reported yet but due its own e-Invoice (same rule as the monthly page): the buyer asked for
  // one (QR / staff) or the customer has a TIN on file. Its credit notes will then have to be sent too.
  // 【中文】还没申报、但应单独开电子发票（顾客要求过或有 TIN）：它的退款单之后也要送 LHDN。
  const individualPending =
    !originalReported &&
    !!consolidationTreatment({ reported: false, buyerRequested: !!order.buyerRequestedAt, customerTin: order.customer?.tin, monthEnded: false }).individual;

  // Boss-only: what the parts cost us and what we make on this job. Parts a credit note put
  // back on the shelf are not a cost any more (fully credited + returned = 0 profit, not −cost).
  // SST collected belongs to Customs (JKDM), so it is not profit. Each credit note records the
  // SST it credits (by the invoice's tax scope), so use those instead of a pro-rata guess.
  const profit = jobProfit(order);
  const creditedTax = order.creditNotes.reduce((s, cn) => s + cn.taxAmount, 0);
  // Quantity of each invoice line already credited (for the credit-note line picker).
  const creditedQty = new Map<string, number>();
  for (const cn of order.creditNotes) {
    for (const l of cn.lines) {
      if (l.workOrderItemId) creditedQty.set(l.workOrderItemId, (creditedQty.get(l.workOrderItemId) || 0) + l.quantity);
    }
  }

  const docs = [
    { href: "quotation", label: "Quotation", no: order.quotationNumber, empty: "Not generated", icon: FileText, color: "bg-blue-50 text-blue-700" },
    { href: "invoice", label: "Invoice", no: order.invoiceNumber, empty: "After completion", icon: FileCheck, color: "bg-violet-50 text-violet-700" },
    { href: "receipt", label: "Receipt", no: order.receiptNumber, empty: "After payment", icon: Receipt, color: "bg-emerald-50 text-emerald-700" },
  ];

  return (
    <div>
      <Header
        title={<><span>Work Order</span> <span data-no-i18n>{order.orderNumber}</span></>}
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
              <div className="text-xs text-slate-500">
                Total Amount{order.taxAmount > 0 ? ` (incl. SST ${order.taxRate}% ${formatCurrency(order.taxAmount)})` : ""}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {order.creditedAmount > 0 && <>Credited -{formatCurrency(order.creditedAmount)} · </>}
                Paid {formatCurrency(order.paidAmount)} · Balance {formatCurrency(remaining)}
              </div>
              {consolidated && (
                <div className="mt-1 text-xs text-slate-500">Reported in {consolidated.number} ({consolidated.eInvoiceStatus || "not submitted"})</div>
              )}
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
        counterOpen={counterOpen}
      />

      {owner && order.invoiceNumber && order.status !== "CANCELLED" && (
        <CreditNotePanel
          orderId={order.id}
          creditable={Math.max(0, Math.round((order.totalAmount - order.creditedAmount) * 100) / 100)}
          paid={order.paidAmount}
          originalReported={originalReported}
          individualPending={individualPending}
          notes={order.creditNotes}
          invoice={{
            totalAmount: order.totalAmount,
            taxAmount: order.taxAmount,
            taxRate: order.taxRate,
            taxScope: order.taxScope,
            discount: order.discount,
            creditedAmount: order.creditedAmount,
            creditedTax,
            paidAmount: order.paidAmount,
            roundingAdjustment: order.roundingAdjustment || 0,
          }}
          lines={order.items.map((i) => ({
            id: i.id,
            type: i.type,
            description: i.description,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            total: i.total,
            linked: i.type === "PART" && !!i.inventoryItemId,
            credited: Math.round((creditedQty.get(i.id) || 0) * 1000) / 1000,
          }))}
        />
      )}

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
              {owner && <th className="px-5 py-2.5 text-right font-medium">Unit Cost</th>}
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
                {owner && (
                  <td className="px-5 py-3 text-right text-slate-500">
                    {item.type === "LABOR" ? "-" : formatCurrency(item.costPrice)}
                  </td>
                )}
                <td className="px-5 py-3 text-right font-medium">{formatCurrency(item.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {owner && (
        <div className="mt-6 rounded-xl border border-violet-200 bg-violet-50/60 p-5 shadow-sm">
          <div className="mb-3 text-sm font-semibold text-violet-900">Boss only · Cost &amp; Profit</div>
          <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            <div>
              <div className="text-xs text-slate-500">Parts Cost</div>
              <div className="text-lg font-bold text-slate-900">{formatCurrency(profit.netCost)}</div>
              {profit.returnedCost > 0 && (
                <div className="text-xs text-slate-500">
                  <span>Less returned to stock</span> -{formatCurrency(profit.returnedCost)}
                </div>
              )}
            </div>
            <div>
              <div className="text-xs text-slate-500">Order Total</div>
              <div className="text-lg font-bold text-slate-900">{formatCurrency(order.totalAmount)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Gross Profit</div>
              <div className={`text-lg font-bold ${profit.grossProfit < 0 ? "text-red-600" : "text-emerald-700"}`}>
                {formatCurrency(profit.grossProfit)}
              </div>
            </div>
          </div>
        </div>
      )}

      {order.payments.length > 0 && (
        <div className="mt-6 rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4 font-semibold text-slate-900">Payments</div>
          <div className="divide-y divide-slate-100 text-sm">
            {order.payments.map((p) => (
              <div key={p.id} className="flex justify-between px-5 py-3">
                <div>
                  <span className="text-slate-600">{formatDateTime(p.paidAt)} · {p.method}</span>
                  {p.method === "CASH" && p.tendered != null && (
                    <div className="mt-0.5 text-xs text-slate-400">
                      <span>Received</span> {formatCurrency(p.tendered)} <span>·</span> <span>Change</span>{" "}
                      {formatCurrency(p.changeGiven ?? 0)}
                    </div>
                  )}
                </div>
                <span className="font-medium">{formatCurrency(p.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
