"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency, formatDateTime } from "@/lib/utils";

/** Boss marks the day's cash as banked in (with the bank slip no.), or undoes it. Staff just see the status. */
export function DepositPanel({
  shiftId,
  amount,
  depositedAt,
  depositedByName,
  depositRef,
  canEdit,
}: {
  shiftId: string;
  amount: number;
  depositedAt: string | null;
  depositedByName: string | null;
  depositRef: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function send(action: "deposit" | "undeposit") {
    if (action === "undeposit" && !window.confirm("Mark this deposit as not banked in yet?")) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/counter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, shiftId, depositRef: ref }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || "Operation failed");
      else router.refresh();
    } catch {
      setError("Operation failed");
    }
    setBusy(false);
  }

  return (
    <div className="no-print mb-6 rounded-lg border border-slate-200 p-4 text-sm">
      {error && <div className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-red-700">{error}</div>}
      {depositedAt ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">Banked In</span>
            <div className="mt-1 text-slate-600">
              {formatCurrency(amount)} · {formatDateTime(depositedAt)} · {depositedByName}
              {depositRef ? ` · ${depositRef}` : ""}
            </div>
          </div>
          {canEdit && (
            <button disabled={busy} onClick={() => send("undeposit")} className="rounded-lg border border-slate-200 px-3 py-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-50">
              Undo
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <span className="inline-flex rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800">Not Banked In Yet</span>
            <div className="mt-1 text-slate-600">{formatCurrency(amount)}</div>
          </div>
          {canEdit && (
            <>
              <input
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                maxLength={100}
                placeholder="Bank slip / reference (optional)"
                className="min-w-[14rem] flex-1 rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500"
              />
              <button disabled={busy} onClick={() => send("deposit")} className="rounded-lg bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800 disabled:opacity-50">
                Mark as Banked In
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
