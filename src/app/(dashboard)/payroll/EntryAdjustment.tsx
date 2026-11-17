"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
type Statutory = { epfEmployee: number; socsoEmployee: number; eisEmployee: number; pcb: number; epfEmployer: number; socsoEmployer: number; eisEmployer: number };
const fields: Array<[keyof Statutory, string]> = [["epfEmployee", "EPF employee"], ["socsoEmployee", "SOCSO employee"], ["eisEmployee", "EIS employee"], ["pcb", "PCB / MTD"], ["epfEmployer", "EPF employer"], ["socsoEmployer", "SOCSO employer"], ["eisEmployer", "EIS employer"]];
export function EntryAdjustment({ entryId, allowance: initialAllowance, deduction: initialDeduction, zakat: initialZakat, statutory: initialStatutory, statutoryStatus, statutoryReviewed }: { entryId: string; allowance: number; deduction: number; zakat: number; statutory: Statutory; statutoryStatus: string; statutoryReviewed: boolean }) {
  const router = useRouter();
  const [allowance, setAllowance] = useState(String(initialAllowance));
  const [deduction, setDeduction] = useState(String(initialDeduction));
  const [zakat, setZakat] = useState(String(initialZakat));
  const [statutory, setStatutory] = useState<Record<keyof Statutory, string>>(() => Object.fromEntries(fields.map(([key]) => [key, String(initialStatutory[key] ?? 0)])) as Record<keyof Statutory, string>);
  const [busy, setBusy] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [recalcBusy, setRecalcBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setBusy(true); setError("");
    try {
      const values = Object.fromEntries(fields.map(([key]) => [key, Number(statutory[key])]));
      const res = await fetch("/api/payroll", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "adjust-entry", entryId, allowance: Number(allowance), deduction: Number(deduction), zakat: Number(zakat), ...values }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Unable to save payroll amounts");
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save"); }
    finally { setBusy(false); }
  }
  async function recalculate() {
    setRecalcBusy(true); setError("");
    try {
      const res = await fetch("/api/payroll", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "recalculate-statutory", entryId }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Unable to recalculate statutory amounts");
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to recalculate"); }
    finally { setRecalcBusy(false); }
  }
  async function review() {
    setReviewBusy(true); setError("");
    try {
      const res = await fetch("/api/payroll", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "review-statutory", entryId }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Unable to confirm statutory amounts");
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to confirm"); }
    finally { setReviewBusy(false); }
  }
  return <div className="min-w-[290px] space-y-2">
    <div className="grid grid-cols-3 gap-1"><label className="text-[10px] text-slate-500">Allowance RM<input aria-label="Allowance RM" className="w-full rounded border px-1.5 py-1 text-xs" type="number" min="0" step="0.01" value={allowance} onChange={(e) => setAllowance(e.target.value)} /></label><label className="text-[10px] text-slate-500">Other deduction RM<input aria-label="Other deduction RM" className="w-full rounded border px-1.5 py-1 text-xs" type="number" min="0" step="0.01" value={deduction} onChange={(e) => setDeduction(e.target.value)} /></label><label className="text-[10px] text-slate-500">Zakat RM<input aria-label="Zakat RM" className="w-full rounded border px-1.5 py-1 text-xs" type="number" min="0" step="0.01" value={zakat} onChange={(e) => setZakat(e.target.value)} /></label></div>
    <details className="rounded border border-slate-200 p-2" open={statutoryStatus === "PROFILE_REQUIRED"}><summary className="cursor-pointer text-xs font-semibold">Statutory contributions (RM) · {statutoryStatus.replaceAll("_", " ")}</summary><div className="mt-2 grid grid-cols-2 gap-2">{fields.map(([key, label]) => <label key={key} className="text-[10px] text-slate-500">{label}<input aria-label={`${label} RM`} className="w-full rounded border px-1.5 py-1 text-xs" type="number" min="0" step="0.01" value={statutory[key]} onChange={(e) => setStatutory((v) => ({ ...v, [key]: e.target.value }))} /></label>)}</div></details>
    <button disabled={busy} onClick={save} className="rounded bg-slate-800 px-2 py-1 text-xs text-white disabled:opacity-50">{busy ? "Saving…" : "Save payroll amounts"}</button>
    {statutoryStatus !== "MANUAL_REVIEW" && statutoryStatus !== "PROFILE_REQUIRED" && statutoryStatus !== "RULE_CHANGED" && <button disabled={recalcBusy} onClick={recalculate} className="ml-1 rounded border border-blue-700 px-2 py-1 text-xs font-semibold text-blue-800 disabled:opacity-40">{recalcBusy ? "Recalculating…" : "Recalculate statutory"}</button>}
    <button disabled={reviewBusy || ["PROFILE_REQUIRED", "PROFILE_CHANGED", "RULE_CHANGED"].includes(statutoryStatus)} onClick={review} className="ml-1 rounded border border-emerald-700 px-2 py-1 text-xs font-semibold text-emerald-800 disabled:opacity-40">{statutoryReviewed ? "Statutory reviewed ✓" : reviewBusy ? "Confirming…" : "Confirm statutory review"}</button>
    {statutoryStatus === "CALCULATED_REVIEW_REQUIRED" && <p className="text-[10px] leading-4 text-amber-700">Automatic 2026 preview generated. Compare with official KWSP / PERKESO / HASiL calculators before confirming.</p>}
    {statutoryStatus === "PROFILE_REQUIRED" && <p className="text-[10px] leading-4 text-amber-700">Complete this employee's statutory profile above, then regenerate the draft.</p>}
    {statutoryStatus === "MANUAL_REVIEW" && <p className="text-[10px] leading-4 text-amber-700">Automated statutory schedules in this release start from June 2026. Enter the official amounts manually for earlier periods.</p>}
    {statutoryStatus === "PROFILE_CHANGED" && <p className="text-[10px] leading-4 text-amber-700">Employee statutory profile changed after this draft. Recalculate statutory amounts before review.</p>}
    {statutoryStatus === "RULE_CHANGED" && <p className="text-[10px] leading-4 text-red-700">Commission settings changed after this draft. Regenerate this month's draft; do not approve the old figures.</p>}
    {error && <span className="block text-xs text-red-600">{error}</span>}
  </div>;
}
