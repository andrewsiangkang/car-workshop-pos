"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { PAYMENT_LABEL } from "@/lib/status";
import { cleanMoneyInput } from "@/lib/money-input";
import { breakdownFromInputs, depositOf, varianceKind, varianceOf, type ShiftSummary, type VarianceKind } from "@/lib/counter-calc";
import { DenominationCounter, countsTotal, type CountInputs } from "@/components/counter/DenominationCounter";

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

/** Two ways to enter cash: count by notes / coins (default), or type one total. */
function ModeToggle({ mode, onChange }: { mode: "count" | "total"; onChange: (m: "count" | "total") => void }) {
  const on = "bg-blue-700 text-white";
  const off = "bg-white text-slate-600 hover:bg-slate-50";
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-slate-200 text-xs font-medium">
      <button type="button" onClick={() => onChange("count")} className={`px-3 py-1.5 ${mode === "count" ? on : off}`}>
        Count by notes &amp; coins
      </button>
      <button type="button" onClick={() => onChange("total")} className={`px-3 py-1.5 ${mode === "total" ? on : off}`}>
        Type total only
      </button>
    </div>
  );
}

export function CounterPanel({
  open,
  summary,
  suggestedFloat = null,
  isOwner = false,
}: {
  open: OpenShift | null;
  summary: ShiftSummary | null;
  suggestedFloat?: number | null; // float the last closed day left in the drawer
  isOwner?: boolean; // only the boss sees / sets the bank deposit
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [floatIn, setFloatIn] = useState("");
  const [counted, setCounted] = useState("");
  const [notes, setNotes] = useState("");
  const [openMode, setOpenMode] = useState<"count" | "total">("count");
  const [openCounts, setOpenCounts] = useState<CountInputs>({});
  const [closeMode, setCloseMode] = useState<"count" | "total">("count");
  const [closeCounts, setCloseCounts] = useState<CountInputs>({});
  const [keepIn, setKeepIn] = useState<string | null>(null); // null = same as today's opening float
  const [confirming, setConfirming] = useState(false); // second tap on Close Counter (replaces the browser pop-up)

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
      else result = data;
    } catch {
      setError("Operation failed");
    }
    setBusy(false);
    return result;
  }

  async function openCounter() {
    const data = await post(
      openMode === "count"
        ? { action: "open", openingBreakdown: breakdownFromInputs(openCounts) }
        : { action: "open", openingFloat: floatIn }
    );
    if (data) {
      setFloatIn("");
      setOpenCounts({});
      router.refresh();
    }
  }

  async function closeCounter() {
    if (!open) return;
    // Two taps instead of a browser pop-up: pop-ups can leave the desktop app's text boxes unable to type.
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    const data = await post({
      action: "close",
      shiftId: open.id,
      ...(closeMode === "count" ? { countedBreakdown: breakdownFromInputs(closeCounts) } : { countedCash: counted }),
      ...(isOwner ? { floatKept: keepNum } : {}),
      notes,
    });
    if (data) {
      setCounted("");
      setCloseCounts({});
      setKeepIn(null);
      setNotes("");
      // The settlement report is generated right away.
      router.push(`/counter/${data.id}`);
    }
  }

  const countedNum =
    closeMode === "count"
      ? Object.keys(closeCounts).some((k) => closeCounts[k] !== "")
        ? countsTotal(closeCounts)
        : null
      : counted.trim() === ""
        ? null
        : Number(counted);
  // Float kept for tomorrow: the opening float, but never more than the cash actually counted
  // (otherwise a short drawer made it impossible to close).
  const defaultKeep = !open
    ? 0
    : countedNum != null && Number.isFinite(countedNum)
      ? Math.min(open.openingFloat, countedNum)
      : open.openingFloat;
  const keepNum = keepIn === null ? defaultKeep : keepIn.trim() === "" ? 0 : Number(keepIn);
  const keepTooMuch = isOwner && countedNum != null && Number.isFinite(keepNum) && keepNum > countedNum + 0.005;
  const deposit = isOwner && countedNum != null && Number.isFinite(keepNum) && !keepTooMuch ? depositOf(countedNum, keepNum) : null;
  const openTotal = openMode === "count" ? countsTotal(openCounts) : Number(floatIn || 0);
  const canOpen = openMode === "count" ? openTotal > 0 : floatIn.trim() !== "";
  const liveVariance =
    summary && countedNum != null && Number.isFinite(countedNum) ? varianceOf(countedNum, summary.expectedCash) : null;
  const otherMethods = summary ? summary.methods.filter((m) => m.method !== "CASH") : [];
  const totalCollected = summary ? summary.methods.reduce((total, method) => total + method.net, 0) : 0;
  const nonCashCollected = otherMethods.reduce((total, method) => total + method.net, 0);
  const totalBankSettlement = deposit != null ? deposit + nonCashCollected : null;

  return (
    <div className="space-y-6">
      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {!open && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-1 flex items-center gap-2">
            <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">Counter Closed</span>
          </div>
          <h2 className="mb-1 font-semibold text-slate-900">Open Counter</h2>
          <p className="mb-4 text-sm text-slate-500">
            Count the cash you put in the drawer to start (the change float) and enter it below. Payments can only be taken while the counter is open.
          </p>
          <div className="mb-3">
            <ModeToggle mode={openMode} onChange={setOpenMode} />
          </div>
          {suggestedFloat != null && suggestedFloat > 0 && (
            <div className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
              <span>The last settlement left this float in the drawer:</span> <b>{formatCurrency(suggestedFloat)}</b>{" "}
              <button
                type="button"
                onClick={() => {
                  setOpenMode("total");
                  setFloatIn(String(suggestedFloat));
                }}
                className="ml-1 text-blue-700 hover:underline"
              >
                Use this amount
              </button>
            </div>
          )}
          {openMode === "count" ? (
            <div className="max-w-sm">
              <DenominationCounter counts={openCounts} onChange={setOpenCounts} />
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-xs text-slate-500">Opening Float (RM)</label>
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={floatIn}
                onChange={(e) => setFloatIn(cleanMoneyInput(e.target.value))}
                placeholder="0.00"
                className={input}
              />
            </div>
          )}
          <div className="mt-4">
            <button disabled={busy || !canOpen} onClick={openCounter} className={`${btn} bg-blue-700 text-white hover:bg-blue-800`}>
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

          {summary && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-blue-950">Total Daily Collections</h2>
                  <p className="mt-1 text-xs text-blue-800">All payment methods combined — cash, card, bank transfer, DuitNow QR and e-wallet.</p>
                </div>
                <div className="text-right text-xl font-bold text-blue-950">{formatCurrency(totalCollected)}</div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 border-t border-blue-200 pt-3 text-sm">
                <div><div className="text-xs text-blue-700">Cash sales</div><div className="font-semibold text-blue-950">{formatCurrency(summary.cashSales - summary.cashRefunds)}</div></div>
                <div><div className="text-xs text-blue-700">Electronic / non-cash</div><div className="font-semibold text-blue-950">{formatCurrency(nonCashCollected)}</div></div>
              </div>
            </div>
          )}

          {summary && (
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
                <div className="flex justify-between">
                  <span className="text-slate-500">− Cash Paid Out from Drawer</span>
                  <span>{formatCurrency(summary.cashPayouts)}</span>
                </div>
                <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold">
                  <span>Expected Cash in Drawer</span>
                  <span>{formatCurrency(summary.expectedCash)}</span>
                </div>
              </div>
              {otherMethods.length > 0 && (
                <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
                  <div className="mb-1 flex items-center justify-between font-semibold text-slate-800">
                    <span>Electronic Payments (included in daily total)</span>
                    <span>{formatCurrency(nonCashCollected)}</span>
                  </div>
                  {otherMethods.map((m) => (
                    <div key={m.method} className="flex justify-between text-slate-600">
                      <span>
                        {PAYMENT_LABEL[m.method] || m.method} ({m.count})
                      </span>
                      <span>{formatCurrency(m.net)}</span>
                    </div>
                  ))}
                  <div className="mt-1 text-xs text-slate-400">
                    These payments are included in total daily collections. They are already received through the card / QR / bank channels, so do not count them as physical drawer cash.
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
            <div className="mb-3">
              <ModeToggle mode={closeMode} onChange={setCloseMode} />
            </div>
            {closeMode === "count" ? (
              <div className="max-w-sm">
                <DenominationCounter counts={closeCounts} onChange={setCloseCounts} />
              </div>
            ) : (
              <div>
                <label className="mb-1 block text-xs text-slate-500">Cash Counted (RM)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={counted}
                  onChange={(e) => setCounted(cleanMoneyInput(e.target.value))}
                  placeholder="0.00"
                  className={input}
                />
              </div>
            )}
            {liveVariance != null && (
              <div className={`mt-4 rounded-lg px-4 py-3 text-base font-bold ${KIND_STYLE[varianceKind(liveVariance)]}`}>
                <VarianceText kind={varianceKind(liveVariance)} amount={liveVariance} />
              </div>
            )}

            {isOwner && (
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 text-sm font-semibold text-slate-800">Bank Deposit</div>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Float to keep in drawer for tomorrow (RM)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={keepIn === null ? String(defaultKeep) : keepIn}
                    onChange={(e) => setKeepIn(cleanMoneyInput(e.target.value))}
                    placeholder="0.00"
                    className={input}
                  />
                </div>
                <div className="pb-2 text-sm text-slate-600">
                  <span>Cash Counted</span> {formatCurrency(countedNum ?? 0)} − <span>Float</span> {formatCurrency(Number.isFinite(keepNum) ? keepNum : 0)}
                </div>
              </div>
              {keepTooMuch && <div className="mt-2 text-sm text-red-600">The float to keep cannot be more than the cash counted.</div>}
              {deposit != null && (
                <>
                  <div className="mt-3 flex items-center justify-between rounded-lg bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-800">
                    <span>Cash to Bank In (cash counted − drawer float)</span>
                    <span>{formatCurrency(deposit)}</span>
                  </div>
                  <div className="mt-2 space-y-1 rounded-lg border border-slate-200 bg-white p-3 text-sm">
                    <div className="flex justify-between"><span className="text-slate-500">Cash to deposit</span><span>{formatCurrency(deposit)}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Electronic payments already in bank / merchant accounts</span><span>{formatCurrency(nonCashCollected)}</span></div>
                    <div className="flex justify-between border-t border-slate-200 pt-2 font-bold text-slate-900"><span>Total daily amount in bank / payment channels</span><span>{formatCurrency(totalBankSettlement ?? 0)}</span></div>
                  </div>
                </>
              )}
              <div className="mt-1 text-xs text-slate-400">The cash deposit is physical cash only. Electronic payments are already credited to their respective bank / merchant accounts. Operating costs are not deducted here.</div>
            </div>
            )}

            <div className="mt-4 flex flex-wrap items-end gap-3">
              <div className="min-w-[14rem] flex-1">
                <label className="mb-1 block text-xs text-slate-500">Notes (optional, e.g. why the cash is short or over)</label>
                <input
                  value={notes}
                  onChange={(e) => {
                    setNotes(e.target.value);
                    setConfirming(false);
                  }}
                  maxLength={500}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                />
              </div>
              <button
                disabled={busy || countedNum == null || keepTooMuch || !Number.isFinite(keepNum)}
                onClick={closeCounter}
                className={`${btn} ${confirming ? "bg-red-600 hover:bg-red-700" : "bg-violet-600 hover:bg-violet-700"} text-white`}
              >
                {confirming ? "Tap again to close the counter" : "Close Counter"}
              </button>
              {confirming && (
                <button type="button" onClick={() => setConfirming(false)} className={`${btn} border border-slate-300 text-slate-700`}>
                  Cancel
                </button>
              )}
            </div>
            {confirming && (
              <div className="mt-2 text-sm text-slate-500">
                {liveVariance != null && varianceKind(liveVariance) !== "balanced"
                  ? "The cash does not match the expected amount. It will be recorded on the settlement. "
                  : ""}
                This cannot be undone.
              </div>
            )}
            {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          </div>
        </>
      )}
    </div>
  );
}
