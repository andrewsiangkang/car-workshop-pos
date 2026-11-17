"use client";
import { useMemo, useState } from "react";

type Row = { id: string; appointmentNo: string; startAt: string; endAt: string; status: string; serviceType: string | null; customer: { name: string }; vehicle: { plateNumber: string; make: string; model: string }; assignedTechnician: { name: string } | null; serviceBay: { name: string } | null };
const fmt = (value: string) => new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const keyOf = (date: Date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
export function AppointmentCalendar({ appointments }: { appointments: Row[] }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const days = useMemo(() => {
    const monday = new Date(); monday.setHours(0,0,0,0); monday.setDate(monday.getDate() - ((monday.getDay()+6)%7) + weekOffset*7);
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(monday.getDate()+i); return d; });
  }, [weekOffset]);
  const byDay = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const item of appointments) { const key = keyOf(new Date(item.startAt)); map.set(key, [...(map.get(key) || []), item]); }
    for (const rows of map.values()) rows.sort((a,b) => a.startAt.localeCompare(b.startAt));
    return map;
  }, [appointments]);
  return <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">Weekly Appointment Calendar</h2><p className="text-xs text-slate-500">Local workshop time · appointments are saved on this computer</p></div><div className="flex gap-2"><button onClick={() => setWeekOffset((x) => x-1)} className="rounded border px-3 py-1.5 text-sm">Previous</button><button onClick={() => setWeekOffset(0)} className="rounded border px-3 py-1.5 text-sm">Today</button><button onClick={() => setWeekOffset((x) => x+1)} className="rounded border px-3 py-1.5 text-sm">Next</button></div></div>
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-7">{days.map((day) => { const rows = byDay.get(keyOf(day)) || []; return <div key={keyOf(day)} className="min-h-36 rounded-lg border border-slate-200 bg-slate-50 p-2"><div className="mb-2 flex items-center justify-between"><span className="text-xs font-semibold">{day.toLocaleDateString([], { weekday: "short" })}</span><span className="text-xs text-slate-500">{day.toLocaleDateString([], { day: "2-digit", month: "short" })}</span></div><div className="space-y-2">{rows.map((row) => <div key={row.id} className="rounded-md border border-blue-100 bg-white p-2 text-xs"><div className="font-semibold text-blue-700">{fmt(row.startAt)} · {row.vehicle.plateNumber}</div><div className="mt-1 text-slate-700">{row.customer.name}</div><div className="text-slate-500">{row.serviceType || "Workshop visit"}</div><div className="mt-1 text-[10px] text-slate-400">{row.status} · {row.assignedTechnician?.name || "Unassigned"} · {row.serviceBay?.name || "No bay"}</div></div>)}{rows.length===0 && <p className="py-5 text-center text-[11px] text-slate-400">No appointments</p>}</div></div>; })}</div>
  </section>;
}
