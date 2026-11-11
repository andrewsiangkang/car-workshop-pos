"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function EInvoiceForm({
  orderId,
  initialUuid,
  initialLongId,
}: {
  orderId: string;
  initialUuid?: string | null;
  initialLongId?: string | null;
}) {
  const router = useRouter();
  const [uuid, setUuid] = useState(initialUuid || "");
  const [longId, setLongId] = useState(initialLongId || "");
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState("");
  const [submissionUID, setSubmissionUID] = useState("");

  async function save() {
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch(`/api/work-orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_einvoice", uuid, longId }),
      });
      const data = await res.json();
      if (!res.ok) setMsg(data.error || "Save failed");
      else {
        setMsg("Saved. QR will appear on the invoice.");
        router.refresh();
      }
    } catch {
      setMsg("Save failed");
    }
    setSaving(false);
  }

  async function submitToLhdn() {
    if (!confirm("Submit this invoice to LHDN MyInvois?")) return;
    setSubmitting(true);
    setMsg("");
    try {
      const res = await fetch("/api/myinvois/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error + (data.detail ? ": " + JSON.stringify(data.detail).slice(0, 200) : ""));
      } else {
        setSubmissionUID(data.submissionUID || "");
        if (data.uuid) setUuid(data.uuid);
        setMsg(data.message || "Submitted");
        router.refresh();
      }
    } catch (e) {
      setMsg("Submit failed");
    }
    setSubmitting(false);
  }

  async function checkStatus() {
    if (!submissionUID) return;
    setMsg("Checking...");
    const res = await fetch("/api/myinvois/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, submissionUID }),
    });
    const data = await res.json();
    if (data.longId) setLongId(data.longId);
    if (data.uuid) setUuid(data.uuid);
    setMsg(`Status: ${data.status || "unknown"}`);
    router.refresh();
  }

  return (
    <div className="no-print mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">LHDN MyInvois e-Invoice</h3>
      <p className="mb-3 text-xs text-slate-500">
        Fill UUID & Long ID manually, or click Submit to send to LHDN (requires Client ID/Secret in Settings and a digital certificate for production).
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">UUID</label>
          <input value={uuid} onChange={(e) => setUuid(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Long ID</label>
          <input value={longId} onChange={(e) => setLongId(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button onClick={save} disabled={saving || !uuid.trim()} className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm text-white disabled:opacity-50">
          {saving ? "Saving..." : "Save Manually"}
        </button>
        <button onClick={submitToLhdn} disabled={submitting} className="rounded-lg bg-blue-700 px-3 py-1.5 text-sm text-white disabled:opacity-50">
          {submitting ? "Submitting..." : "Submit to LHDN"}
        </button>
        {submissionUID && (
          <button onClick={checkStatus} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">
            Check Status
          </button>
        )}
        {msg && <span className="text-sm text-slate-600">{msg}</span>}
      </div>
    </div>
  );
}
