"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PAYMENT_LABEL } from "@/lib/status";

const btn =
  "rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50";

export function OrderActions({
  id,
  status,
  hasInvoice,
  remaining,
}: {
  id: string;
  status: string;
  hasInvoice: boolean;
  remaining: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [amount, setAmount] = useState(remaining > 0 ? remaining.toFixed(2) : "");
  const [method, setMethod] = useState("CASH");
  const [reference, setReference] = useState("");

  async function call(payload: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/work-orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || "Operation failed");
      else router.refresh();
    } catch {
      setError("Operation failed");
    }
    setBusy(false);
  }

  const closed = status === "CANCELLED";

  return (
    <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">Progress & Payment</h3>
      {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <div className="flex flex-wrap gap-2">
        {!closed && !hasInvoice && status !== "CONFIRMED" && status !== "IN_PROGRESS" && (
          <button disabled={busy} onClick={() => call({ action: "update_status", status: "CONFIRMED" })} className={`${btn} bg-blue-700 text-white hover:bg-blue-800`}>
            Customer Confirmed Quote
          </button>
        )}
        {!closed && !hasInvoice && status === "CONFIRMED" && (
          <button disabled={busy} onClick={() => call({ action: "update_status", status: "IN_PROGRESS" })} className={`${btn} bg-indigo-600 text-white hover:bg-indigo-700`}>
            Start Work
          </button>
        )}
        {!closed && !hasInvoice && (
          <button
            disabled={busy}
            onClick={() => {
              if (window.confirm("Generate invoice now? This will mark the work as completed.")) call({ action: "generate_invoice" });
            }}
            className={`${btn} bg-violet-600 text-white hover:bg-violet-700`}
          >
            Complete & Generate Invoice
          </button>
        )}
        {!closed && !hasInvoice && (
          <button
            disabled={busy}
            onClick={() => {
              if (window.confirm("Cancel this work order?")) call({ action: "update_status", status: "CANCELLED" });
            }}
            className={`${btn} border border-red-200 text-red-600 hover:bg-red-50`}
          >
            Cancel Order
          </button>
        )}
      </div>

      {hasInvoice && remaining > 0.0001 && (
        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
          <div>
            <label className="mb-1 block text-xs text-slate-500">Amount (RM) · Balance {remaining.toFixed(2)}</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              max={remaining}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-40 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">Payment Method</label>
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none">
              {Object.entries(PAYMENT_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            {(method === "TNG" || method === "TRANSFER") && (
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Reference / Transaction ID"
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none"
              />
            )}
          </div>
          <button disabled={busy} onClick={() => call({ action: "record_payment", amount, method, reference })} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>
            Record Payment
          </button>
        </div>
      )}
      {hasInvoice && remaining <= 0.0001 && (
        <div className="mt-3 text-sm font-medium text-emerald-700">✓ Fully Paid</div>
      )}
    </div>
  );
}
