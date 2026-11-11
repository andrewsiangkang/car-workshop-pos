"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PAYMENT_LABEL } from "@/lib/status";
import { formatCurrency, formatDate } from "@/lib/utils";
import { SubmitButtons } from "@/components/einvoice/SubmitButtons";

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
  submissionUid: string | null;
};

/** Boss-only: issue credit notes / refunds against an issued invoice, and list them. */
export function CreditNotePanel({
  orderId,
  creditable,
  paid,
  balanceDue,
  originalReported,
  notes,
}: {
  orderId: string;
  creditable: number; // invoice total − already credited
  paid: number;
  balanceDue: number;
  originalReported: boolean; // invoice already reported to LHDN (own or consolidated)
  notes: CnRow[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [refund, setRefund] = useState("");
  const [method, setMethod] = useState("CASH");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const amt = Number(amount) || 0;
  // Money that must go back so the customer has not paid more than the reduced bill.
  const mustRefund = Math.max(0, Math.round((paid - (balanceDue + paid - amt)) * 100) / 100);

  async function issue() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/work-orders/${orderId}/credit-notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, reason, refundAmount: refund || 0, refundMethod: method }),
      });
      const d = await res.json();
      if (!res.ok) setError(d.error || "Failed");
      else {
        setOpen(false);
        setAmount("");
        setReason("");
        setRefund("");
        router.refresh();
      }
    } catch {
      setError("Failed");
    }
    setBusy(false);
  }

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
          <div className="flex flex-wrap gap-3">
            <div>
              <label className="mb-1 block text-xs text-slate-500">Credit amount incl. SST (max {creditable.toFixed(2)})</label>
              <input type="number" min="0.01" step="0.01" max={creditable} value={amount} onChange={(e) => setAmount(e.target.value)}
                className="w-44 rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div className="min-w-[16rem] flex-1">
              <label className="mb-1 block text-xs text-slate-500">Reason (printed on credit note)</label>
              <input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Brake pad returned unused"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </div>
          </div>
          {paid > 0 && (
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1 block text-xs text-slate-500">
                  Refund to customer (paid {paid.toFixed(2)}{mustRefund > 0 ? `, at least ${mustRefund.toFixed(2)}` : ""})
                </label>
                <input type="number" min="0" step="0.01" max={Math.min(paid, amt || paid)} value={refund} onChange={(e) => setRefund(e.target.value)}
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
          <div className="flex gap-2">
            <button disabled={busy || !amt || !reason.trim()} onClick={issue}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
              Issue Credit Note
            </button>
            <button onClick={() => setOpen(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700">Cancel</button>
          </div>
        </div>
      )}

      {notes.length > 0 && (
        <div className="mt-4 divide-y divide-slate-100 border-t border-slate-100 text-sm">
          {notes.map((n) => {
            const st = (n.eInvoiceStatus || "").toLowerCase();
            const live = n.eInvoiceUuid && !["invalid", "cancelled"].includes(st);
            const label =
              st === "consolidated" ? "Netted in monthly consolidated e-Invoice"
              : live ? `LHDN: ${n.eInvoiceStatus}`
              : originalReported ? "Not yet submitted to LHDN"
              : "Will be netted in this month's consolidated e-Invoice (or submit invoice e-Invoice first)";
            return (
              <div key={n.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <Link href={`/work-orders/${orderId}/credit-notes/${n.id}`} className="font-medium text-blue-700 hover:underline">{n.number}</Link>
                  <span className="ml-2 text-slate-500">{formatDate(n.createdAt)} · {n.reason}</span>
                  <div className="text-xs text-slate-500">
                    -{formatCurrency(n.amount)}{n.taxAmount > 0 ? ` (SST ${formatCurrency(n.taxAmount)})` : ""}
                    {n.refundAmount > 0 ? ` · refunded ${formatCurrency(n.refundAmount)}` : ""} · {label}
                  </div>
                </div>
                <SubmitButtons
                  submitUrl={`/api/credit-notes/${n.id}/einvoice`}
                  idKey="creditNoteId"
                  id={n.id}
                  submissionUid={n.submissionUid}
                  canSubmit={originalReported && !live && st !== "consolidated"}
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
