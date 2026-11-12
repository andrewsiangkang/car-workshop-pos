"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

const POLL_MAX = 12;
const POLL_INTERVAL_MS = 4000;
const TERMINAL = new Set(["valid", "invalid", "cancelled", "rejected"]);

/**
 * Submit-to-LHDN + Check-status buttons, shared by credit notes and the monthly
 * consolidated e-Invoice. `submitUrl` / `submitBody` start the submission; the status
 * check posts { submissionUID, [idKey]: id } to /api/myinvois/status.
 * After a successful submit, status is polled automatically until Long ID / terminal status.
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
  const [polling, setPolling] = useState(false);

  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollAttempt = useRef(0);
  const activeUid = useRef("");

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
    pollAttempt.current = 0;
    setPolling(false);
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  async function pollOnce(submissionUID: string, recordId: string) {
    try {
      const res = await fetch("/api/myinvois/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionUID, [idKey]: recordId }),
      });
      const d = await res.json();
      if (!res.ok) {
        setMsg(d.error || "Failed");
        return { done: true as const };
      }
      const status = String(d.status || "").toLowerCase();
      if (d.longId) {
        setMsg(`LHDN status: ${status || "valid"} · Long ID received`);
        router.refresh();
        return { done: true as const };
      }
      if (TERMINAL.has(status)) {
        setMsg(`LHDN status: ${status}`);
        router.refresh();
        return { done: true as const };
      }
      return { done: false as const, status: status || "pending" };
    } catch {
      setMsg("Failed");
      return { done: true as const };
    }
  }

  function startPolling(submissionUID: string, recordId: string) {
    stopPolling();
    if (!submissionUID || !recordId) return;
    activeUid.current = submissionUID;
    pollAttempt.current = 0;
    setPolling(true);
    setMsg("Submitted. Checking LHDN status…");

    const tick = async () => {
      if (activeUid.current !== submissionUID) return;
      pollAttempt.current += 1;
      const n = pollAttempt.current;
      setMsg(`Checking LHDN status… (${n}/${POLL_MAX})`);
      const result = await pollOnce(submissionUID, recordId);
      if (activeUid.current !== submissionUID) return;
      if (result.done) {
        stopPolling();
        return;
      }
      if (n >= POLL_MAX) {
        setMsg(
          `Still pending after ${POLL_MAX} checks. Press “Check Status” later, or wait a minute and try again.`
        );
        stopPolling();
        return;
      }
      pollTimer.current = setTimeout(tick, POLL_INTERVAL_MS);
    };

    pollTimer.current = setTimeout(tick, 2000);
  }

  async function submit() {
    if (!window.confirm(confirmText)) return;
    stopPolling();
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch(submitUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submitBody || {}),
      });
      const d = await res.json();
      if (!res.ok) {
        setMsg(d.error || "Failed");
      } else {
        const newUid = d.submissionUID || "";
        const newId = d.id || recId;
        setUid(newUid);
        if (d.id) setRecId(d.id);
        if (newUid && newId) startPolling(newUid, newId);
        else {
          setMsg("Submitted. Wait a few seconds, then press Check Status.");
        }
        router.refresh();
      }
    } catch {
      setMsg("Failed");
    }
    setBusy(false);
  }

  async function check() {
    if (!uid || !recId) return;
    stopPolling();
    setBusy(true);
    setMsg("Checking...");
    const result = await pollOnce(uid, recId);
    if (!result.done) setMsg(`LHDN status: ${result.status || "pending"}`);
    setBusy(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canSubmit && (
        <button
          disabled={busy || polling}
          onClick={submit}
          className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {submitLabel}
        </button>
      )}
      {uid && recId && (
        <button
          disabled={busy || polling}
          onClick={check}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {polling ? "Checking…" : "Check Status"}
        </button>
      )}
      {msg && <span className="text-xs text-slate-600">{msg}</span>}
    </div>
  );
}
