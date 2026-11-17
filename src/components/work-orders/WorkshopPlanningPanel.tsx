"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function WorkshopPlanningPanel({
  id,
  priority: initialPriority,
  estimatedCompletionAt: initialDue,
  assignedToId: initialTechnician,
  assignedToName,
  technicians,
}: {
  id: string;
  priority: string;
  estimatedCompletionAt: string;
  assignedToId: string;
  assignedToName: string;
  technicians: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [priority, setPriority] = useState(initialPriority || "NORMAL");
  const [due, setDue] = useState(() => {
    if (!initialDue) return "";
    const local = new Date(initialDue);
    local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
    return local.toISOString().slice(0, 16);
  });
  const [technician, setTechnician] = useState(initialTechnician);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function save() {
    setBusy(true); setMessage(""); setError("");
    try {
      const response = await fetch(`/api/work-orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_workshop_plan",
          priority,
          estimatedCompletionAt: due ? new Date(due).toISOString() : null,
          assignedToId: technician || null,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to save workshop plan");
      setMessage("Workshop plan saved");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save workshop plan");
    } finally { setBusy(false); }
  }

  const field = "mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h2 className="font-semibold text-slate-900">Workshop Planning</h2>
        <p className="mt-1 text-xs text-slate-500">Set job priority, assign a technician and estimate completion.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="text-xs font-medium text-slate-600">Priority
          <select className={field} value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="LOW">Low</option><option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="URGENT">Urgent</option>
          </select>
        </label>
        <label className="text-xs font-medium text-slate-600">Assigned Technician
          <select className={field} value={technician} onChange={(e) => setTechnician(e.target.value)}>
            <option value="">Unassigned</option>
            {technicians.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select>
          {technicians.length === 0 && <span className="mt-1 block text-[11px] text-amber-700">Create a TECHNICIAN account in Settings first.</span>}
        </label>
        <label className="text-xs font-medium text-slate-600">Estimated Completion
          <input className={field} type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs" aria-live="polite">{error && <span className="text-red-600">{error}</span>}{message && <span className="text-emerald-700">{message}</span>}{!error && !message && assignedToName && <span className="text-slate-500">Currently assigned to {assignedToName}</span>}</div>
        <button disabled={busy} onClick={save} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">{busy ? "Saving…" : "Save Workshop Plan"}</button>
      </div>
    </section>
  );
}
