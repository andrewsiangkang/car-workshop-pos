"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PAYMENT_LABEL } from "@/lib/status";
import { formatCurrency, formatDate } from "@/lib/utils";
import { SubmitButtons } from "@/components/einvoice/SubmitButtons";
import { computeCreditNote, refundLimits, splitLeft } from "@/lib/credit-calc.mjs";
import { isLiveEInvoice, isNettedInConsolidation } from "@/lib/einvoice-state.mjs";
import { creditNoteDocType } from "@/lib/einvoice-rules.mjs";
import { isUnconfirmed, submitGate } from "@/lib/einvoice2-submit.mjs";

export type CnRow = {
  id: string;
  number: string;
  amount: number;
  taxAmount: number;
  refundAmount: number;
  reason: string;
  createdAt: string | Date;
  eInvoiceUuid: string | null;
  eInvoiceStatus: string | null;
  eInvoiceEnv?: string | null;
  /** LHDN document type sent: "02" credit note, "04" refund note. */
  eInvoiceType?: string | null;
  submissionUid: string | null;
  /** A submission's claim (being sent, unanswered, or left behind by a crash). */
  eInvoiceSubmittingAt?: string | Date | null;
  lines?: Array<{ id: string; description: string; quantity: number; returnedToStock: number }>;
};

/** LHDN document type shown next to a submitted credit note. */
const DOC_TYPE_LABEL: Record<string, string> = { "02": "LHDN type: Credit note (02)", "04": "LHDN type: Refund note (04)" };

/** An invoice line as the panel needs it (credited = quantity already credited by earlier notes). */
export type CnInvoiceLine = {
  id: string;
  type: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  linked: boolean; // PART linked to inventory: can go back into stock
  credited: number;
};

/** The invoice figures the credit is worked out from (same as the server). */
export type CnInvoice = {
  totalAmount: number;
  taxAmount: number;
  taxRate: number;
  taxScope: string;
  discount: number;
  creditedAmount: number;
  creditedTax: number;
  paidAmount: number;
  roundingAdjustment: number;
};

/** Boss-only: issue credit notes / refunds against an issued invoice, and list them. */
// 【中文】老板专用：开退款单。可以选"按发票行退"（填数量，零件可勾选放回库存）或"只退金额"（优惠/改价）；金额和 SST 预览与服务器同一套计算；开出前会再确认一次。
export function CreditNotePanel({
  orderId,
  creditable,
  paid,
  originalReported,
  individualPending = false,
  notes,
  invoice,
  lines,
}: {
  orderId: string;
  creditable: number; // invoice total − already credited
  paid: number;
  originalReported: boolean; // invoice already reported to LHDN (own or consolidated)
  /** Not reported yet, but due its own e-Invoice (buyer asked by QR / staff, or a TIN on file). */
  individualPending?: boolean;
  notes: CnRow[];
  invoice: CnInvoice;
  lines: CnInvoiceLine[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"lines" | "amount">("lines");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [restock, setRestock] = useState<Record<string, boolean>>({});
  const [amount, setAmount] = useState("");
  const [labor, setLabor] = useState("");
  const [parts, setParts] = useState("");
  const [reason, setReason] = useState("");
  const [refund, setRefund] = useState("");
  const [method, setMethod] = useState("CASH");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Labour-only SST cannot be credited pro-rata: amount-only credits are split into labour / parts.
  const splitNeeded = invoice.taxScope === "LABOR" && invoice.taxAmount > 0;
  const picks = lines
    .map((l) => ({ itemId: l.id, quantity: Number(qty[l.id]) || 0, returnToStock: !!restock[l.id] && l.linked }))
    .filter((p) => p.quantity > 0);
  const apiMode = mode === "lines" ? "lines" : splitNeeded ? "split" : "amount";
  const touched = mode === "lines" ? picks.length > 0 : splitNeeded ? !!(labor || parts) : !!amount;

  const creditedQty = Object.fromEntries(lines.map((l) => [l.id, l.credited]));
  // Labour / parts still to be credited, shown beside the split boxes (the server refuses more).
  const left = splitNeeded
    ? splitLeft({ invoice: { ...invoice, items: lines }, creditedAmount: invoice.creditedAmount, creditedTax: invoice.creditedTax, creditedQty })
    : null;

  // Same calculation as the server, so the boss sees the credit and its SST before issuing.
  // Neither helper throws on typed input: a pasted huge number shows "Amount is too large".
  const calc = computeCreditNote({
    invoice: { ...invoice, items: lines },
    creditedAmount: invoice.creditedAmount,
    creditedTax: invoice.creditedTax,
    creditedQty,
    mode: apiMode,
    lines: picks,
    split: { labor: Number(labor) || 0, parts: Number(parts) || 0 },
    amount: Number(amount) || 0,
  });
  const creditAmt = calc.ok ? calc.amount : 0;
  const limits = refundLimits({
    totalAmount: invoice.totalAmount,
    creditedAmount: invoice.creditedAmount,
    paidAmount: invoice.paidAmount,
    roundingAdjustment: invoice.roundingAdjustment,
    amount: creditAmt,
    refundAmount: Number(refund) || 0,
  });
  // Money that must go back so the customer has not paid more than the reduced bill.
  const mustRefund = calc.ok ? limits.minRefund : 0;
  // LHDN: a credit note (02) returns no money, a refund note (04) returns all of it. Part refunded
  // cannot be sent as either, which matters once the invoice is reported to LHDN on its own:
  // already, or later (the buyer asked for their own e-Invoice): such a credit note is then
  // neither sendable nor netted in the consolidated e-Invoice, and credit notes cannot be deleted.
  // 【中文】LHDN：贷项通知（02）不退钱，退款单（04）全部退回；只退一部分的不能送 LHDN。原发票已申报、或将单独开电子发票时，都要先提醒。
  const partialRefund =
    calc.ok && (originalReported || individualPending) &&
    !creditNoteDocType({ amount: calc.amount, refundAmount: Number(refund) || 0, roundingAdjustment: invoice.roundingAdjustment }).ok;

  function reset() {
    setOpen(false);
    setQty({});
    setRestock({});
    setAmount("");
    setLabor("");
    setParts("");
    setReason("");
    setRefund("");
    setError("");
  }

  async function issue() {
    const question = partialRefund
      ? "Only part of this credit note is refunded, so it cannot be sent to LHDN. Issue it anyway? It cannot be edited or deleted afterwards."
      : "Issue this credit note? It cannot be edited or deleted afterwards.";
    if (!window.confirm(question)) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/work-orders/${orderId}/credit-notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: apiMode,
          lines: apiMode === "lines" ? picks : undefined,
          split: apiMode === "split" ? { labor: Number(labor) || 0, parts: Number(parts) || 0 } : undefined,
          amount: apiMode === "amount" ? amount : undefined,
          reason,
          refundAmount: refund || 0,
          refundMethod: method,
        }),
      });
      const d = await res.json();
      if (!res.ok) setError(d.error || "Failed");
      else {
        reset();
        router.refresh();
      }
    } catch {
      setError("Failed");
    }
    setBusy(false);
  }

  const tab = (on: boolean) =>
    `rounded-lg px-3 py-1.5 text-xs font-medium ${on ? "bg-slate-800 text-white" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`;

  return (
    <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">Credit Notes &amp; Refunds</h3>
        {creditable > 0.004 && !open && (
          <button onClick={() => setOpen(true)} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50">
            Issue Credit Note
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-500">
        An issued invoice is never edited. To reduce it (price correction, returned part, goodwill) or refund money, issue a credit note.
      </p>

      {open && (
        <div className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
          {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setMode("lines")} className={tab(mode === "lines")}>Credit invoice lines</button>
            <button type="button" onClick={() => setMode("amount")} className={tab(mode === "amount")}>Amount only (goodwill / price correction)</button>
          </div>

          {mode === "lines" ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[32rem] text-sm">
                <thead className="text-xs text-slate-500">
                  <tr>
                    <th className="py-1.5 text-left font-medium">Description</th>
                    <th className="py-1.5 text-right font-medium">Qty</th>
                    <th className="py-1.5 text-right font-medium">Already credited</th>
                    <th className="py-1.5 text-right font-medium">Credit qty</th>
                    <th className="py-1.5 pl-3 text-left font-medium">Return to stock</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {lines.map((l) => {
                    const left = Math.max(0, Math.round((l.quantity - l.credited) * 1000) / 1000);
                    return (
                      <tr key={l.id}>
                        <td className="py-2">
                          <span data-no-i18n>{l.description}</span>
                          {l.type === "LABOR" && <span className="ml-2 text-xs text-slate-400">Labor</span>}
                          <div className="text-xs text-slate-400">{formatCurrency(l.total)}</div>
                        </td>
                        <td className="py-2 text-right">{l.quantity}</td>
                        <td className="py-2 text-right text-slate-500">{l.credited || "-"}</td>
                        <td className="py-2 text-right">
                          <input type="number" min="0" step="any" max={left} disabled={left <= 0} value={qty[l.id] ?? ""}
                            onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))}
                            className="w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-right text-sm disabled:bg-slate-100" />
                        </td>
                        <td className="py-2 pl-3">
                          {l.linked && l.type !== "LABOR" ? (
                            <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
                              <input type="checkbox" checked={!!restock[l.id]} disabled={left <= 0}
                                onChange={(e) => setRestock((r) => ({ ...r, [l.id]: e.target.checked }))} />
                              <span>Put back on shelf</span>
                            </label>
                          ) : (
                            <span className="text-xs text-slate-400">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : splitNeeded ? (
            <div className="space-y-2">
              <p className="text-xs text-slate-500">SST on this invoice is charged on labour only. Say how much of the credit is labour and how much is parts (before SST).</p>
              <div className="flex flex-wrap gap-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Labour amount before SST</label>
                  <input type="number" min="0" step="0.01" max={left?.labor} value={labor} onChange={(e) => setLabor(e.target.value)}
                    className="w-44 rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                  {left && (
                    <div className="mt-1 text-xs text-slate-400">
                      <span>Left to credit:</span> {formatCurrency(left.labor)}
                    </div>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Parts amount</label>
                  <input type="number" min="0" step="0.01" max={left?.parts} value={parts} onChange={(e) => setParts(e.target.value)}
                    className="w-44 rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                  {left && (
                    <div className="mt-1 text-xs text-slate-400">
                      <span>Left to credit:</span> {formatCurrency(left.parts)}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-xs text-slate-500">Credit amount incl. SST (max {creditable.toFixed(2)})</label>
              <input type="number" min="0.01" step="0.01" max={creditable} value={amount} onChange={(e) => setAmount(e.target.value)}
                className="w-44 rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </div>
          )}

          {touched && (
            calc.ok ? (
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                <span className="text-slate-500">Credit note total</span> <strong>{formatCurrency(calc.amount)}</strong>
                {calc.taxAmount > 0 && (
                  <span className="ml-2 text-xs text-slate-500">
                    <span>incl. SST</span> {formatCurrency(calc.taxAmount)}
                  </span>
                )}
              </div>
            ) : (
              <div className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">{calc.error}</div>
            )
          )}

          <div className="min-w-[16rem]">
            <label className="mb-1 block text-xs text-slate-500">Reason (printed on credit note)</label>
            <input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Brake pad returned unused"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </div>
          {paid > 0 && (
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1 block text-xs text-slate-500">
                  Refund to customer (paid {paid.toFixed(2)}{mustRefund > 0 ? `, at least ${mustRefund.toFixed(2)}` : ""})
                </label>
                <input type="number" min="0" step="0.01" max={calc.ok ? limits.maxRefund : paid} value={refund} onChange={(e) => setRefund(e.target.value)}
                  className="w-44 rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Refund method</label>
                <select value={method} onChange={(e) => setMethod(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  {Object.entries(PAYMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            </div>
          )}
          {partialRefund && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <div className="font-semibold">This credit note could not be sent to LHDN</div>
              {originalReported ? (
                <p className="mt-0.5">
                  This invoice is already reported to LHDN, so its credit notes must be sent too. LHDN has a credit note (no money back) and a refund
                  note (all of it paid back), but no document for a part refund. Issue two credit notes instead: one for the amount you refund (refund
                  it in full) and one for the rest with no refund.
                </p>
              ) : (
                <p className="mt-0.5">
                  This invoice will be reported to LHDN on its own (the customer asked for their own e-Invoice, or has a TIN on file), so its credit
                  notes must be sent too. LHDN has a credit note (no money back) and a refund note (all of it paid back), but no document for a part
                  refund. Issue two credit notes instead: one for the amount you refund (refund it in full) and one for the rest with no refund.
                </p>
              )}
            </div>
          )}
          <div className="flex gap-2">
            <button disabled={busy || !calc.ok || !reason.trim()} onClick={issue}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
              Issue Credit Note
            </button>
            <button onClick={reset} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700">Cancel</button>
          </div>
        </div>
      )}

      {notes.length > 0 && (
        <div className="mt-4 divide-y divide-slate-100 border-t border-slate-100 text-sm">
          {notes.map((n) => {
            // Shared rules (einvoice-state.mjs): a sandbox test is shown as such and never counts as reported.
            const sandbox = n.eInvoiceEnv === "sandbox";
            const live = isLiveEInvoice(n);
            const netted = isNettedInConsolidation(n);
            // Unanswered, or a claim left behind by a crash: the server refuses everything until
            // Check Status settles it, so the button must be there. 【中文】没回应或崩溃留下占位：显示「检查状态」按钮。
            const unconfirmed = isUnconfirmed(n) || submitGate(n).action === "lookup";
            // A partly refunded credit note cannot be sent (no LHDN type for it).
            const sendable = creditNoteDocType({ amount: n.amount, refundAmount: n.refundAmount, roundingAdjustment: invoice.roundingAdjustment }).ok;
            const docType = n.eInvoiceUuid && n.eInvoiceType ? DOC_TYPE_LABEL[n.eInvoiceType] : null;
            const label =
              netted ? "Netted in monthly consolidated e-Invoice"
              : unconfirmed ? "LHDN did not answer the last submission. Press Check Status."
              : live ? `LHDN: ${n.eInvoiceStatus}`
              : sandbox && n.eInvoiceUuid ? `LHDN sandbox test: ${n.eInvoiceStatus}`
              : originalReported && !sendable ? "Cannot be sent to LHDN: only part of it was refunded"
              : originalReported ? "Not yet submitted to LHDN"
              : individualPending && !sendable ? "Only part refunded: cannot be sent to LHDN once the invoice has its own e-Invoice"
              : "Will be netted in this month's consolidated e-Invoice (or submit invoice e-Invoice first)";
            return (
              <div key={n.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <Link href={`/work-orders/${orderId}/credit-notes/${n.id}`} className="font-medium text-blue-700 hover:underline">{n.number}</Link>
                  <span className="ml-2 text-slate-500">{formatDate(n.createdAt)} · {n.reason}</span>
                  <div className="text-xs text-slate-500">
                    -{formatCurrency(n.amount)}{n.taxAmount > 0 ? ` (SST ${formatCurrency(n.taxAmount)})` : ""}
                    {n.refundAmount > 0 ? ` · refunded ${formatCurrency(n.refundAmount)}` : ""} · <span>{label}</span>
                    {docType && (
                      <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">{docType}</span>
                    )}
                  </div>
                  {n.lines && n.lines.length > 0 && (
                    <div className="text-xs text-slate-400" data-no-i18n>
                      {n.lines.map((l) => `${l.description} × ${l.quantity}${l.returnedToStock > 0 ? " ↩" : ""}`).join(" · ")}
                    </div>
                  )}
                </div>
                <SubmitButtons
                  submitUrl={`/api/credit-notes/${n.id}/einvoice`}
                  idKey="creditNoteId"
                  id={n.id}
                  submissionUid={n.submissionUid}
                  uuid={n.eInvoiceUuid}
                  canSubmit={originalReported && !live && !netted && sendable}
                  unconfirmed={unconfirmed}
                  confirmText={`Submit credit note ${n.number} to LHDN MyInvois?`}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
