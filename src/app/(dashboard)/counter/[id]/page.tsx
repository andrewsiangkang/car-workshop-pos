import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PrintButton } from "@/components/documents/PrintButton";
import { VarianceText } from "@/components/counter/CounterPanel";
import { prisma } from "@/lib/prisma";
import { computeSummary, varianceKind } from "@/lib/counter-calc";
import { PAYMENT_LABEL } from "@/lib/status";
import { formatCurrency, formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

const KIND_BOX = {
  short: "border-red-200 bg-red-50 text-red-700",
  over: "border-amber-200 bg-amber-50 text-amber-800",
  balanced: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

/** Daily settlement report for one counter session: totals, cash check (short / over), every payment, printable. */
export default async function CounterDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const shift = await prisma.cashShift.findUnique({ where: { id } });
  if (!shift) notFound();

  const payments = await prisma.payment.findMany({
    where: { shiftId: id },
    orderBy: { paidAt: "asc" },
    include: { workOrder: { select: { orderNumber: true, receiptNumber: true, vehicle: { select: { plateNumber: true } } } } },
  });
  const s = computeSummary(shift.openingFloat, payments);
  const closed = !!shift.closedAt;
  const expected = shift.expectedCash ?? s.expectedCash;
  const variance = shift.variance ?? 0;
  const kind = varianceKind(variance);
  const otherMethods = s.methods.filter((m) => m.method !== "CASH");
  const totalCollected = s.methods.reduce((t, m) => t + m.net, 0);

  return (
    <div>
      <div className="no-print mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/counter" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
            <ArrowLeft className="h-4 w-4" />
            Back to Counter
          </Link>
          <h1 className="text-lg font-semibold text-slate-900">Settlement Preview</h1>
        </div>
        <PrintButton />
      </div>

      <div className="print-area paper-a4 mx-auto max-w-3xl bg-white p-8 text-slate-900 shadow-sm print:shadow-none">
        <div className="mb-6 flex items-start justify-between border-b border-slate-200 pb-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Daily Settlement Report</h1>
            <p className="mt-1 text-sm text-slate-500">{closed ? "Closed" : "Still open - figures so far"}</p>
          </div>
          <div className="text-right text-sm">
            <div>
              <span className="text-slate-500">Opened: </span>
              {formatDateTime(shift.openedAt)} · {shift.openedByName}
            </div>
            {shift.closedAt && (
              <div>
                <span className="text-slate-500">Closed: </span>
                {formatDateTime(shift.closedAt)} · {shift.closedByName}
              </div>
            )}
          </div>
        </div>

        <div className="mb-6 rounded-lg bg-slate-50 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Total Collected (all methods)</span>
            <span className="font-semibold">{formatCurrency(totalCollected)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Number of Payments</span>
            <span>{s.paymentCount}</span>
          </div>
        </div>

        <div className="mb-6 space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Opening Float</span>
            <span>{formatCurrency(s.openingFloat)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">+ Cash Received from Customers</span>
            <span>{formatCurrency(s.cashReceived)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">− Change Given Back</span>
            <span>{formatCurrency(s.changeGiven)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">− Cash Refunds</span>
            <span>{formatCurrency(s.cashRefunds)}</span>
          </div>
          <div className="flex justify-between border-t border-slate-200 pt-2 font-semibold">
            <span>Expected Cash in Drawer</span>
            <span>{formatCurrency(expected)}</span>
          </div>
          {closed && (
            <>
              <div className="flex justify-between font-semibold">
                <span>Cash Counted</span>
                <span>{formatCurrency(shift.countedCash ?? 0)}</span>
              </div>
              <div className={`mt-2 flex justify-between rounded-lg border px-4 py-3 text-base font-bold ${KIND_BOX[kind]}`}>
                <span>Result</span>
                <span>
                  <VarianceText kind={kind} amount={variance} />
                </span>
              </div>
            </>
          )}
        </div>

        {shift.notes && (
          <div className="mb-6 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
            <span className="font-medium text-slate-700">Notes: </span>
            {shift.notes}
          </div>
        )}

        {otherMethods.length > 0 && (
          <div className="mb-6 text-sm">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Other Payments (not in the drawer)</div>
            {otherMethods.map((m) => (
              <div key={m.method} className="flex justify-between border-t border-slate-100 py-1.5">
                <span>
                  {PAYMENT_LABEL[m.method] || m.method} ({m.count})
                </span>
                <span>{formatCurrency(m.net)}</span>
              </div>
            ))}
          </div>
        )}

        <div className="mb-8">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Payments in this session</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="pb-2 font-medium">Time</th>
                <th className="pb-2 font-medium">Job</th>
                <th className="pb-2 font-medium">Method</th>
                <th className="pb-2 text-right font-medium">Received</th>
                <th className="pb-2 text-right font-medium">Change</th>
                <th className="pb-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payments.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-500">
                    No payments
                  </td>
                </tr>
              )}
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="py-2">{formatDateTime(p.paidAt)}</td>
                  <td className="py-2">
                    {p.workOrder.orderNumber} · {p.workOrder.vehicle.plateNumber}
                  </td>
                  <td className="py-2">{p.amount < 0 ? "Refund" : PAYMENT_LABEL[p.method] || p.method}</td>
                  <td className="py-2 text-right">{p.method === "CASH" && p.tendered != null ? formatCurrency(p.tendered) : ""}</td>
                  <td className="py-2 text-right">{p.method === "CASH" && p.tendered != null ? formatCurrency(p.changeGiven ?? 0) : ""}</td>
                  <td className="py-2 text-right font-medium">{formatCurrency(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-12 grid grid-cols-2 gap-16 text-sm">
          <div>
            <div className="mb-16 border-b border-slate-400"></div>
            <div className="font-medium">Counted by</div>
            <div className="mt-1 text-xs text-slate-500">{shift.closedByName || ""}</div>
          </div>
          <div>
            <div className="mb-16 border-b border-slate-400"></div>
            <div className="font-medium">Checked by (Boss)</div>
          </div>
        </div>
      </div>
    </div>
  );
}
