"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

export type BuyerRequest = {
  name: string;
  tin: string;
  idType: string;
  idNo: string;
  email: string;
  phone: string;
  address: string;
  postcode: string;
  city: string;
  state: string;
  requestedAt: string;
};

/** How many times to poll LHDN after submit, and the delay between polls (ms). */
const POLL_MAX = 12;
const POLL_INTERVAL_MS = 4000;

const TERMINAL = new Set(["valid", "invalid", "cancelled", "rejected"]);

export function EInvoiceForm({
  orderId,
  initialUuid,
  initialLongId,
  initialSubmissionUid,
  initialStatus,
  buyer,
}: {
  orderId: string;
  initialUuid?: string | null;
  initialLongId?: string | null;
  initialSubmissionUid?: string | null;
  initialStatus?: string | null;
  buyer?: BuyerRequest | null;
}) {
  const router = useRouter();
  const [uuid, setUuid] = useState(initialUuid || "");
  const [longId, setLongId] = useState(initialLongId || "");
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState("");
  const [submissionUID, setSubmissionUID] = useState(initialSubmissionUid || "");
  const [polling, setPolling] = useState(false);

  // Look up the customer's TIN at LHDN from their NRIC, then use it for this invoice.
  const [idType, setIdType] = useState(buyer?.idType || "NRIC");
  const [idNo, setIdNo] = useState(buyer?.idNo || "");
  const [bName, setBName] = useState(buyer?.name || "");
  const [bTin, setBTin] = useState(buyer?.tin || "");
  const [finding, setFinding] = useState(false);
  const [lookupMsg, setLookupMsg] = useState("");

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

  // Clean up on unmount so we do not update state after leaving the page.
  useEffect(() => () => stopPolling(), [stopPolling]);

  async function pollOnce(uid: string) {
    if (!uid) return { done: true as const };
    try {
      const res = await fetch("/api/myinvois/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, submissionUID: uid }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error || "Status check failed");
        return { done: true as const };
      }
      if (data.uuid) setUuid(data.uuid);
      if (data.longId) setLongId(data.longId);
      const status = String(data.status || "").toLowerCase();
      if (data.longId) {
        setMsg(`Status: ${status || "valid"} · Long ID received. QR will appear on the invoice.`);
        router.refresh();
        return { done: true as const };
      }
      if (TERMINAL.has(status)) {
        setMsg(
          `Status: ${status}${status === "valid" ? " (no Long ID yet — try Check Status again)" : ""}`
        );
        router.refresh();
        return { done: true as const };
      }
      return { done: false as const, status: status || "pending" };
    } catch {
      setMsg("Status check failed");
      return { done: true as const };
    }
  }

  function startPolling(uid: string) {
    stopPolling();
    if (!uid) return;
    activeUid.current = uid;
    pollAttempt.current = 0;
    setPolling(true);
    setMsg("Submitted. Checking LHDN status…");

    const tick = async () => {
      if (activeUid.current !== uid) return;
      pollAttempt.current += 1;
      const n = pollAttempt.current;
      setMsg(`Checking LHDN status… (${n}/${POLL_MAX})`);
      const result = await pollOnce(uid);
      if (activeUid.current !== uid) return;
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

    // First check after a short delay so LHDN has time to accept the batch.
    pollTimer.current = setTimeout(tick, 2000);
  }

  // Resume polling after refresh if LHDN still has no Long ID.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current) return;
    const uid = initialSubmissionUid || "";
    if (!uid || initialLongId) return;
    const st = (initialStatus || "").toLowerCase();
    if (st && TERMINAL.has(st) && st !== "valid") return;
    resumed.current = true;
    startPolling(uid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function findTin() {
    setFinding(true);
    setLookupMsg("");
    try {
      const res = await fetch("/api/myinvois/tin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idType, idNo, name: bName }),
      });
      const data = await res.json();
      if (!res.ok) setLookupMsg(data.error || "Lookup failed");
      else {
        setBTin(data.tin);
        setLookupMsg("TIN found. Check the name, then click Use for this invoice.");
      }
    } catch {
      setLookupMsg("Lookup failed");
    }
    setFinding(false);
  }

  async function useBuyer() {
    setFinding(true);
    setLookupMsg("");
    try {
      const res = await fetch(`/api/work-orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_buyer", idType, idNo, tin: bTin, name: bName }),
      });
      const data = await res.json();
      if (!res.ok) setLookupMsg(data.error || "Save failed");
      else {
        setLookupMsg("Saved. “Submit to LHDN” will use these details.");
        router.refresh();
      }
    } catch {
      setLookupMsg("Save failed");
    }
    setFinding(false);
  }

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
    stopPolling();
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
        const uid = data.submissionUID || "";
        setSubmissionUID(uid);
        if (data.uuid) setUuid(data.uuid);
        if (uid) startPolling(uid);
        else setMsg(data.message || "Submitted");
        router.refresh();
      }
    } catch {
      setMsg("Submit failed");
    }
    setSubmitting(false);
  }

  async function checkStatus() {
    if (!submissionUID) return;
    stopPolling();
    setMsg("Checking...");
    const result = await pollOnce(submissionUID);
    if (!result.done) {
      setMsg(`Status: ${result.status || "pending"}`);
    }
  }

  return (
    <div className="no-print mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">LHDN MyInvois e-Invoice</h3>
      <p className="mb-3 text-xs text-slate-500">
        Fill UUID & Long ID manually, or click Submit to send to LHDN (requires Client ID/Secret in Settings
        and a digital certificate for production). After submit, status is checked automatically until a Long
        ID is returned.
      </p>
      {!uuid && buyer && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
          <div className="mb-1 font-semibold text-emerald-800">Buyer details saved for this invoice</div>
          <div className="grid grid-cols-1 gap-x-6 gap-y-0.5 text-slate-700 sm:grid-cols-2">
            <div>Name: {buyer.name}</div>
            <div>TIN: {buyer.tin}</div>
            <div>
              {buyer.idType}: {buyer.idNo}
            </div>
          </div>
          <div className="mt-1 text-xs text-slate-500">“Submit to LHDN” below uses these details.</div>
        </div>
      )}
      {!uuid && (
        <div className="mb-4 rounded-lg border border-slate-200 p-3">
          <div className="mb-2 text-sm font-medium text-slate-700">Find customer TIN by NRIC / Passport / SSM</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <select
              value={idType}
              onChange={(e) => setIdType(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="NRIC">NRIC</option>
              <option value="PASSPORT">Passport</option>
              <option value="BRN">BRN (SSM)</option>
              <option value="ARMY">Army</option>
            </select>
            <input
              value={idNo}
              onChange={(e) => setIdNo(e.target.value)}
              placeholder="ID number"
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <input
              value={bName}
              onChange={(e) => setBName(e.target.value)}
              placeholder="Customer name"
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <input
              value={bTin}
              onChange={(e) => setBTin(e.target.value)}
              placeholder="TIN"
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={findTin}
              disabled={finding || !idNo.trim()}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {finding ? "Working..." : "Find TIN"}
            </button>
            <button
              type="button"
              onClick={useBuyer}
              disabled={finding || !bTin.trim() || !bName.trim() || !idNo.trim()}
              className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              Use for this invoice
            </button>
            {lookupMsg && <span className="text-sm text-slate-600">{lookupMsg}</span>}
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">UUID</label>
          <input
            value={uuid}
            onChange={(e) => setUuid(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Long ID</label>
          <input
            value={longId}
            onChange={(e) => setLongId(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={save}
          disabled={saving || !uuid.trim()}
          className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Manually"}
        </button>
        <button
          onClick={submitToLhdn}
          disabled={submitting || polling}
          className="rounded-lg bg-blue-700 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {submitting ? "Submitting..." : "Submit to LHDN"}
        </button>
        {submissionUID && (
          <button
            onClick={checkStatus}
            disabled={polling}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {polling ? "Checking…" : "Check Status"}
          </button>
        )}
        {msg && <span className="text-sm text-slate-600">{msg}</span>}
      </div>
    </div>
  );
}
