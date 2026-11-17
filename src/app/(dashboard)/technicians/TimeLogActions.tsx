"use client";
import { useState } from "react";
export function TimeLogActions({ id, technicianId, status }: { id: string; technicianId: string; status: string }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function act(action: string) { setBusy(true); setError(""); try { const r = await fetch("/api/technician-time-logs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, technicianId, action }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error || "Unable to update timer"); window.location.reload(); } catch (e) { setError(e instanceof Error ? e.message : "Unable to update timer"); } finally { setBusy(false); } }
  return <div className="flex flex-wrap items-center gap-1">{status === "RUNNING" && <button disabled={busy} onClick={() => act("pause")} className="rounded border px-2 py-1 text-xs">Pause</button>}{status === "PAUSED" && <button disabled={busy} onClick={() => act("resume")} className="rounded border px-2 py-1 text-xs">Resume</button>}{["RUNNING","PAUSED"].includes(status) && <button disabled={busy} onClick={() => act("stop")} className="rounded bg-slate-800 px-2 py-1 text-xs text-white">Stop</button>}{error && <span className="text-xs text-red-600">{error}</span>}</div>;
}
