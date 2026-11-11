"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Submit-to-LHDN + Check-status buttons, shared by credit notes and the monthly
 * consolidated e-Invoice. `submitUrl` / `submitBody` start the submission; the status
 * check posts { submissionUID, [idKey]: id } to /api/myinvois/status.
 */
export function SubmitButtons({
  submitUrl,
  submitBody,
  idKey,
  id,
  submissionUid,
  canSubmit,
  submitLabel = "Submit to LHDN",
  confirmText,
}: {
  submitUrl: string;
  submitBody?: Record<string, unknown>;
  idKey: "creditNoteId" | "consolidatedId";
  id?: string | null;
  submissionUid?: string | null;
  canSubmit: boolean;
  submitLabel?: string;
  confirmText: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [uid, setUid] = useState(submissionUid || "");
  const [recId, setRecId] = useState(id || "");

  async function submit() {
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch(submitUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submitBody || {}),
      });
      const d = await res.json();
      if (!res.ok) setMsg((d.error || "Failed") + (d.detail ? ": " + JSON.stringify(d.detail).slice(0, 300) : ""));
      else {
        setUid(d.submissionUID || "");
        if (d.id) setRecId(d.id);
        setMsg("Submitted. Wait a few seconds, then press Check Status.");
        router.refresh();
      }
    } catch {
      setMsg("Failed");
    }
    setBusy(false);
  }

  async function check() {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/myinvois/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionUID: uid, [idKey]: recId }),
      });
      const d = await res.json();
      setMsg(res.ok ? `LHDN status: ${d.status}` : d.error || "Failed");
      if (res.ok) router.refresh();
    } catch {
      setMsg("Failed");
    }
    setBusy(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canSubmit && (
        <button disabled={busy} onClick={submit} className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50">
          {submitLabel}
        </button>
      )}
      {uid && recId && (
        <button disabled={busy} onClick={check} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          Check Status
        </button>
      )}
      {msg && <span className="text-xs text-slate-600">{msg}</span>}
    </div>
  );
}
