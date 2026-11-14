"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/layout/Header";
import { ClipboardList, RefreshCw, ShieldCheck, ShieldAlert } from "lucide-react";

function prettyDetails(value: string) {
  try { return JSON.stringify(JSON.parse(value), null, 2); }
  catch { return value; }
}

type AuditItem = {
  id: string; actorName: string; actorRole: string; action: string;
  entityType: string; entityId: string | null; summary: string;
  details: string | null; ipAddress: string | null; createdAt: string; seq: number | null;
};

type VerifyReport = {
  ok: boolean;
  checked: number;
  last: { seq: number; createdAt: string | null } | null;
  problem: { kind: "missing" | "duplicate" | "altered" | "broken-link"; seq: number; expectedSeq: number; createdAt: string | null } | null;
  unchainedSinceStart: number;
  olderUnchained: number;
};

// Each message is its own text, so the page dictionary can translate it (src/lib/i18n-dict-privacy.ts).
const PROBLEM_TEXT: Record<string, string> = {
  missing: "One or more entries are missing (deleted) just before entry",
  duplicate: "An entry number appears twice or out of order at entry",
  altered: "This entry was changed after it was written: entry",
  "broken-link": "The link to the previous entry is broken at entry",
};

export default function AuditLogsPage() {
  const [items, setItems] = useState<AuditItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [report, setReport] = useState<VerifyReport | null>(null);
  const [verifyError, setVerifyError] = useState("");

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

  async function verify() {
    setVerifying(true); setVerifyError(""); setReport(null);
    try {
      const response = await fetch("/api/audit-logs/verify", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to check the audit trail");
      setReport(data);
      void load();
    } catch (e) { setVerifyError(e instanceof Error ? e.message : "Unable to check the audit trail"); }
    finally { setVerifying(false); }
  }

  const buttonClass = "inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60";
  return <div>
    <Header title="Audit Trail" description="Tamper-evident history of important staff and business actions" actions={<>
      <button onClick={verify} disabled={verifying} className={buttonClass}><ShieldCheck className="h-4 w-4"/>{verifying ? "Checking..." : "Verify audit trail"}</button>
      <button onClick={load} className={buttonClass}><RefreshCw className="h-4 w-4"/>Refresh</button>
    </>} />
    {verifyError && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{verifyError}</div>}
    {report && <div className={`mb-4 rounded-xl border p-4 text-sm ${report.ok ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-900"}`}>
      <div className="flex items-center gap-2 font-semibold">
        {report.ok ? <ShieldCheck className="h-5 w-5"/> : <ShieldAlert className="h-5 w-5"/>}
        <span>{report.ok ? "Audit trail intact" : "Audit trail problem found"}</span>
      </div>
      <div className="mt-2 space-y-1">
        <div><span>Entries checked:</span> <strong>{report.checked.toLocaleString()}</strong></div>
        {report.last && <div><span>Newest entry checked:</span> <strong>#{report.last.seq}</strong> <span className="text-xs opacity-80">{report.last.createdAt ? new Date(report.last.createdAt).toLocaleString() : ""}</span></div>}
        {report.problem && <div><span>{PROBLEM_TEXT[report.problem.kind] || "Problem at entry"}</span> <strong>#{report.problem.seq}</strong> <span className="text-xs opacity-80">{report.problem.createdAt ? new Date(report.problem.createdAt).toLocaleString() : ""}</span></div>}
        {report.unchainedSinceStart > 0 && <div><span>Entries since the chain started that are not linked to it:</span> <strong>{report.unchainedSinceStart}</strong></div>}
        {report.olderUnchained > 0 && <div className="text-xs opacity-80"><span>Entries from before v0.3.30 (not part of the chain):</span> {report.olderUnchained}</div>}
      </div>
      {!report.ok && <p className="mt-2 text-xs">Compare with a backup from before that date, and keep this computer and its backups locked away from untrusted people.</p>}
    </div>}
    <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="text-sm text-slate-500">Total recorded events</div><div className="mt-1 text-2xl font-semibold text-slate-900">{total.toLocaleString()}</div></div>
      <div className="rounded-xl border border-slate-200 bg-white p-4 sm:col-span-2"><div className="text-sm text-slate-500">Access</div><div className="mt-1 text-sm font-medium text-slate-800">Owner only · newest 50 events shown · sensitive credentials are excluded</div></div>
    </div>
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      {loading ? <div className="p-10 text-center text-sm text-slate-500">Loading audit records…</div> : error ? <div className="p-8 text-center text-sm text-red-600">{error}</div> : items.length === 0 ? <div className="p-10 text-center"><ClipboardList className="mx-auto mb-2 h-8 w-8 text-slate-300"/><div className="font-medium text-slate-700">No audit events yet</div><div className="mt-1 text-sm text-slate-500">Important changes will appear here as they are recorded.</div></div> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Date / Time</th><th className="px-4 py-3">Staff</th><th className="px-4 py-3">Action</th><th className="px-4 py-3">Record</th><th className="px-4 py-3">Details</th></tr></thead><tbody className="divide-y divide-slate-100">{items.map(item => <tr key={item.id} className="align-top"><td className="whitespace-nowrap px-4 py-3 text-slate-600"><div>{new Date(item.createdAt).toLocaleString()}</div>{item.seq != null && <div className="text-xs text-slate-400">#{item.seq}</div>}{item.ipAddress && <div className="text-xs text-slate-400">{item.ipAddress}</div>}</td><td className="px-4 py-3"><div className="font-medium text-slate-900">{item.actorName}</div><div className="text-xs text-slate-500">{item.actorRole}</div></td><td className="px-4 py-3"><span className="rounded-md bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">{item.action}</span></td><td className="px-4 py-3"><div className="font-medium text-slate-800">{item.entityType}</div><div className="max-w-[180px] truncate text-xs text-slate-500">{item.entityId || "—"}</div></td><td className="max-w-md px-4 py-3 text-slate-700"><div>{item.summary}</div>{item.details && <details className="mt-1"><summary className="cursor-pointer text-xs text-blue-700">View metadata</summary><pre className="mt-2 whitespace-pre-wrap break-all rounded bg-slate-50 p-2 text-xs">{prettyDetails(item.details)}</pre></details>}</td></tr>)}</tbody></table></div>}
    </div>
    <p className="mt-3 text-xs text-slate-500">Each entry carries a fingerprint of the entry before it, so changing or deleting an entry shows up when the trail is verified. Someone with full access to the database file could still rebuild the whole trail: keep this computer and its backups locked away from untrusted people.</p>
  </div>;
}
