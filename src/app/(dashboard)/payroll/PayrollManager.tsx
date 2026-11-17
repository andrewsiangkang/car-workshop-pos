"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EntryAdjustment } from "./EntryAdjustment";
import { PayslipActions } from "./PayslipActions";
import { StatutoryProfileEditor } from "./StatutoryProfileEditor";

type Employee = { id: string; name: string; email: string; role: string; rule: ({ basis: string; commissionRate: number; basicSalary: number; isActive: boolean; statutoryProfileComplete: boolean; epfCategory: string; socsoCategory: string; socsoSkbbk: string; eisEligible: boolean; taxResidency: string; taxCategory: string; qualifyingChildren: number; disabledSelf: boolean; disabledSpouse: boolean; priorGrossYtd: number; priorEpfYtd: number; priorPcbYtd: number; priorZakatYtd: number; priorSocsoYtd: number; taxReliefYtd: number; taxReliefMonthly: number; zakatMonthly: number }) | null };
type Entry = { id: string; userId: string; employeeName: string; basis: string; basisAmount: number; commissionRate: number; commissionAmount: number; basicSalary: number; allowance: number; deduction: number; zakat: number; epfEmployee: number; socsoEmployee: number; eisEmployee: number; pcb: number; epfEmployer: number; socsoEmployer: number; eisEmployer: number; totalAmount: number; workOrderNumber: string | null; statutoryStatus: string; statutoryReviewed: boolean };
type Run = { id: string; periodKey: string; status: string; totalAmount: number; approvedAt: string | null; paidAt: string | null; entries: Entry[] };
const field = "mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm";
const fmt = (n: number) => `RM ${n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const basisNames: Record<string, string> = { LABOR: "Labour / Service", PARTS: "Spare Parts", GROSS_PROFIT: "Gross Profit", TOTAL: "Work Order Total" };

export function PayrollManager({ employees, runs }: { employees: Employee[]; runs: Run[] }) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, { basis: string; commissionRate: string; basicSalary: string; isActive: boolean }>>(() => Object.fromEntries(employees.map((e) => [e.id, { basis: e.rule?.basis || "LABOR", commissionRate: String(e.rule?.commissionRate ?? 0), basicSalary: String(e.rule?.basicSalary ?? 0), isActive: e.rule?.isActive ?? false }])));
  const now = new Date();
  const [period, setPeriod] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function action(payload: Record<string, unknown>, key: string) {
    setBusy(key); setError(""); setMessage("");
    try {
      const res = await fetch("/api/payroll", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Payroll action failed");
      setMessage("Saved successfully."); router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save"); }
    finally { setBusy(""); }
  }

  return <div className="space-y-6">
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-1 text-lg font-semibold">1. Technician Commission Settings</div>
      <p className="mb-4 text-sm text-slate-500">Only the owner can set commission and statutory categories. Complete the employee statutory profile before generating a payroll preview. Commission rates and basic salary are never assumed.</p>
      <div className="space-y-3">
        {employees.map((employee) => {
          const d = drafts[employee.id];
          return <div key={employee.id} className="rounded-lg border border-slate-200 p-3">
            <div className="grid gap-3 md:grid-cols-[1.2fr_1fr_0.8fr_0.8fr_auto] md:items-end">
              <div><div className="font-semibold">{employee.name}</div><div className="text-xs text-slate-500">{employee.role} · {employee.email}</div></div>
              <label className="text-xs text-slate-600">Commission based on<select className={field} value={d.basis} onChange={(e) => setDrafts((x) => ({ ...x, [employee.id]: { ...x[employee.id], basis: e.target.value } }))}>{Object.entries(basisNames).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label className="text-xs text-slate-600">Commission rate (%)<input className={field} type="number" min="0" max="100" step="0.01" value={d.commissionRate} onChange={(e) => setDrafts((x) => ({ ...x, [employee.id]: { ...x[employee.id], commissionRate: e.target.value } }))} /></label>
              <label className="text-xs text-slate-600">Monthly basic (RM)<input className={field} type="number" min="0" step="0.01" value={d.basicSalary} onChange={(e) => setDrafts((x) => ({ ...x, [employee.id]: { ...x[employee.id], basicSalary: e.target.value } }))} /></label>
              <div className="flex flex-col gap-2"><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={d.isActive} onChange={(e) => setDrafts((x) => ({ ...x, [employee.id]: { ...x[employee.id], isActive: e.target.checked } }))} /> Active</label><button disabled={!!busy} onClick={() => action({ action: "save-rule", userId: employee.id, ...d, commissionRate: Number(d.commissionRate), basicSalary: Number(d.basicSalary) }, `rule-${employee.id}`)} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy === `rule-${employee.id}` ? "Saving…" : "Save Rule"}</button></div>
            </div>
            <StatutoryProfileEditor userId={employee.id} profile={employee.rule ? {
              statutoryProfileComplete: employee.rule.statutoryProfileComplete, epfCategory: employee.rule.epfCategory, socsoCategory: employee.rule.socsoCategory, socsoSkbbk: employee.rule.socsoSkbbk, eisEligible: employee.rule.eisEligible,
              taxResidency: employee.rule.taxResidency, taxCategory: employee.rule.taxCategory, qualifyingChildren: employee.rule.qualifyingChildren, disabledSelf: employee.rule.disabledSelf, disabledSpouse: employee.rule.disabledSpouse,
              priorGrossYtd: employee.rule.priorGrossYtd, priorEpfYtd: employee.rule.priorEpfYtd, priorPcbYtd: employee.rule.priorPcbYtd, priorZakatYtd: employee.rule.priorZakatYtd, priorSocsoYtd: employee.rule.priorSocsoYtd,
              taxReliefYtd: employee.rule.taxReliefYtd, taxReliefMonthly: employee.rule.taxReliefMonthly, zakatMonthly: employee.rule.zakatMonthly,
            } : null} />
          </div>;
        })}
        {employees.length === 0 && <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">No active Technician accounts. Create technician accounts in Settings first.</p>}
      </div>
    </section>

    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-1 text-lg font-semibold">2. Generate Monthly Payroll</div>
      <p className="mb-4 text-sm text-slate-500">The system uses completed work orders assigned to the technician in the selected month. Commission is calculated on the collected portion of the invoice. Existing approved or paid payroll cannot be regenerated.</p>
      <div className="flex flex-wrap items-end gap-3"><label className="text-xs text-slate-600">Payroll month<input className={field} type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></label><button disabled={!!busy || !period} onClick={() => action({ action: "generate", periodKey: period }, "generate")} className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy === "generate" ? "Generating…" : "Generate Draft Payroll"}</button></div>
      <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600">Calculation: selected Work Order basis × owner-set rate × collected percentage. One employee summary row holds monthly basic salary, statutory amounts and adjustments. EPF / SOCSO / EIS use 2026 rate previews; PCB uses the HASiL 2026 ordinary monthly remuneration formula. Every employee summary row must be reviewed before the owner can approve payroll. Work orders already included in another payroll run are excluded.</div>
    </section>

    {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}{message && <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{message}</div>}

    <section className="space-y-4">
      <div className="text-lg font-semibold">3. Payroll History & Approval</div>
      {runs.map((run) => <div key={run.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4"><div><div className="font-semibold">{run.periodKey} Payroll</div><div className="mt-1 text-xs text-slate-500">{run.entries.length} payroll entries · Net payroll total {fmt(run.totalAmount)}</div></div><div className="flex items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${run.status === "PAID" ? "bg-emerald-100 text-emerald-800" : run.status === "APPROVED" ? "bg-blue-100 text-blue-800" : "bg-amber-100 text-amber-800"}`}>{run.status}</span>{run.status === "DRAFT" && <button disabled={!!busy} onClick={() => action({ action: "approve", id: run.id }, `approve-${run.id}`)} className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white">Approve</button>}{run.status === "APPROVED" && <button disabled={!!busy} onClick={() => action({ action: "mark-paid", id: run.id }, `paid-${run.id}`)} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white">Mark as Paid</button>}</div></div>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="p-3">Employee</th><th className="p-3">Work Order / Basic</th><th className="p-3">Basis</th><th className="p-3">Rate</th><th className="p-3 text-right">Commission</th><th className="p-3 text-right">Basic</th><th className="p-3">Allowance / Deduction / Zakat</th><th className="p-3 text-right">Employee Net Pay (summary row)</th></tr></thead><tbody className="divide-y">{run.entries.map((entry) => <tr key={entry.id}><td className="p-3 font-medium">{entry.employeeName}</td><td className="p-3">{entry.workOrderNumber || "Employee summary"}</td><td className="p-3">{basisNames[entry.basis] || entry.basis}{entry.basisAmount > 0 && <div className="text-xs text-slate-500">{fmt(entry.basisAmount)}</div>}</td><td className="p-3">{entry.commissionRate}%</td><td className="p-3 text-right">{fmt(entry.commissionAmount)}</td><td className="p-3 text-right">{fmt(entry.basicSalary)}</td><td className="p-3">{run.status === "DRAFT" && !entry.workOrderNumber ? entry.statutoryStatus === "RULE_CHANGED" ? <span className="text-xs font-medium text-red-700">佣金规则已更改，请重新生成本月工资草稿。</span> : <EntryAdjustment entryId={entry.id} allowance={entry.allowance} deduction={entry.deduction} zakat={entry.zakat} statutory={{ epfEmployee: entry.epfEmployee, socsoEmployee: entry.socsoEmployee, eisEmployee: entry.eisEmployee, pcb: entry.pcb, epfEmployer: entry.epfEmployer, socsoEmployer: entry.socsoEmployer, eisEmployer: entry.eisEmployer }} statutoryStatus={entry.statutoryStatus} statutoryReviewed={entry.statutoryReviewed} /> : <span className="text-xs text-slate-500">+{fmt(entry.allowance)} / -{fmt(entry.deduction)} / Zakat {fmt(entry.zakat)}{!entry.workOrderNumber ? <span className="mt-1 block">Statutory: {entry.statutoryReviewed ? "Reviewed" : entry.statutoryStatus}</span> : null}</span>}</td><td className="p-3 text-right font-semibold">{entry.workOrderNumber ? <span className="text-xs font-normal text-slate-400">Included in employee total</span> : fmt(run.entries.filter((row) => row.userId === entry.userId).reduce((sum, row) => sum + row.totalAmount, 0))}</td></tr>)}{run.entries.length === 0 && <tr><td colSpan={8} className="p-8 text-center text-slate-400">No payable commission or basic salary in this period.</td></tr>}</tbody></table></div>
        <PayslipActions run={run} />
      </div>)}
      {runs.length === 0 && <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">No payroll runs yet.</div>}
    </section>
    <p className="text-xs leading-5 text-slate-500">Automatic statutory figures are review previews, not official remittance amounts. The owner must verify each employee against the current KWSP / PERKESO / HASiL calculators before approval. The POS does not submit statutory payments or CP39 files.</p>
  </div>;
}
