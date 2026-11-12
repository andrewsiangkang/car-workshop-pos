"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BellRing, CalendarDays, Gauge, MessageCircle, Search, Settings2,
  CheckCircle2, AlertTriangle, Clock3, Car, X, Wrench,
} from "lucide-react";

type VehicleRow = {
  id: string;
  plateNumber: string;
  make: string;
  model: string;
  mileage: number | null;
  lastServiceDate: string | null;
  lastServiceMileage: number | null;
  nextServiceDate: string | null;
  nextServiceMileage: number | null;
  serviceIntervalKm: number;
  serviceIntervalMonths: number;
  customer: { name: string; phone: string };
};

type Status = "overdue" | "upcoming" | "scheduled" | "completed";

const inputClass = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const labelClass = "mb-1 block text-xs font-medium text-slate-600";

function dateValue(value: string | null) {
  return value ? new Date(value).toISOString().slice(0, 10) : "";
}
function displayDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString() : "—";
}
function getStatus(v: VehicleRow): Status | "none" {
  if (!v.nextServiceDate && v.nextServiceMileage == null) return "none";
  const now = new Date();
  const dueDate = v.nextServiceDate ? new Date(v.nextServiceDate) : null;
  if (dueDate) dueDate.setHours(23, 59, 59, 999);
  const dateOverdue = !!dueDate && dueDate.getTime() < now.getTime();
  const mileageOverdue = v.nextServiceMileage != null && v.mileage != null && v.mileage >= v.nextServiceMileage;
  if (dateOverdue || mileageOverdue) return "overdue";

  const in30Days = !!dueDate && dueDate.getTime() <= now.getTime() + 30 * 86400000;
  const within500Km = v.nextServiceMileage != null && v.mileage != null &&
    v.nextServiceMileage - v.mileage <= 500;
  if (in30Days || within500Km) return "upcoming";
  const lastService = v.lastServiceDate ? new Date(v.lastServiceDate) : null;
  if (lastService && now.getTime() - lastService.getTime() <= 30 * 86400000) return "completed";
  return "scheduled";
}
function whatsappNumber(phone: string) {
  let n = phone.replace(/\D/g, "");
  if (n.startsWith("0")) n = "60" + n.slice(1);
  return n.length >= 9 ? n : "";
}
function whatsappUrl(v: VehicleRow) {
  const phone = whatsappNumber(v.customer.phone || "");
  if (!phone) return "";
  const due = [
    v.nextServiceDate ? `date ${displayDate(v.nextServiceDate)}` : "",
    v.nextServiceMileage != null ? `${v.nextServiceMileage.toLocaleString()} km` : "",
  ].filter(Boolean).join(" / ");
  const message = `Hi ${v.customer.name}, this is a reminder from our workshop. Your ${v.plateNumber} (${v.make} ${v.model}) is due for its next service${due ? ` around ${due}` : ""}. Please contact us to arrange a visit. Thank you.`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

export function ServiceRemindersClient({ initialVehicles }: { initialVehicles: VehicleRow[] }) {
  const router = useRouter();
  const [vehicles, setVehicles] = useState(initialVehicles);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<VehicleRow | null>(null);
  const [completing, setCompleting] = useState<VehicleRow | null>(null);
  const [currentMileage, setCurrentMileage] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setVehicles(initialVehicles);
  }, [initialVehicles]);

  const classified = useMemo(() => vehicles.map(v => ({ ...v, reminderStatus: getStatus(v) })), [vehicles]);
  const counts = {
    overdue: classified.filter(v => v.reminderStatus === "overdue").length,
    upcoming: classified.filter(v => v.reminderStatus === "upcoming").length,
    scheduled: classified.filter(v => v.reminderStatus === "scheduled").length,
    completed: classified.filter(v => v.reminderStatus === "completed").length,
    none: classified.filter(v => v.reminderStatus === "none").length,
  };
  const visible = classified.filter(v => {
    const matchesFilter = filter === "all" ||
      (filter === "none" ? v.reminderStatus === "none" : v.reminderStatus === filter);
    const q = query.trim().toLowerCase();
    const matchesQuery = !q || [v.plateNumber, v.make, v.model, v.customer.name, v.customer.phone].some(x => x.toLowerCase().includes(q));
    return matchesFilter && matchesQuery;
  });

  async function saveReminder(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    setSaving(true); setError("");
    const form = Object.fromEntries(new FormData(e.currentTarget).entries());
    try {
      const res = await fetch("/api/service-reminders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, vehicleId: editing.id, action: "save" }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Unable to save reminder"); setSaving(false); return; }
      setEditing(null);
      router.refresh();
    } catch {
      setError("Network error. Please retry.");
    }
    setSaving(false);
  }

  async function completeService(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!completing) return;
    setSaving(true); setError("");
    try {
      const res = await fetch("/api/service-reminders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicleId: completing.id,
          action: "complete",
          currentMileage,
          serviceIntervalKm: completing.serviceIntervalKm,
          serviceIntervalMonths: completing.serviceIntervalMonths,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Unable to complete service"); setSaving(false); return; }
      setCompleting(null);
      setCurrentMileage("");
      router.refresh();
    } catch {
      setError("Network error. Please retry.");
    }
    setSaving(false);
  }

  function StatusBadge({ status }: { status: string }) {
    const styles: Record<string, string> = {
      overdue: "bg-red-50 text-red-700",
      upcoming: "bg-amber-50 text-amber-700",
      scheduled: "bg-emerald-50 text-emerald-700",
      completed: "bg-blue-50 text-blue-700",
      none: "bg-slate-100 text-slate-600",
    };
    const labels: Record<string, string> = {
      overdue: "Overdue", upcoming: "Upcoming", scheduled: "Scheduled", completed: "Recently serviced", none: "Not set",
    };
    return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${styles[status] || styles.none}`}>{labels[status] || status}</span>;
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className="rounded-xl border border-red-100 bg-white p-4"><div className="flex items-center gap-2 text-sm text-red-700"><AlertTriangle className="h-4 w-4"/> Overdue</div><div className="mt-2 text-2xl font-bold text-slate-900">{counts.overdue}</div></div>
        <div className="rounded-xl border border-amber-100 bg-white p-4"><div className="flex items-center gap-2 text-sm text-amber-700"><Clock3 className="h-4 w-4"/> Upcoming</div><div className="mt-2 text-2xl font-bold text-slate-900">{counts.upcoming}</div></div>
        <div className="rounded-xl border border-emerald-100 bg-white p-4"><div className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4"/> Scheduled</div><div className="mt-2 text-2xl font-bold text-slate-900">{counts.scheduled}</div></div>
        <div className="rounded-xl border border-blue-100 bg-white p-4"><div className="flex items-center gap-2 text-sm text-blue-700"><Wrench className="h-4 w-4"/> Recently serviced</div><div className="mt-2 text-2xl font-bold text-slate-900">{counts.completed}</div></div>
        <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="flex items-center gap-2 text-sm text-slate-600"><BellRing className="h-4 w-4"/> Not set</div><div className="mt-2 text-2xl font-bold text-slate-900">{counts.none}</div></div>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap gap-2">
          {[
            ["all", "All vehicles"], ["overdue", "Overdue"], ["upcoming", "Upcoming"],
            ["scheduled", "Scheduled"], ["completed", "Recently serviced"], ["none", "Not set"],
          ].map(([value, label]) => (
            <button key={value} onClick={() => setFilter(value)} className={`rounded-lg px-3 py-2 text-xs font-medium ${filter === value ? "bg-blue-700 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{label}</button>
          ))}
        </div>
        <div className="relative w-full md:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search plate, customer or phone" className={`${inputClass} pl-9`}/>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">No vehicles match this filter. Add vehicles through Work Orders first.</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {visible.map(v => {
            const link = whatsappUrl(v);
            return (
              <div key={v.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-bold text-slate-900">{v.plateNumber}</h3><StatusBadge status={v.reminderStatus}/></div>
                    <p className="mt-1 text-sm text-slate-600">{v.make} {v.model} · {v.customer.name}</p>
                    <p className="mt-1 text-xs text-slate-500">{v.customer.phone}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => { setError(""); setEditing(v); }} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"><Settings2 className="h-3.5 w-3.5"/> Set reminder</button>
                    <button onClick={() => { setError(""); setCompleting(v); setCurrentMileage(String(v.mileage ?? "")); }} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-2 text-xs font-medium text-white hover:bg-blue-800"><CheckCircle2 className="h-3.5 w-3.5"/> Service done</button>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 text-sm">
                  <div><div className="text-xs text-slate-500">Current mileage</div><div className="mt-1 font-semibold text-slate-800">{v.mileage != null ? `${v.mileage.toLocaleString()} km` : "Not recorded"}</div></div>
                  <div><div className="text-xs text-slate-500">Last service</div><div className="mt-1 font-semibold text-slate-800">{displayDate(v.lastServiceDate)}{v.lastServiceMileage != null ? ` · ${v.lastServiceMileage.toLocaleString()} km` : ""}</div></div>
                  <div><div className="text-xs text-slate-500">Next service date</div><div className="mt-1 font-semibold text-slate-800">{displayDate(v.nextServiceDate)}</div></div>
                  <div><div className="text-xs text-slate-500">Next service mileage</div><div className="mt-1 font-semibold text-slate-800">{v.nextServiceMileage != null ? `${v.nextServiceMileage.toLocaleString()} km` : "—"}</div></div>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-slate-500">Interval: {v.serviceIntervalKm.toLocaleString()} km / {v.serviceIntervalMonths} months</span>
                  {link ? <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-3 py-2 text-xs font-semibold text-white hover:bg-green-700"><MessageCircle className="h-4 w-4"/> WhatsApp customer</a> : <span className="text-xs text-slate-400">No valid phone for WhatsApp</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/40 p-4">
          <form onSubmit={saveReminder} className="my-6 w-full max-w-xl space-y-4 rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between"><div><h2 className="text-lg font-bold text-slate-900">Set service reminder</h2><p className="text-sm text-slate-500">{editing.plateNumber} · {editing.customer.name}</p></div><button type="button" onClick={() => setEditing(null)} className="rounded-lg p-2 hover:bg-slate-100"><X className="h-5 w-5"/></button></div>
            {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label><span className={labelClass}>Last service date</span><input name="lastServiceDate" type="date" defaultValue={dateValue(editing.lastServiceDate)} className={inputClass}/></label>
              <label><span className={labelClass}>Last service mileage (km)</span><input name="lastServiceMileage" type="number" min="0" defaultValue={editing.lastServiceMileage ?? ""} className={inputClass}/></label>
              <label><span className={labelClass}>Next service date</span><input name="nextServiceDate" type="date" defaultValue={dateValue(editing.nextServiceDate)} className={inputClass}/></label>
              <label><span className={labelClass}>Next service mileage (km)</span><input name="nextServiceMileage" type="number" min="0" defaultValue={editing.nextServiceMileage ?? ""} className={inputClass}/></label>
              <label><span className={labelClass}>Repeat every (km)</span><input name="serviceIntervalKm" type="number" min="500" max="100000" required defaultValue={editing.serviceIntervalKm} className={inputClass}/></label>
              <label><span className={labelClass}>Repeat every (months)</span><input name="serviceIntervalMonths" type="number" min="1" max="36" required defaultValue={editing.serviceIntervalMonths} className={inputClass}/></label>
            </div>
            <p className="text-xs text-slate-500">Set at least one next-service trigger: a date, a mileage, or both. The reminder is stored locally in this workshop database.</p>
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm">Cancel</button><button disabled={saving} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving..." : "Save reminder"}</button></div>
          </form>
        </div>
      )}

      {completing && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={completeService} className="w-full max-w-md space-y-4 rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between"><div><h2 className="text-lg font-bold text-slate-900">Record completed service</h2><p className="text-sm text-slate-500">{completing.plateNumber} · {completing.customer.name}</p></div><button type="button" onClick={() => setCompleting(null)} className="rounded-lg p-2 hover:bg-slate-100"><X className="h-5 w-5"/></button></div>
            {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            <label><span className={labelClass}>Current mileage (km) *</span><input type="number" min="0" required value={currentMileage} onChange={e => setCurrentMileage(e.target.value)} className={inputClass}/></label>
            <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800">Next reminder will be set to {completing.serviceIntervalKm.toLocaleString()} km later and {completing.serviceIntervalMonths} months later.</div>
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setCompleting(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm">Cancel</button><button disabled={saving} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving..." : "Confirm service done"}</button></div>
          </form>
        </div>
      )}
    </div>
  );
}
