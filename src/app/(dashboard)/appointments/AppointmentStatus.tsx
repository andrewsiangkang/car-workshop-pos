"use client";
import { useState } from "react";
export function AppointmentStatus({ id, status }: { id: string; status: string }) {
  const [value, setValue] = useState(status); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function save() { setBusy(true); setError(""); try { const r = await fetch(`/api/appointments/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: value }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error || "Unable to update appointment"); window.location.reload(); } catch (e) { setError(e instanceof Error ? e.message : "Unable to update"); } finally { setBusy(false); } }
  return <div className="flex items-center gap-1"><select value={value} onChange={(e) => setValue(e.target.value)} className="max-w-32 rounded border p-1 text-xs">{["BOOKED","CONFIRMED","CHECKED_IN","COMPLETED","CANCELLED","NO_SHOW"].map((x) => <option key={x}>{x}</option>)}</select><button disabled={busy || value === status} onClick={save} className="rounded bg-slate-800 px-2 py-1 text-xs text-white disabled:opacity-40">Save</button>{error && <span className="text-xs text-red-600">{error}</span>}</div>;
}
