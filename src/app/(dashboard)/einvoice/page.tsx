import { redirect } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { getCurrentUser, isOwner } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatDate } from "@/lib/utils";
import { consolidationPreview, isValidMonth, previousMonth } from "@/lib/consolidation";
import { SubmitButtons } from "@/components/einvoice/SubmitButtons";

export const dynamic = "force-dynamic";

export default async function EInvoiceMonthlyPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  if (!isOwner(await getCurrentUser())) redirect("/dashboard");
  const { month: m } = await searchParams;
  const month = m && isValidMonth(m) ? m : previousMonth();
  const p = await consolidationPreview(month);
  const history = await prisma.consolidatedInvoice.findMany({ orderBy: { month: "desc" }, take: 12 });
  const ex = p.existing;
  const live = ex?.eInvoiceUuid && !["invalid", "cancelled"].includes((ex.eInvoiceStatus || "").toLowerCase());
  const late = p.isPast && new Date() > p.deadline && !live;

  return (
    <div>
      <Header
        title="Monthly Consolidated e-Invoice"
        description="Report sales where the customer did not ask for an e-Invoice"
        actions={
          <form method="get" className="flex items-center gap-2">
            <input type="month" name="month" defaultValue={month} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
            <button className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">View</button>
          </form>
        }
      />

      <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        LHDN rule: invoices not e-Invoiced individually are reported together as one consolidated e-Invoice
        (buyer &quot;General Public&quot;) <b>within 7 days after the month ends</b>. Deadline for {month}:{" "}
        <b>{formatDate(p.deadline)}</b>. Customers who need their own e-Invoice (e.g. companies) should get it from the
        invoice page instead — those are left out here automatically.
      </div>

      {late && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          The 7-day deadline for {month} has passed. Submit as soon as possible and keep a note of the reason.
        </div>
      )}

      {ex && (
        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-semibold text-slate-900">{ex.number}</div>
              <div className="text-sm text-slate-600">
                {ex.orderCount} invoices · {formatCurrency(ex.totalAmount)} (SST {formatCurrency(ex.taxAmount)}) · LHDN status:{" "}
                <b>{ex.eInvoiceStatus || "not submitted"}</b>
              </div>
              {ex.eInvoiceUuid && <div className="text-xs text-slate-500">UUID {ex.eInvoiceUuid}{ex.eInvoiceLongId ? ` · Long ID ${ex.eInvoiceLongId}` : ""}</div>}
            </div>
            <SubmitButtons
              submitUrl="/api/einvoice/consolidated"
              submitBody={{ month }}
              idKey="consolidatedId"
              id={ex.id}
              submissionUid={ex.submissionUid}
              canSubmit={!live}
              submitLabel="Resubmit"
              confirmText={`Resubmit the consolidated e-Invoice for ${month}?`}
            />
          </div>
          {p.reported.length > 0 && (
            <div className="mt-3 text-xs text-slate-500">
              Covers: {p.reported.map((r) => r.invoiceNumber).join(", ")}
            </div>
          )}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="font-semibold text-slate-900">
            {live ? "Not yet reported for this month" : "To be reported"} · {p.totals.count} invoice(s) · {formatCurrency(p.totals.total)}
            {p.totals.tax > 0 && <span className="ml-1 text-sm font-normal text-slate-500">(SST {formatCurrency(p.totals.tax)})</span>}
          </div>
          {!live && (
            <SubmitButtons
              submitUrl="/api/einvoice/consolidated"
              submitBody={{ month }}
              idKey="consolidatedId"
              id={ex?.id}
              submissionUid={ex?.submissionUid}
              canSubmit={p.isPast && p.totals.count > 0 && !ex}
              submitLabel="Submit consolidated e-Invoice"
              confirmText={`Submit ${p.totals.count} invoice(s), total ${p.totals.total.toFixed(2)}, to LHDN as the consolidated e-Invoice for ${month}?`}
            />
          )}
        </div>
        {!p.isPast && (
          <div className="px-5 py-3 text-sm text-amber-700">This month has not ended yet — it can be submitted from the 1st of next month.</div>
        )}
        {live && p.totals.count > 0 && (
          <div className="px-5 py-3 text-sm text-amber-700">
            These were invoiced after the consolidated e-Invoice was sent. Submit them individually from each invoice page.
          </div>
        )}
        {p.waitingBuyer.length > 0 && (
          <div className="border-b border-slate-100 px-5 py-3 text-sm text-amber-800">
            <div className="font-medium">
              {p.waitingBuyer.length} invoice(s) are not in this consolidated e-Invoice: the customer sent their own details, so submit an individual e-Invoice from each invoice page.
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4">
              {p.waitingBuyer.map((w) => (
                <Link key={w.orderId} href={`/work-orders/${w.orderId}/invoice`} className="text-blue-700 hover:underline">
                  {w.invoiceNumber} ({w.customer})
                </Link>
              ))}
            </div>
          </div>
        )}
        {p.lines.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-400">Nothing outstanding for {month}.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-5 py-2.5 text-left font-medium">Invoice</th>
                <th className="px-5 py-2.5 text-left font-medium">Date</th>
                <th className="px-5 py-2.5 text-left font-medium">Customer</th>
                <th className="px-5 py-2.5 text-right font-medium">Invoice Total</th>
                <th className="px-5 py-2.5 text-right font-medium">Credit Notes</th>
                <th className="px-5 py-2.5 text-right font-medium">SST</th>
                <th className="px-5 py-2.5 text-right font-medium">Reported</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {p.lines.map((l) => (
                <tr key={l.orderId}>
                  <td className="px-5 py-2.5">
                    <Link href={`/work-orders/${l.orderId}`} className="text-blue-700 hover:underline">{l.invoiceNumber}</Link>
                  </td>
                  <td className="px-5 py-2.5">{formatDate(l.invoicedAt)}</td>
                  <td className="px-5 py-2.5">{l.customer}</td>
                  <td className="px-5 py-2.5 text-right">{formatCurrency(l.invoiceTotal)}</td>
                  <td className="px-5 py-2.5 text-right text-red-600">{l.creditedNetted > 0 ? `-${formatCurrency(l.creditedNetted)}` : "-"}</td>
                  <td className="px-5 py-2.5 text-right">{formatCurrency(l.tax)}</td>
                  <td className="px-5 py-2.5 text-right font-medium">{formatCurrency(l.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {history.length > 0 && (
        <div className="mt-6 rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4 font-semibold text-slate-900">History</div>
          <div className="divide-y divide-slate-100 text-sm">
            {history.map((h) => (
              <Link key={h.id} href={`/einvoice?month=${h.month}`} className="flex justify-between px-5 py-3 hover:bg-slate-50">
                <span>{h.month} · {h.number}</span>
                <span className="text-slate-600">{formatCurrency(h.totalAmount)} · {h.eInvoiceStatus || "not submitted"}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
