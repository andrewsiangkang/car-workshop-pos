"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PAYMENT_LABEL } from "@/lib/status";
import { formatCurrency } from "@/lib/utils";
import { cleanMoneyInput } from "@/lib/money-input";

const btn =
  "rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50";

const toCents = (value: string | number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round((parsed + Number.EPSILON) * 100) : 0;
};
const fromCents = (value: number) => value / 100;

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
  const [splits, setSplits] = useState([{ method: "CASH", amount: remaining > 0 ? remaining.toFixed(2) : "", reference: "", tendered: "" }]);
  const [notice, setNotice] = useState<{ change: number } | null>(null);
  const [stockWarnings, setStockWarnings] = useState<string[]>([]);

  // After a payment the remaining balance becomes the default for a fresh split-payment entry.
  useEffect(() => {
    setSplits([{ method: "CASH", amount: remaining > 0 ? remaining.toFixed(2) : "", reference: "", tendered: "" }]);
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
        if (payload.action === "generate_invoice") {
          setStockWarnings(Array.isArray(data.stockWarnings)
            ? data.stockWarnings.filter((warning: unknown): warning is string => typeof warning === "string")
            : []);
        }
        ok = true;
        router.refresh();
      }
    } catch {
      setError("Operation failed");
    }
    setBusy(false);
    return ok;
  }

  // Compare all payment values in integer sen to avoid Float errors such as
  // RM63.73 being treated as RM63.729999 and incorrectly rejected.
  const remainingCents = toCents(remaining);
  const splitTotalCents = splits.reduce((sum, row) => sum + toCents(row.amount), 0);
  const splitChangeCents = splits.reduce((sum, row) => {
    if (row.method !== "CASH") return sum;
    const amountCents = toCents(row.amount);
    const tenderedCents = row.tendered.trim() ? toCents(row.tendered) : amountCents;
    return sum + Math.max(0, tenderedCents - amountCents);
  }, 0);
  const splitTotal = fromCents(splitTotalCents);
  const splitChange = fromCents(splitChangeCents);
  const canPay = counterOpen && splits.length > 0 &&
    splits.every((row) => toCents(row.amount) > 0 &&
      (row.method !== "CASH" || toCents(row.tendered.trim() ? row.tendered : row.amount) >= toCents(row.amount))) &&
    splitTotalCents > 0 && splitTotalCents <= remainingCents;

  async function recordPayment() {
    const ok = await call({
      action: "record_payment",
      payments: splits.map((row) => ({
        amount: row.amount,
        method: row.method,
        reference: row.reference,
        tendered: row.method === "CASH" ? (row.tendered.trim() ? row.tendered : row.amount) : undefined,
      })),
    });
    if (ok) setNotice({ change: splitChange });
  }

  const closed = status === "CANCELLED";

  return (
    <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">Progress & Payment</h3>
      {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {stockWarnings.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <div className="font-semibold">库存不足 / Stock short while completing</div>
          <ul className="mt-1 list-disc pl-5 text-xs">
            {stockWarnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
          <div className="mt-1 text-xs text-amber-800">Invoice was still generated. Restock or adjust the job if needed.</div>
        </div>
      )}
      {notice && (
        <div className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <span>Payment recorded.</span>
          {notice.change > 0 && (
            <span className="ml-2 text-base font-bold">
              <span>Change to return to customer:</span> {formatCurrency(notice.change)}
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
          <div className="space-y-3">
            {splits.map((row, index) => (
              <div key={index} className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 p-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Payment Method</label>
                  <select value={row.method} onChange={(e) => setSplits((all) => all.map((r, i) => i === index ? { ...r, method: e.target.value } : r))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    {Object.entries(PAYMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Amount (RM)</label>
                  <input type="text" inputMode="decimal" value={row.amount} onChange={(e) => setSplits((all) => all.map((r, i) => i === index ? { ...r, amount: cleanMoneyInput(e.target.value) } : r))} className="w-36 rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                </div>
                {(row.method === "TNG" || row.method === "TRANSFER") && <div>
                  <label className="mb-1 block text-xs text-slate-500">Reference / Transaction ID</label>
                  <input value={row.reference} onChange={(e) => setSplits((all) => all.map((r, i) => i === index ? { ...r, reference: e.target.value } : r))} placeholder="Reference" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                </div>}
                {row.method === "CASH" && <div>
                  <label className="mb-1 block text-xs text-slate-500">Cash Received (RM)</label>
                  <input type="text" inputMode="decimal" value={row.tendered || row.amount} onChange={(e) => setSplits((all) => all.map((r, i) => i === index ? { ...r, tendered: cleanMoneyInput(e.target.value) } : r))} className="w-36 rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                </div>}
                {splits.length > 1 && <button type="button" onClick={() => setSplits((all) => all.filter((_, i) => i !== index))} className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600">Remove</button>}
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button type="button" onClick={() => setSplits((all) => [...all, { method: "CASH", amount: "", reference: "", tendered: "" }])} className="rounded-lg border border-blue-200 px-3 py-2 text-sm text-blue-700">+ Add payment method</button>
              <div className="text-right text-sm">
                <div>Payment applied: <strong>{formatCurrency(splitTotal)}</strong> / Balance {formatCurrency(fromCents(remainingCents))}</div>
                <div className={splitTotalCents > remainingCents ? "text-red-600" : splitChangeCents > 0 ? "font-semibold text-emerald-700" : "text-slate-500"}>
                  {splitTotalCents > remainingCents ? "Payment amount exceeds balance" : splitChangeCents > 0 ? `Change to return to customer: ${formatCurrency(splitChange)}` : "No change due"}
                </div>
              </div>
              <button disabled={busy || !canPay} onClick={recordPayment} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>Record Split Payment</button>
            </div>
          </div>
        </div>
      )}
      {hasInvoice && remaining <= 0.0001 && (
        <div className="mt-3 text-sm font-medium text-emerald-700">✓ Fully Paid</div>
      )}
    </div>
  );
}
