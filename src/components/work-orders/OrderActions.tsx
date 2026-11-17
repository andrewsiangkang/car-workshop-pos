"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PAYMENT_LABEL } from "@/lib/status";
import { formatCurrency } from "@/lib/utils";
import { cleanMoneyInput } from "@/lib/money-input";
import { planCashRounding } from "@/lib/money-payment.mjs";
import { isSaneAmount } from "@/lib/credit-calc.mjs";
import { toCents as coreToCents } from "@/lib/money-core.mjs";

const btn =
  "rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50";

// Typed boxes: blank / not a number / absurdly long = 0 sen (never throws while typing).
const toCents = (value: string | number) => (isSaneAmount(value) ? coreToCents(Number(value)) : 0);
const fromCents = (value: number) => value / 100;

/** A part the server could not fully take off stock when invoicing (409 STOCK_SHORT). */
type ShortItem = { inventoryItemId: string; name: string; sku: string | null; needed: number; onHand: number; short: number };
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
  // Parts short when invoicing: shown with an "Invoice anyway" choice instead of an error.
  const [stockShort, setStockShort] = useState<ShortItem[]>([]);

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
      if (res.status === 409 && data.code === "STOCK_SHORT" && payload.action === "generate_invoice") {
        setStockShort(Array.isArray(data.items) ? data.items : []);
      } else if (!res.ok) setError(data.error || "Operation failed");
      else {
        if (payload.action === "generate_invoice") {
          setStockShort([]);
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
  // 5-sen rounding applies to the CASH part only, and only when this payment settles the balance
  // (same rule as the server: money-payment.mjs). Card / TNG / transfer are charged to the exact sen.
  // 【中文】5 仙进位只适用于现金部分，而且要付清余额才进位（与服务器同一规则）；刷卡 / TNG / 转账按实际金额。
  const plan = planCashRounding({
    remainingCents,
    rows: splits.map((row) => ({ method: row.method, amountCents: toCents(row.amount) })),
  });
  const roundingAdjustmentCents = plan.ok ? plan.adjustmentCents : 0;
  const roundedRow = plan.ok ? plan.roundedRow : -1;
  // Amount of each row after rounding (only the rounded cash row changes).
  const rowCents = (index: number) => (roundedRow === index ? plan.amounts[index] : toCents(splits[index]?.amount ?? 0));
  // Blank "cash received" = exact money (the rounded amount).
  const tenderedCents = (index: number) => {
    const row = splits[index];
    return row.tendered.trim() ? toCents(row.tendered) : rowCents(index);
  };
  const splitChangeCents = splits.reduce((sum, row, index) => {
    if (row.method !== "CASH") return sum;
    return sum + Math.max(0, tenderedCents(index) - rowCents(index));
  }, 0);
  const splitTotal = fromCents(splitTotalCents);
  const settlesBalance = plan.settles;
  const hasCash = plan.cashCents > 0;
  const roundedCashCents = plan.cashCents + roundingAdjustmentCents;
  const splitChange = fromCents(splitChangeCents);
  const canPay = counterOpen && splits.length > 0 && plan.ok &&
    splits.every((row, index) => toCents(row.amount) > 0 &&
      (row.method !== "CASH" || tenderedCents(index) >= rowCents(index))) &&
    splitTotalCents > 0 && splitTotalCents <= remainingCents;

  async function recordPayment() {
    const ok = await call({
      action: "record_payment",
      // The server works the cash rounding out itself (cash part only, on full settlement).
      roundingMode: "AUTO",
      payments: splits.map((row) => ({
        amount: row.amount,
        method: row.method,
        reference: row.reference,
        // Blank = exact money: the server then uses the (rounded) cash amount.
        tendered: row.method === "CASH" && row.tendered.trim() ? row.tendered : undefined,
      })),
    });
    if (ok) setNotice({ change: splitChange });
  }

  const closed = status === "CANCELLED";

  return (
    <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">Progress & Payment</h3>
      {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {stockShort.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <div className="font-semibold">Not enough stock for some parts on this job</div>
          <ul className="mt-1 list-disc pl-5 text-xs">
            {stockShort.map((it) => (
              <li key={it.inventoryItemId}>
                <span data-no-i18n>{it.name}{it.sku ? ` (${it.sku})` : ""}</span>
                {" · "}<span>Needed</span> {it.needed} · <span>On hand</span> {it.onHand} · <span>Short</span> {it.short}
              </li>
            ))}
          </ul>
          <div className="mt-1 text-xs text-amber-800">
            Restock first, or issue the invoice anyway: the missing parts are recorded as owed and stock on hand goes below zero until the next stock-in.
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              disabled={busy}
              onClick={() => call({ action: "generate_invoice", allowNegativeStock: true })}
              className={`${btn} bg-amber-600 text-white hover:bg-amber-700`}
            >
              Invoice anyway
            </button>
            <button disabled={busy} onClick={() => setStockShort([])} className={`${btn} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {stockWarnings.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <div className="font-semibold">Invoiced with parts owed (stock went below zero)</div>
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
                  <input type="text" inputMode="decimal" value={row.tendered} placeholder={fromCents(rowCents(index)).toFixed(2)} onChange={(e) => setSplits((all) => all.map((r, i) => i === index ? { ...r, tendered: cleanMoneyInput(e.target.value) } : r))} className="w-36 rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                </div>}
                {splits.length > 1 && <button type="button" onClick={() => setSplits((all) => all.filter((_, i) => i !== index))} className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600">Remove</button>}
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button type="button" onClick={() => setSplits((all) => [...all, { method: "CASH", amount: "", reference: "", tendered: "" }])} className="rounded-lg border border-blue-200 px-3 py-2 text-sm text-blue-700">+ Add payment method</button>
              <div className="text-right text-sm">
                <div>Payment applied: <strong>{formatCurrency(splitTotal)}</strong> / Balance {formatCurrency(fromCents(remainingCents))}</div>
                <div className={splitTotalCents > remainingCents ? "text-red-600" : splitChangeCents > 0 ? "font-semibold text-emerald-700" : "text-slate-500"}>
                  {splitTotalCents > remainingCents ? (
                    "Payment amount exceeds balance"
                  ) : splitChangeCents > 0 ? (
                    <>
                      <span>Change to return to customer:</span> {formatCurrency(splitChange)}
                    </>
                  ) : (
                    "No change due"
                  )}
                </div>
                {!plan.ok && splitTotalCents <= remainingCents && plan.error && (
                  <div className="mt-1 text-xs text-red-600">{plan.error}</div>
                )}
                {settlesBalance && hasCash && roundingAdjustmentCents !== 0 && (
                  <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-left">
                    <div className="mb-2 font-medium text-slate-700">Cash Rounding (nearest RM0.05)</div>
                    <div className="text-xs text-slate-600">Malaysia 5-sen rounding (BNM table) applies to the cash part only.</div>
                    <div className="mt-2 text-xs text-slate-600">
                      <span>Cash part:</span> <strong>{formatCurrency(fromCents(plan.cashCents))}</strong> ·{" "}
                      <span>Rounding Adjustment:</span> <strong>{formatCurrency(fromCents(roundingAdjustmentCents))}</strong> ·{" "}
                      <span>Cash to collect:</span> <strong>{formatCurrency(fromCents(roundedCashCents))}</strong>
                    </div>
                  </div>
                )}
                {!(settlesBalance && hasCash) && (
                  <div className="text-xs text-slate-500">Cash rounding applies only to the cash part, when this payment settles the full balance. Card, Touch &apos;n Go and transfer are charged to the exact sen.</div>
                )}
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
