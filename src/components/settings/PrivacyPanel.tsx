"use client";

import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/Dialog";

const YEAR_CHOICES = [7, 8, 10, 15, 20];

/**
 * Settings → Privacy (boss only): how long customer records are kept, and the action that
 * anonymises customers with no visit for that many years (the count is shown first).
 * 【中文】设置 → 隐私（老板专用）：客户资料保留年限，以及把超过年限没来过的客户匿名化（先显示数量）。
 */
export function PrivacyPanel() {
  const [years, setYears] = useState<string>("");
  const [saved, setSaved] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  // `years` here is the saved rule the server counted with (not the select box).
  const [due, setDue] = useState<{ count: number; years: number; noVisitSince: string | null } | null>(null);
  const [counting, setCounting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState("");

  useEffect(() => {
    fetch("/api/shop/privacy", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else {
          setSaved(d.customerRetentionYears ?? null);
          setYears(d.customerRetentionYears ? String(d.customerRetentionYears) : "");
        }
      })
      .catch(() => setError("Network error. Please retry."))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    setMessage("");
    setError("");
    setDue(null);
    try {
      const res = await fetch("/api/shop/privacy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerRetentionYears: years ? Number(years) : null }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setError(d.error || "Save failed");
      else {
        setSaved(d.customerRetentionYears ?? null);
        setMessage("Saved successfully");
      }
    } catch {
      setError("Network error. Please retry.");
    }
    setSaving(false);
  }

  async function count() {
    setCounting(true);
    setMessage("");
    setError("");
    try {
      const res = await fetch("/api/customers/retention", { cache: "no-store" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setError(d.error || "Unable to count customers");
      else if (d.years) setDue({ count: d.count ?? 0, years: d.years, noVisitSince: d.noVisitSince ?? null });
      else setDue(null);
    } catch {
      setError("Network error. Please retry.");
    }
    setCounting(false);
  }

  async function run() {
    if (!due) return;
    setRunning(true);
    setRunError("");
    try {
      const res = await fetch("/api/customers/retention", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The rule the count was made with: refused if the saved setting changed since.
        body: JSON.stringify({ expectedCount: due.count, years: due.years }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRunError(d.error || "Anonymising failed");
        if (typeof d.count === "number") setDue({ count: d.count, years: typeof d.years === "number" ? d.years : due.years, noVisitSince: due.noVisitSince });
      } else {
        setConfirming(false);
        setDue(null);
        setMessage("Customers anonymised");
      }
    } catch {
      setRunError("Network error. Please retry.");
    }
    setRunning(false);
  }

  if (loading) return <div className="text-sm text-slate-500">Loading...</div>;
  // The count and the anonymising use the SAVED setting: while the box shows another value, the
  // boss saves it first (the screen must never show one rule while another one is applied).
  // 【中文】计算和匿名化都按已保存的年限：下拉框改了但还没保存时，先要求保存。
  const dirty = years !== (saved ? String(saved) : "");

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
        <div className="flex items-center gap-2 font-medium">
          <ShieldCheck className="h-4 w-4" />
          <span>Customer personal data (PDPA)</span>
        </div>
        <p className="mt-1">Open a customer on the Customers page to correct their details, export their data or anonymise them.</p>
      </div>

      {message && <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{message}</div>}
      {error && <div className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-700">Keep customer records for</label>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={years}
            onChange={(e) => { setYears(e.target.value); setMessage(""); setDue(null); setConfirming(false); }}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500"
          >
            <option value="">No limit (off)</option>
            {YEAR_CHOICES.map((y) => (
              <option key={y} value={String(y)}>
                {`${y} years`}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          At least 7 years: invoices, receipts and credit notes must be kept that long. Counted from the customer&apos;s last visit.
        </p>
      </div>

      {saved ? (
        <div className="rounded-xl border border-slate-200 p-4">
          <div className="text-sm font-medium text-slate-900">Anonymise customers with no visit for this long</div>
          <p className="mt-1 text-xs text-slate-500">
            Their names and contact details are removed. Invoices and amounts are kept. Check how many first.
          </p>
          {dirty ? (
            <p className="mt-3 text-sm font-medium text-amber-700">Save the new setting first.</p>
          ) : (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={count}
              disabled={counting}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {counting ? "Checking..." : "Check how many"}
            </button>
            {due && (
              <>
                <span className="text-sm text-slate-700">
                  <span>Customers due:</span> <strong>{due.count}</strong>{" "}
                  <span className="text-slate-500">{`No visit for ${due.years} years`}</span>
                </span>
                {due.count > 0 && (
                  <button
                    type="button"
                    onClick={() => { setRunError(""); setConfirming(true); }}
                    className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
                  >
                    Anonymise them
                  </button>
                )}
              </>
            )}
          </div>
          )}
        </div>
      ) : null}

      <ConfirmDialog
        open={confirming && !!due}
        danger
        busy={running}
        error={runError}
        title="Anonymise these customers?"
        confirmLabel="Anonymise"
        onConfirm={run}
        onCancel={() => setConfirming(false)}
        message={
          <div className="space-y-2">
            <p>
              <span>Customers to anonymise:</span> <strong>{due?.count ?? 0}</strong>
            </p>
            {due && <p>{`No visit for ${due.years} years`}</p>}
            <p>Their names, phones, e-mails, TINs, addresses and notes are removed and reminders stop. This cannot be undone. Invoices and amounts are kept.</p>
          </div>
        }
      />
    </div>
  );
}
