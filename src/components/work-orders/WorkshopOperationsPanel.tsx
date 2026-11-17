"use client";
import { useState } from "react";
import { WorkOrderPartsPanel } from "@/components/work-orders/WorkOrderPartsPanel";

type Opt = { id: string; label: string };
export function WorkshopOperationsPanel({ workOrderId, templateId, currentStage, technicians, inventory }: { workOrderId: string; templateId?: string; currentStage: string; technicians: Opt[]; inventory: (Opt & { quantityOnHand: number })[] }) {
  const [busy, setBusy] = useState(""); const [message, setMessage] = useState(""); const [link, setLink] = useState("");
  const [nextStage, setNextStage] = useState(currentStage);
  const [technicianId, setTechnicianId] = useState(technicians[0]?.id || "");
  async function run(key: string, url: string, method: string, body: unknown) {
    setBusy(key); setMessage(""); setLink("");
    try { const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const d = await r.json(); if (!r.ok) throw new Error(d.error || "Request failed");
      if (key === "approval" && d.secureToken) setLink(`${window.location.origin}/customer-approval/${d.id}?token=${encodeURIComponent(d.secureToken)}`);
      setMessage(`${key} created successfully${d.inspectionNo ? `: ${d.inspectionNo}` : d.appointmentNo ? `: ${d.appointmentNo}` : ""}.`);
      if (key !== "approval") window.setTimeout(() => window.location.reload(), 700);
    } catch (e) { setMessage(e instanceof Error ? e.message : "Request failed"); } finally { setBusy(""); }
  }
  return <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
    <div><h2 className="font-semibold text-slate-900">Workshop Operations</h2><p className="mt-1 text-xs text-slate-500">Digital inspection, customer approval, technician time and parts reservation.</p></div>
    <div className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3"><label className="min-w-[220px] flex-1 text-xs">Workshop Stage<select value={nextStage} onChange={(e) => setNextStage(e.target.value)} className="mt-1 w-full rounded border p-2 text-sm">{["LEGACY","WAITING","CHECK_IN","INSPECTING","AWAITING_APPROVAL","WAITING_PARTS","IN_REPAIR","QC_PENDING","REWORK","READY","HANDED_OVER","CANCELLED"].map((s) => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}</select></label><button disabled={!!busy || nextStage === currentStage} onClick={() => run("stage", `/api/work-orders/${workOrderId}/stage`, "PATCH", { toStage: nextStage })} className="rounded bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">Update Stage</button><span className="text-xs text-slate-500">Current: {currentStage}</span></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <button disabled={!!busy} onClick={() => run("inspection", "/api/inspections", "POST", { workOrderId, templateId })} className="rounded-lg border border-slate-200 p-3 text-left hover:border-blue-300 disabled:opacity-50"><b className="block text-sm">Start Inspection</b><span className="text-xs text-slate-500">Create DVI checklist</span></button>
      <button disabled={!!busy} onClick={() => run("QC", `/api/work-orders/${workOrderId}/qc`, "POST", {})} className="rounded-lg border border-slate-200 p-3 text-left hover:border-blue-300 disabled:opacity-50"><b className="block text-sm">Create QC Checklist</b><span className="text-xs text-slate-500">Final quality control</span></button>
      <button disabled={!!busy} onClick={() => run("approval", "/api/approvals", "POST", { workOrderId, approvalMethod: "SECURE_LINK" })} className="rounded-lg border border-slate-200 p-3 text-left hover:border-blue-300 disabled:opacity-50"><b className="block text-sm">Request Customer Approval</b><span className="text-xs text-slate-500">Snapshot current quotation lines</span></button>
      <div className="rounded-lg border border-slate-200 p-3"><b className="block text-sm">Start Technician Timer</b><select value={technicianId} onChange={(e) => setTechnicianId(e.target.value)} className="mt-2 w-full rounded border p-1.5 text-xs">{technicians.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select><button disabled={!!busy || !technicianId} onClick={() => run("timer", "/api/technician-time-logs", "POST", { action: "start", workOrderId, technicianId })} className="mt-2 w-full rounded bg-blue-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Start</button></div>
    </div>
    <WorkOrderPartsPanel workOrderId={workOrderId} inventory={inventory} />
    {message && <p className="text-sm text-amber-700">{message}</p>}{link && <div className="break-all rounded bg-emerald-50 p-3 text-xs text-emerald-800"><b className="block">Customer approval link — copy and send through a channel controlled by your workshop</b><input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="mt-2 w-full rounded border border-emerald-200 bg-white p-2 text-xs text-slate-800"/><button onClick={() => navigator.clipboard?.writeText(link).then(() => setMessage("Approval link copied."), () => setMessage("Select the link above and copy it manually."))} className="mt-2 rounded bg-emerald-700 px-3 py-2 text-xs font-semibold text-white">Copy link</button></div>}
  </section>;
}
