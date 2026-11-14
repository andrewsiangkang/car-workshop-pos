"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { PAYMENT_LABEL } from "@/lib/status";

export type ReconcileLine = {
  method: string;
  count: number;
  net: number;
  checkedBy: string | null;
  checkedAt: string | null;
};

/** Boss ticks each non-cash method once it matches the card terminal / Touch 'n Go / bank statement. */
export function ReconcilePanel({ shiftId, lines, canEdit }: { shiftId: string; lines: ReconcileLine[]; canEdit: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function toggle(method: string, checked: boolean) {
    setBusy(method);
    setError("");
    try {
      const res = await fetch("/api/counter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reconcile", shiftId, method, checked }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || "Operation failed");
      else router.refresh();
    } catch {
      setError("Operation failed");
    }
    setBusy("");
  }

  return (
    <div className="mb-6 text-sm">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Other Payments (not in the drawer)</div>
      {error && <div className="no-print mb-2 rounded-lg bg-red-50 px-3 py-2 text-red-700">{error}</div>}
      {lines.map((l) => (
        <div key={l.method} className="flex items-center justify-between gap-3 border-t border-slate-100 py-1.5">
          <label className="flex items-center gap-2">
            {canEdit && (
              <input
                type="checkbox"
                className="no-print"
                checked={!!l.checkedAt}
                disabled={busy === l.method}
                onChange={(e) => toggle(l.method, e.target.checked)}
              />
            )}
            <span>
              {PAYMENT_LABEL[l.method] || l.method} ({l.count})
            </span>
            {l.checkedAt ? (
              <span className="text-xs text-emerald-700">
                Checked · {l.checkedBy} · {formatDateTime(l.checkedAt)}
              </span>
            ) : (
              <span className="text-xs text-amber-700">Not checked yet</span>
            )}
          </label>
          <span>{formatCurrency(l.net)}</span>
        </div>
      ))}
      <div className="mt-1 text-xs text-slate-400">
        Tick after you match it with the card terminal, Touch &apos;n Go or bank statement.
      </div>
    </div>
  );
}
