"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Profile = {
  statutoryProfileComplete: boolean; epfCategory: string; socsoCategory: string; socsoSkbbk: string; eisEligible: boolean;
  taxResidency: string; taxCategory: string; qualifyingChildren: number; disabledSelf: boolean; disabledSpouse: boolean;
  priorGrossYtd: number; priorEpfYtd: number; priorPcbYtd: number; priorZakatYtd: number; priorSocsoYtd: number;
  taxReliefYtd: number; taxReliefMonthly: number; zakatMonthly: number;
};
const defaults: Profile = { statutoryProfileComplete: false, epfCategory: "MALAYSIAN_UNDER_60", socsoCategory: "FIRST", socsoSkbbk: "OFF", eisEligible: true, taxResidency: "RESIDENT", taxCategory: "SINGLE", qualifyingChildren: 0, disabledSelf: false, disabledSpouse: false, priorGrossYtd: 0, priorEpfYtd: 0, priorPcbYtd: 0, priorZakatYtd: 0, priorSocsoYtd: 0, taxReliefYtd: 0, taxReliefMonthly: 0, zakatMonthly: 0 };
const moneyFields: Array<[keyof Profile, string]> = [
  ["priorGrossYtd", "YTD gross wages not recorded in this POS"], ["priorEpfYtd", "YTD EPF employee contributions not recorded here"],
  ["priorPcbYtd", "YTD PCB already deducted outside this POS"], ["priorZakatYtd", "YTD Zakat paid outside this POS"],
  ["priorSocsoYtd", "YTD SOCSO employee contributions outside this POS"], ["taxReliefYtd", "Previous employer other approved tax relief YTD"],
  ["taxReliefMonthly", "Other approved tax relief for this month"], ["zakatMonthly", "Zakat paid this month"],
];
const input = "mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs";

export function StatutoryProfileEditor({ userId, profile }: { userId: string; profile: Partial<Profile> | null }) {
  const router = useRouter();
  const [form, setForm] = useState<Profile>({ ...defaults, ...(profile || {}) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  function set<K extends keyof Profile>(key: K, value: Profile[K]) { setForm((current) => ({ ...current, [key]: value })); setSaved(false); setConfirmed(false); }
  async function save() {
    setBusy(true); setError(""); setSaved(false);
    try {
      const response = await fetch("/api/payroll", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save-statutory-profile", userId, ...form }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to save statutory profile");
      setSaved(true); router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save"); }
    finally { setBusy(false); }
  }
  return <details className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-semibold">
      <span>EPF / SOCSO / EIS / PCB employee profile</span>
      <span className={form.statutoryProfileComplete ? "text-emerald-700" : "text-amber-700"}>{form.statutoryProfileComplete ? "Profile saved" : "Needs owner setup"}</span>
    </summary>
    <div className="mt-3 space-y-3">
      <p className="text-[11px] leading-5 text-slate-500">Owner must confirm each employee&apos;s actual statutory category. Prior-year-to-date amounts entered below are for a previous employer; this POS automatically adds earlier PAID payroll runs from the same tax year. Foreign workers must use the correct first / second category. Defaults are only form suggestions; calculations remain disabled until this profile is saved.</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-[11px] text-slate-600">EPF category<select className={input} value={form.epfCategory} onChange={(e) => set("epfCategory", e.target.value)}><option value="MALAYSIAN_UNDER_60">Malaysian / PR under 60</option><option value="MALAYSIAN_60_PLUS">Malaysian age 60+</option><option value="PR_UNDER_60">Permanent Resident under 60</option><option value="PR_60_PLUS">Permanent Resident age 60+</option><option value="FOREIGN">Non-Malaysian (2% + 2%)</option><option value="NONE">No EPF contribution</option></select></label>
        <label className="text-[11px] text-slate-600">SOCSO category<select className={input} value={form.socsoCategory} onChange={(e) => set("socsoCategory", e.target.value)}><option value="FIRST">First category (under 60)</option><option value="SECOND">Second category (age 60+ / first registered at 55+)</option><option value="FOREIGN">Foreign worker – first category (first registered before 55)</option><option value="NONE">Not covered</option></select></label>
        <label className="text-[11px] text-slate-600">LINDUNG 24 Jam / SKBBK<select className={input} value={form.socsoSkbbk} onChange={(e) => set("socsoSkbbk", e.target.value)}><option value="OFF">Local employee opted out / not opted in</option><option value="ON">Participating / mandatory foreign worker</option></select></label>
        <label className="text-[11px] text-slate-600">PCB tax residency<select className={input} value={form.taxResidency} onChange={(e) => set("taxResidency", e.target.value)}><option value="RESIDENT">Resident</option><option value="NON_RESIDENT">Non-resident</option></select></label>
        <label className="text-[11px] text-slate-600">PCB category<select className={input} value={form.taxCategory} onChange={(e) => set("taxCategory", e.target.value)}><option value="SINGLE">Single / spouse working</option><option value="MARRIED_SPOUSE_NOT_WORKING">Married, spouse not working</option><option value="MARRIED_SPOUSE_WORKING">Married, spouse working</option></select></label>
        <label className="text-[11px] text-slate-600">Qualifying children under 18 (RM2,000 each)<input className={input} type="number" min="0" max="20" step="1" value={form.qualifyingChildren} onChange={(e) => set("qualifyingChildren", Number(e.target.value))} /></label>
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-slate-700">
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.eisEligible} onChange={(e) => set("eisEligible", e.target.checked)} /> EIS eligible</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.disabledSelf} onChange={(e) => set("disabledSelf", e.target.checked)} /> Disabled employee</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.disabledSpouse} onChange={(e) => set("disabledSpouse", e.target.checked)} /> Disabled spouse</label>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {moneyFields.map(([key, label]) => <label key={key} className="text-[10px] leading-4 text-slate-600">{label}<input className={input} type="number" min="0" step="0.01" value={Number(form[key] || 0)} onChange={(e) => set(key, Number(e.target.value) as never)} /></label>)}
      </div>
      <label className="flex items-start gap-2 text-[11px] leading-5 text-slate-700"><input className="mt-1" type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> I confirm these employee categories, eligibility and tax profile details are correct and have been checked against the employee&apos;s records.</label>
      <div className="flex flex-wrap items-center gap-2"><button disabled={busy || !confirmed} onClick={save} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Save employee statutory profile"}</button>{saved && <span className="text-xs text-emerald-700">Saved. Regenerate the draft to calculate statutory amounts.</span>}{error && <span className="text-xs text-red-600">{error}</span>}</div>
    </div>
  </details>;
}
