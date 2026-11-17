import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { requirePageOwner } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatDate } from "@/lib/utils";
import { consolidationPreview, isValidMonth, previousMonth, waitingBuyerRequests } from "@/lib/consolidation";
import { isLiveEInvoice, isReportedFor, PRODUCTION } from "@/lib/einvoice-state.mjs";
import { BUYER_REQUEST_ALERT_DAYS } from "@/lib/einvoice-rules.mjs";
import { isUnconfirmed, submitGate } from "@/lib/einvoice2-submit.mjs";
import { SubmitButtons } from "@/components/einvoice/SubmitButtons";
import { RecordPortalConsolidated } from "@/components/einvoice/RecordPortalConsolidated";

export const dynamic = "force-dynamic";

export default async function EInvoiceMonthlyPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  await requirePageOwner();
  const { month: m } = await searchParams;
  const month = m && isValidMonth(m) ? m : previousMonth();
  const p = await consolidationPreview(month);
  const history = await prisma.consolidatedInvoice.findMany({ orderBy: { month: "desc" }, take: 12 });
  // Buyer requests (any month) still without their own e-Invoice after 3 days (review H4).
  const waiting = await waitingBuyerRequests(p.env);
  // The number is every waiting request; the list shows the oldest 50.
  const waitingCount = `${waiting.total}${waiting.more ? "+" : ""}`;
  const ex = p.existing;
  // A real consolidated e-Invoice, or (while testing) a sandbox one, blocks another submission.
  const live = isReportedFor(ex, p.env);
  // A submission is running, or LHDN did not answer the last one (it may have arrived).
  // A claim left behind by a crash counts too: only Check Status settles it.
  const exUnconfirmed = !!ex && (isUnconfirmed(ex) || submitGate(ex).action === "lookup");
  const exSending = !!ex && !exUnconfirmed && submitGate(ex).action === "wait";
  const late = p.isPast && new Date() > p.deadline && !live;
  // A consolidated e-Invoice submitted in the MyInvois portal is a real (production) one. It can
  // be recorded only while Settings are on Production: then the table, totals and warnings on
  // this page are the production list, exactly what gets linked. On sandbox the list differs
  // (invoices with only a sandbox e-Invoice are left out, a sandbox test hides the warnings), so
  // the boss is asked to switch instead of recording against a list that is not shown.
  // 【中文】网站提交的合并发票是正式的：只有设置在正式环境时才可登记，这样页面上的清单、金额和提醒就是要链接的那一份。
  const recordable = p.isPast && !isLiveEInvoice(ex);
  // An invoice of the month whose own e-Invoice (or a credit note's) is being sent or got no answer
  // from LHDN may already be at LHDN: nothing can be sent or recorded until Check Status settles it.
  // 【中文】该月有发票（或退款单）自己正在送或在等 LHDN 回应：可能已在 LHDN，先「检查状态」，否则不能提交或登记。
  const blocked = p.blocked.length > 0;
  const canRecord = recordable && p.env === PRODUCTION && p.reportable.length > 0 && !blocked;
  const recordNeedsProduction =
    recordable && p.env !== PRODUCTION && (await consolidationPreview(month, PRODUCTION)).reportable.length > 0;
  const individualIncluded = p.individualDue.filter((d) => d.included).length;

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
        invoice page instead — they are listed below. Once the month has ended, any still without one are included here
        so the sale is still reported.
      </div>

      {waiting.total > 0 && (
        <div className="mb-6 rounded-xl border-2 border-red-300 bg-red-50 p-4 text-sm text-red-900">
          <div className="font-semibold">
            {`Customers waiting for their own e-Invoice for more than ${BUYER_REQUEST_ALERT_DAYS} days: ${waitingCount}`}
          </div>
          <p className="mt-1">
            These customers asked for their own e-Invoice (QR form or staff), but it has not been issued yet. Issue it from each
            invoice page before the deadline. After the deadline the sale is reported in the monthly consolidated e-Invoice as
            General Public instead.
          </p>
          <ul className="mt-2 space-y-1">
            {waiting.list.map((w) => (
              <li key={w.orderId} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Link href={`/work-orders/${w.orderId}/invoice`} className="font-medium text-blue-700 hover:underline">
                  {w.invoiceNumber}
                </Link>
                <span data-no-i18n>{w.customer}</span>
                <span>{formatCurrency(w.total)}</span>
                <span className="text-xs">
                  <span>Asked on</span> {formatDate(w.requestedAt)}
                </span>
                {w.deadline && (
                  <span className="text-xs">
                    <span>Issue by</span> {formatDate(w.deadline)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {blocked && !live && (
        <div className="mb-6 rounded-xl border-2 border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="font-semibold">Waiting for LHDN&apos;s answer on these invoices</div>
          <p className="mt-1">
            Their own e-Invoice (or a credit note) is being sent to LHDN or got no answer yet, so it may already be at LHDN. Open each one and press
            Check Status. The consolidated e-Invoice for this month can be sent once LHDN has answered, so no sale is reported twice.
          </p>
          <ul className="mt-2 space-y-1">
            {p.blocked.map((b) => (
              <li key={b.orderId} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Link href={`/work-orders/${b.orderId}${b.creditNote ? "" : "/invoice"}`} className="font-medium text-blue-700 hover:underline">
                  {b.invoiceNumber}
                </Link>
                {b.creditNote && <span className="text-xs" data-no-i18n>{b.creditNote}</span>}
                <span data-no-i18n>{b.customer}</span>
                <span>{formatCurrency(b.total)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

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
                {ex.eInvoiceEnv === "sandbox" && <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-700">sandbox test</span>}
              </div>
              {ex.eInvoiceUuid && <div className="text-xs text-slate-500">UUID {ex.eInvoiceUuid}{ex.eInvoiceLongId ? ` · Long ID ${ex.eInvoiceLongId}` : ""}</div>}
              {exUnconfirmed && (
                <div className="mt-1 text-xs font-medium text-amber-700">
                  LHDN did not answer the last submission. It may still have arrived, so do not submit again yet: press Check Status.
                </div>
              )}
              {exSending && <div className="mt-1 text-xs font-medium text-amber-700">Being sent to LHDN now. Wait a minute, then press Check Status.</div>}
            </div>
            <SubmitButtons
              submitUrl="/api/einvoice/consolidated"
              submitBody={{ month }}
              idKey="consolidatedId"
              id={ex.id}
              submissionUid={ex.submissionUid}
              uuid={ex.eInvoiceUuid}
              canSubmit={!live && !exSending && !blocked}
              unconfirmed={exUnconfirmed}
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

      {!live && p.individualDue.length > 0 && (
        <div className="mb-6 rounded-xl border-2 border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="font-semibold">
            {p.isPast
              ? "These customers asked for their own e-Invoice (or have a TIN on file). Issue it now from each invoice page — otherwise they will be included in this consolidated e-Invoice as General Public."
              : "These customers should get their own e-Invoice (they asked by QR, or have a TIN on file). Issue it from each invoice page; any still without one when the month ends will be included in the consolidated e-Invoice."}
          </div>
          <ul className="mt-2 space-y-1">
            {p.individualDue.map((w) => (
              <li key={w.orderId} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Link href={`/work-orders/${w.orderId}/invoice`} className="font-medium text-blue-700 hover:underline">
                  {w.invoiceNumber}
                </Link>
                <span>{w.customer}</span>
                <span>{formatCurrency(w.total)}</span>
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs">
                  {w.reason === "buyer_request" ? "Asked by QR" : "TIN on file"}
                </span>
                {w.included && (
                  <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">In this consolidated e-Invoice</span>
                )}
              </li>
            ))}
          </ul>
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
              uuid={ex?.eInvoiceUuid}
              canSubmit={p.isPast && p.totals.count > 0 && !ex && !blocked}
              submitLabel="Submit consolidated e-Invoice"
              confirmText={
                `Submit ${p.totals.count} invoice(s), total ${p.totals.total.toFixed(2)}, to LHDN as the consolidated e-Invoice for ${month}?` +
                (individualIncluded > 0
                  ? ` ${individualIncluded} of them should have had their own e-Invoice and will be reported as General Public.`
                  : "")
              }
            />
          )}
        </div>
        {!p.isPast && (
          <div className="px-5 py-3 text-sm text-amber-700">This month has not ended yet — it can be submitted from the 1st of next month.</div>
        )}
        {!live && p.totals.count > 250 && (
          <div className="px-5 py-3 text-sm text-slate-600">
            LHDN accepts at most 300 KB per document. From about 300 invoices a month, the consolidated e-Invoice sent from here
            lists continuous ranges of invoice numbers (for example INV20261001001 - INV20261031045) instead of one line per invoice.
            The totals are the same to the sen.
          </div>
        )}
        {live && p.totals.count > 0 && (
          <div className="px-5 py-3 text-sm text-amber-700">
            These were invoiced after the consolidated e-Invoice was sent. Submit them individually from each invoice page.
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
                  <td className="px-5 py-2.5">
                    {l.customer}
                    {l.individual && (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">Should get own e-Invoice</span>
                    )}
                  </td>
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

      {canRecord && (
        <RecordPortalConsolidated
          month={month}
          orderIds={p.lines.map((l) => l.orderId)}
          creditNoteIds={p.lines.flatMap((l) => l.creditNoteIds)}
          count={p.totals.count}
          total={p.totals.total}
          defaultNumber={ex?.number || `CON-${month.replace("-", "")}`}
        />
      )}
      {recordNeedsProduction && (
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
          <div className="font-semibold text-slate-900">Submitted in the MyInvois portal?</div>
          <p className="mt-1">
            Settings are on Sandbox, so the list above is the sandbox test list and can differ from the real one. To record
            a consolidated e-Invoice submitted in the MyInvois portal, untick &quot;Use Sandbox (preprod) environment&quot; in
            Settings → Tax / e-Invoice, then open this page again.
          </p>
        </div>
      )}

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
