"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { PAYMENT_LABEL } from "@/lib/status";
import { varianceKind, varianceOf, type ShiftSummary, type VarianceKind } from "@/lib/counter-calc";

export type OpenShift = {
  id: string;
  openedAt: string;
  openedByName: string;
  openingFloat: number;
  staleDay: boolean; // opened on an earlier day than today
};

const input =
  "w-48 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500";
const btn = "rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50";

const KIND_STYLE: Record<VarianceKind, string> = {
  short: "bg-red-50 text-red-700",
  over: "bg-amber-50 text-amber-800",
  balanced: "bg-emerald-50 text-emerald-700",
};

/** "SHORT RM 5.00" / "OVER RM 2.00" / "Balanced" */
export function VarianceText({ kind, amount }: { kind: VarianceKind; amount: number }) {
  if (kind === "balanced") return <span>Balanced</span>;
  return (
    <>
      <span>{kind === "short" ? "SHORT" : "OVER"}</span> {formatCurrency(Math.abs(amount))}
    </>
  );
}

type CounterResult = { id: string; variance?: number };

export function CounterPanel({
  isOwner,
  open,
  summary,
}: {
  isOwner: boolean;
  open: OpenShift | null;
  summary: ShiftSummary | null; // boss only
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [floatIn, setFloatIn] = useState("");
  const [counted, setCounted] = useState("");
  const [notes, setNotes] = useState("");
  const [done, setDone] = useState<null | { id: string; kind: VarianceKind | "hidden"; amount: number }>(null);

  async function post(payload: Record<string, unknown>): Promise<CounterResult | null> {
    setBusy(true);
    setError("");
    let result: CounterResult | null = null;
    try {
      const res = await fetch("/api/counter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || "Operation failed");
      else {
        result = data;
        router.refresh();
      }
    } catch {
      setError("Operation failed");
    }
    setBusy(false);
    return result;
  }

  async function openCounter() {
    const data = await post({ action: "open", openingFloat: floatIn });
    if (data) {
      setFloatIn("");
      setDone(null);
    }
  }

  async function closeCounter() {
    if (!open) return;
    if (!window.confirm("Close the counter now? This cannot be undone.")) return;
    const data = await post({ action: "close", shiftId: open.id, countedCash: counted, notes });
    if (data) {
      setCounted("");
      setNotes("");
      setDone(
        isOwner && typeof data.variance === "number"
          ? { id: data.id, kind: varianceKind(data.variance), amount: data.variance }
          : { id: data.id, kind: "hidden", amount: 0 }
      );
    }
  }

  const countedNum = counted.trim() === "" ? null : Number(counted);
  const liveVariance =
    summary && countedNum != null && Number.isFinite(countedNum) ? varianceOf(countedNum, summary.expectedCash) : null;
  const otherMethods = summary ? summary.methods.filter((m) => m.method !== "CASH") : [];

  return (
    <div className="space-y-6">
      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {done && (
        <div className={`rounded-xl px-5 py-4 text-sm ${done.kind === "hidden" ? "bg-emerald-50 text-emerald-800" : KIND_STYLE[done.kind]}`}>
          <div className="font-semibold">Counter closed.</div>
          {done.kind === "hidden" ? (
            <div className="mt-1">Your cash count has been recorded. The boss will review it.</div>
          ) : (
            <div className="mt-1 text-base font-bold">
              <VarianceText kind={done.kind} amount={done.amount} />
              <Link href={`/counter/${done.id}`} className="ml-4 text-sm font-medium underline">
                View settlement
              </Link>
            </div>
          )}
        </div>
      )}

      {!open && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-1 flex items-center gap-2">
            <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">Counter Closed</span>
          </div>
          <h2 className="mb-1 font-semibold text-slate-900">Open Counter</h2>
          <p className="mb-4 text-sm text-slate-500">
            Count the cash you put in the drawer to start (the change float) and enter it below. Payments can only be taken while the counter is open.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs text-slate-500">Opening Float (RM)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                value={floatIn}
                onChange={(e) => setFloatIn(e.target.value)}
                placeholder="0.00"
                className={input}
              />
            </div>
            <button disabled={busy || floatIn.trim() === ""} onClick={openCounter} className={`${btn} bg-blue-700 text-white hover:bg-blue-800`}>
              Open Counter
            </button>
          </div>
        </div>
      )}

      {open && (
        <>
          {open.staleDay && (
            <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
              This counter was opened on an earlier day. Close it and open a new one, so each day is settled on its own.
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">Counter Open</span>
                <div className="mt-2 text-sm text-slate-600">
                  <span>Opened</span> {formatDateTime(open.openedAt)} · {open.openedByName}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-slate-500">Opening Float</div>
                <div className="text-lg font-bold text-slate-900">{formatCurrency(open.openingFloat)}</div>
              </div>
            </div>
          </div>

          {isOwner && summary && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 font-semibold text-slate-900">Cash in Drawer (so far)</h2>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Opening Float</span>
                  <span>{formatCurrency(summary.openingFloat)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">+ Cash Received from Customers</span>
                  <span>{formatCurrency(summary.cashReceived)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">− Change Given Back</span>
                  <span>{formatCurrency(summary.changeGiven)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">− Cash Refunds</span>
                  <span>{formatCurrency(summary.cashRefunds)}</span>
                </div>
                <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold">
                  <span>Expected Cash in Drawer</span>
                  <span>{formatCurrency(summary.expectedCash)}</span>
                </div>
              </div>
              {otherMethods.length > 0 && (
                <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
                  <div className="mb-1 font-medium text-slate-700">Other Payments (not in the drawer)</div>
                  {otherMethods.map((m) => (
                    <div key={m.method} className="flex justify-between text-slate-600">
                      <span>
                        {PAYMENT_LABEL[m.method] || m.method} ({m.count})
                      </span>
                      <span>{formatCurrency(m.net)}</span>
                    </div>
                  ))}
                  <div className="mt-1 text-xs text-slate-400">
                    Check these against the card terminal, Touch &apos;n Go and bank records. They are not part of the cash count.
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-1 font-semibold text-slate-900">Close Counter &amp; Settle</h2>
            <p className="mb-4 text-sm text-slate-500">
              Count ALL the cash in the drawer now, including the opening float, and enter the total.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1 block text-xs text-slate-500">Cash Counted (RM)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  value={counted}
                  onChange={(e) => setCounted(e.target.value)}
                  placeholder="0.00"
                  className={input}
                />
              </div>
              <div className="min-w-[14rem] flex-1">
                <label className="mb-1 block text-xs text-slate-500">
                  {isOwner ? "Notes (required if short or over)" : "Notes (optional)"}
                </label>
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={500}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                />
              </div>
              <button disabled={busy || counted.trim() === ""} onClick={closeCounter} className={`${btn} bg-violet-600 text-white hover:bg-violet-700`}>
                Close Counter
              </button>
            </div>
            {isOwner && liveVariance != null && (
              <div className={`mt-4 rounded-lg px-4 py-3 text-base font-bold ${KIND_STYLE[varianceKind(liveVariance)]}`}>
                <VarianceText kind={varianceKind(liveVariance)} amount={liveVariance} />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
