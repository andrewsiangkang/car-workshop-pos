"use client";

import { useState } from "react";
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

export function EInvoiceForm({
  orderId,
  initialUuid,
  initialLongId,
  buyer,
  requestUrl,
}: {
  orderId: string;
  initialUuid?: string | null;
  initialLongId?: string | null;
  buyer?: BuyerRequest | null;
  requestUrl?: string | null;
}) {
  const router = useRouter();
  const [uuid, setUuid] = useState(initialUuid || "");
  const [longId, setLongId] = useState(initialLongId || "");
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState("");
  const [submissionUID, setSubmissionUID] = useState("");

  const [copied, setCopied] = useState(false);

  // Look up the customer's TIN at LHDN from their NRIC, then use it for this invoice.
  const [idType, setIdType] = useState(buyer?.idType || "NRIC");
  const [idNo, setIdNo] = useState(buyer?.idNo || "");
  const [bName, setBName] = useState(buyer?.name || "");
  const [bTin, setBTin] = useState(buyer?.tin || "");
  const [finding, setFinding] = useState(false);
  const [lookupMsg, setLookupMsg] = useState("");

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
  async function copyLink() {
    if (!requestUrl) return;
    try {
      await navigator.clipboard.writeText(requestUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
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
      {!uuid && (
        <div className={`mb-4 rounded-lg border p-3 text-sm ${buyer ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}>
          {buyer ? (
            <>
              <div className="mb-1 font-semibold text-emerald-800">Customer sent their e-Invoice details (by QR)</div>
              <div className="grid grid-cols-1 gap-x-6 gap-y-0.5 text-slate-700 sm:grid-cols-2">
                <div>Name: {buyer.name}</div>
                <div>TIN: {buyer.tin}</div>
                <div>{buyer.idType}: {buyer.idNo}</div>
                <div>Phone: {buyer.phone || "-"}</div>
                <div>Email: {buyer.email || "-"}</div>
                <div className="sm:col-span-2">
                  Address: {buyer.address}, {buyer.postcode} {buyer.city}, {buyer.state}
                </div>
              </div>
              <div className="mt-1 text-xs text-slate-500">Sent {buyer.requestedAt}. “Submit to LHDN” below uses these details.</div>
            </>
          ) : (
            <div className="text-slate-600">
              Waiting for the customer to scan the QR code on the invoice / receipt and fill in their details.
              Without it, the invoice is reported in the monthly consolidated e-Invoice.
            </div>
          )}
          {requestUrl && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="break-all">{requestUrl}</span>
              <button type="button" onClick={copyLink} className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700">
                {copied ? "Copied ✓" : "Copy link"}
              </button>
            </div>
          )}
        </div>
      )}
      {!uuid && (
        <div className="mb-4 rounded-lg border border-slate-200 p-3">
          <div className="mb-2 text-sm font-medium text-slate-700">Find customer TIN by NRIC</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
            <select value={idType} onChange={(e) => setIdType(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <option value="NRIC">NRIC</option>
              <option value="PASSPORT">Passport</option>
              <option value="BRN">BRN (SSM)</option>
              <option value="ARMY">Army</option>
            </select>
            <input value={idNo} onChange={(e) => setIdNo(e.target.value)} placeholder="ID number (no dashes)" inputMode="numeric" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            <input value={bName} onChange={(e) => setBName(e.target.value)} placeholder="Customer name" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            <input value={bTin} onChange={(e) => setBTin(e.target.value)} placeholder="TIN" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={findTin} disabled={finding || !idNo.trim()} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50">
              {finding ? "Working..." : "Find TIN"}
            </button>
            <button type="button" onClick={useBuyer} disabled={finding || !bTin.trim() || !bName.trim() || !idNo.trim()} className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm text-white disabled:opacity-50">
              Use for this invoice
            </button>
            {lookupMsg && <span className="text-sm text-slate-600">{lookupMsg}</span>}
          </div>
        </div>
      )}
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
