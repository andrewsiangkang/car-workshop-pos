"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PAYMENT_LABEL } from "@/lib/status";
import { formatCurrency } from "@/lib/utils";
import { cleanMoneyInput } from "@/lib/money-input";

const btn =
  "rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50";

export function OrderActions({
  id,
  status,
  hasInvoice,
  remaining,
  counterOpen,
}: {
  id: string;
  status: string;
  hasInvoice: boolean;
  remaining: number;
  counterOpen: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [amount, setAmount] = useState(remaining > 0 ? remaining.toFixed(2) : "");
  const [method, setMethod] = useState("CASH");
  const [reference, setReference] = useState("");
  // Cash received from the customer. Until the cashier types something it simply equals the amount (exact money).
  const [received, setReceived] = useState("");
  const [receivedTouched, setReceivedTouched] = useState(false);
  const [notice, setNotice] = useState<{ change: number } | null>(null);

  // After a part-payment the balance changes: refill the amount with what is still owed.
  useEffect(() => {
    setAmount(remaining > 0 ? remaining.toFixed(2) : "");
  }, [remaining]);

  async function call(payload: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setError("");
    setNotice(null);
    let ok = false;
    try {
      const res = await fetch(`/api/work-orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || "Operation failed");
      else {
        ok = true;
        router.refresh();
      }
    } catch {
      setError("Operation failed");
    }
    setBusy(false);
    return ok;
  }

  const amountNum = Number(amount) || 0;
  const isCash = method === "CASH";
  const receivedNum = receivedTouched ? Number(received) || 0 : amountNum;
  const change = Math.round((receivedNum - amountNum) * 100) / 100; // negative = customer has not given enough
  const canPay = counterOpen && amountNum > 0 && (!isCash || change >= 0);

  async function recordPayment() {
    const cashChange = isCash && change > 0 ? change : 0;
    const ok = await call({
      action: "record_payment",
      amount,
      method,
      reference,
      tendered: isCash ? receivedNum : undefined,
    });
    if (ok) {
      setNotice({ change: cashChange });
      setReceived("");
      setReceivedTouched(false);
    }
  }

  const closed = status === "CANCELLED";

  return (
    <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">Progress & Payment</h3>
      {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {notice && (
        <div className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <span>Payment recorded.</span>
          {notice.change > 0 && (
            <span className="ml-2 text-base font-bold">
              <span>Give change:</span> {formatCurrency(notice.change)}
            </span>
          )}
        </div>
      )}
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
        <div className="mt-4 border-t border-slate-100 pt-4">
          {!counterOpen && (
            <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <span>The counter is closed. Open the counter before taking payment.</span>{" "}
              <Link href="/counter" className="font-semibold underline">
                Open Counter
              </Link>
            </div>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs text-slate-500">Amount (RM) · Balance {remaining.toFixed(2)}</label>
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                onChange={(e) => setAmount(cleanMoneyInput(e.target.value))}
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
            {isCash && (
              <div>
                <label className="mb-1 block text-xs text-slate-500">Cash Received (RM)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={receivedTouched ? received : amount}
                  onChange={(e) => {
                    setReceived(cleanMoneyInput(e.target.value));
                    setReceivedTouched(true);
                  }}
                  className="w-40 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                />
              </div>
            )}
            <button disabled={busy || !canPay} onClick={recordPayment} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>
              Record Payment
            </button>
          </div>
          {isCash && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setReceivedTouched(false)} className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50">
                Exact
              </button>
              {[10, 20, 50, 100].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => {
                    setReceived(String(n));
                    setReceivedTouched(true);
                  }}
                  className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
                >
                  {n}
                </button>
              ))}
              <div className={`ml-auto rounded-lg px-4 py-2 text-sm font-semibold ${change < 0 ? "bg-red-50 text-red-700" : "bg-slate-50 text-slate-800"}`}>
                {change < 0 ? (
                  <>
                    <span>Short by</span> {formatCurrency(-change)}
                  </>
                ) : (
                  <>
                    <span>Change to give back</span> {formatCurrency(change)}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      {hasInvoice && remaining <= 0.0001 && (
        <div className="mt-3 text-sm font-medium text-emerald-700">✓ Fully Paid</div>
      )}
    </div>
  );
}
