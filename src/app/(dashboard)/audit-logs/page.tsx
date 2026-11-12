"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/layout/Header";
import { ClipboardList, RefreshCw } from "lucide-react";

function prettyDetails(value: string) {
  try { return JSON.stringify(JSON.parse(value), null, 2); }
  catch { return value; }
}

type AuditItem = {
  id: string; actorName: string; actorRole: string; action: string;
  entityType: string; entityId: string | null; summary: string;
  details: string | null; ipAddress: string | null; createdAt: string;
};

export default function AuditLogsPage() {
  const [items, setItems] = useState<AuditItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/audit-logs?page=1", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load audit trail");
      setItems(data.items || []); setTotal(data.total || 0);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to load audit trail"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  return <div>
    <Header title="Audit Trail" description="Immutable history of important staff and business actions" actions={<button onClick={load} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"><RefreshCw className="h-4 w-4"/>Refresh</button>} />
    <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="text-sm text-slate-500">Total recorded events</div><div className="mt-1 text-2xl font-semibold text-slate-900">{total.toLocaleString()}</div></div>
      <div className="rounded-xl border border-slate-200 bg-white p-4 sm:col-span-2"><div className="text-sm text-slate-500">Access</div><div className="mt-1 text-sm font-medium text-slate-800">Owner only · newest 50 events shown · sensitive credentials are excluded</div></div>
    </div>
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      {loading ? <div className="p-10 text-center text-sm text-slate-500">Loading audit records…</div> : error ? <div className="p-8 text-center text-sm text-red-600">{error}</div> : items.length === 0 ? <div className="p-10 text-center"><ClipboardList className="mx-auto mb-2 h-8 w-8 text-slate-300"/><div className="font-medium text-slate-700">No audit events yet</div><div className="mt-1 text-sm text-slate-500">Important changes will appear here as they are recorded.</div></div> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Date / Time</th><th className="px-4 py-3">Staff</th><th className="px-4 py-3">Action</th><th className="px-4 py-3">Record</th><th className="px-4 py-3">Details</th></tr></thead><tbody className="divide-y divide-slate-100">{items.map(item => <tr key={item.id} className="align-top"><td className="whitespace-nowrap px-4 py-3 text-slate-600">{new Date(item.createdAt).toLocaleString()}</td><td className="px-4 py-3"><div className="font-medium text-slate-900">{item.actorName}</div><div className="text-xs text-slate-500">{item.actorRole}</div></td><td className="px-4 py-3"><span className="rounded-md bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">{item.action}</span></td><td className="px-4 py-3"><div className="font-medium text-slate-800">{item.entityType}</div><div className="max-w-[180px] truncate text-xs text-slate-500">{item.entityId || "—"}</div></td><td className="max-w-md px-4 py-3 text-slate-700"><div>{item.summary}</div>{item.details && <details className="mt-1"><summary className="cursor-pointer text-xs text-blue-700">View metadata</summary><pre className="mt-2 whitespace-pre-wrap break-all rounded bg-slate-50 p-2 text-xs">{prettyDetails(item.details)}</pre></details>}</td></tr>)}</tbody></table></div>}
    </div>
    <p className="mt-3 text-xs text-slate-500">Audit records are append-only through the application. Restrict database file and backup access to trusted administrators.</p>
  </div>;
}
