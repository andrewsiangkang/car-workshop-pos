"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/components/layout/UserProvider";
import { MY_STATES } from "@/lib/my-states";
import { isFinalStatus, isLiveEInvoice } from "@/lib/einvoice-state.mjs";
import { UNCONFIRMED, inFlightFor, submitGate } from "@/lib/einvoice2-submit.mjs";
import { GENERAL_PUBLIC_TIN } from "@/lib/einvoice2-ids.mjs";

export type BuyerRequest = {
  name: string;
  /** "" for a Malaysian individual who gave no TIN (LHDN's general TIN is then sent with the IC). */
  tin: string;
  idType: string;
  idNo: string;
  email: string;
  phone: string;
  address: string;
  postcode: string;
  city: string;
  state: string;
  /** LHDN state code ("01".."16"), for the editable state box. */
  stateCode?: string;
  requestedAt: string;
};

/** States a buyer address can be in (17 "Not Applicable" is not a real address). */
const STATE_OPTIONS = Object.entries(MY_STATES).filter(([code]) => code !== "17");

/** How many times to poll LHDN after submit, and the delay between polls (ms). */
const POLL_MAX = 12;
const POLL_INTERVAL_MS = 4000;

/** Status-route answers for a submission LHDN did not answer (see einvoice2-submit.mjs). */
const SETTLING = new Set([UNCONFIRMED, "not_received"]);

/** Unanswered, or a claim left behind: only Check Status settles it (the server's submitGate rule). */
function needsCheck(status: string | null | undefined, submittingAt: string | null | undefined) {
  return (status || "").toLowerCase() === UNCONFIRMED || submitGate({ eInvoiceStatus: status, eInvoiceSubmittingAt: submittingAt }).action === "lookup";
}

export function EInvoiceForm({
  orderId,
  initialUuid,
  initialLongId,
  initialSubmissionUid,
  initialStatus,
  initialEnv,
  initialSubmittingAt,
  buyer,
  defaults,
  consolidatedLock,
  buyerLocked,
  settingsEnv,
}: {
  orderId: string;
  initialUuid?: string | null;
  initialLongId?: string | null;
  initialSubmissionUid?: string | null;
  initialStatus?: string | null;
  /** LHDN system the saved reference belongs to: "sandbox" | "production". */
  initialEnv?: string | null;
  /** When the last submission claimed the invoice (ISO), if the claim is still held. */
  initialSubmittingAt?: string | null;
  buyer?: BuyerRequest | null;
  /** Start values for the buyer boxes when there is no buyer request yet (the buyer printed on the invoice). */
  defaults?: Partial<BuyerRequest> | null;
  /** The invoice is in a real monthly consolidated e-Invoice: buyer and individual submit are closed. */
  consolidatedLock?: boolean;
  /** The server's buyer lock (buyerEditLock with the Settings environment): save_buyer would be refused. */
  buyerLocked?: boolean;
  /** LHDN system Settings are on. */
  settingsEnv?: "sandbox" | "production";
}) {
  const router = useRouter();
  const { isOwner } = useUser();
  const [uuid, setUuid] = useState(initialUuid || "");
  // Manual references are normally real e-Invoices issued in the MyInvois portal, so a new or
  // different UUID defaults to the portal. Only re-saving the stored sandbox UUID stays sandbox
  // (defaulting that to the portal would turn a test result into a "real" e-Invoice). A choice
  // the boss makes in the box always wins.
  // 【中文】手动填的通常是 MyInvois 网站开出的正式电子发票：新的 UUID 默认“正式”；只有重新保存原来的沙盒 UUID 才默认沙盒；老板手动选择的永远优先。
  const [envChoice, setEnvChoice] = useState<"production" | "sandbox" | null>(null);
  const env: "production" | "sandbox" =
    envChoice ?? (initialEnv === "sandbox" && uuid.trim() === (initialUuid || "").trim() ? "sandbox" : "production");
  const [longId, setLongId] = useState(initialLongId || "");
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState("");
  const [submissionUID, setSubmissionUID] = useState(initialSubmissionUid || "");
  const [polling, setPolling] = useState(false);
  // The last submission got no answer from LHDN, or its claim was left behind (the app closed
  // while sending): it may have arrived, so Check Status comes first (the server's submitGate rule).
  // 【中文】上次提交没回应，或送出时程序被关掉留下占位：可能已到 LHDN，先按「检查状态」（与服务器 submitGate 同一规则）。
  const [unconfirmed, setUnconfirmed] = useState(() => needsCheck(initialStatus, initialSubmittingAt));
  useEffect(() => setUnconfirmed(needsCheck(initialStatus, initialSubmittingAt)), [initialStatus, initialSubmittingAt]);
  // ...unless it is only an unanswered SANDBOX test while Settings are on production: the server does
  // not lock the real buyer for it (inFlightFor), and it can only be checked with Settings on sandbox.
  // 【中文】……如果只是沙盒测试没回应、而设置在正式环境：服务器不会因此锁住买方，也只能把设置切回沙盒才查得到。
  const sandboxTestOnly =
    settingsEnv === "production" &&
    needsCheck(initialStatus, initialSubmittingAt) &&
    !inFlightFor(
      { eInvoiceUuid: initialUuid, eInvoiceStatus: initialStatus, eInvoiceEnv: initialEnv, eInvoiceSubmittingAt: initialSubmittingAt },
      "production"
    );

  // Look up the customer's TIN at LHDN from their NRIC, then use it for this invoice.
  // The boxes start from the buyer request, else from the buyer printed on the invoice, so saving
  // never blanks an address the invoice already shows. 【中文】表格先填买方资料；没有的话填发票上印的买方，保存时不会清掉地址。
  const start = buyer ?? defaults ?? null;
  const [idType, setIdType] = useState(start?.idType || "NRIC");
  const [idNo, setIdNo] = useState(start?.idNo || "");
  const [bName, setBName] = useState(start?.name || "");
  const [bTin, setBTin] = useState(start?.tin || "");
  const [bPhone, setBPhone] = useState(start?.phone || "");
  // Saved together with the buyer and replacing what the QR request stored (save_buyer).
  const [bEmail, setBEmail] = useState(start?.email || "");
  const [bAddress, setBAddress] = useState(start?.address || "");
  const [bPostcode, setBPostcode] = useState(start?.postcode || "");
  const [bCity, setBCity] = useState(start?.city || "");
  const [bState, setBState] = useState(STATE_OPTIONS.some(([code]) => code === start?.stateCode) ? start?.stateCode || "" : "");
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
    try {
      const res = await fetch("/api/myinvois/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The server always checks this invoice's own stored submission (or its UUID).
        body: JSON.stringify(uid ? { orderId, submissionUID: uid } : { orderId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error || "Status check failed");
        return { done: true as const };
      }
      if (data.uuid) setUuid(data.uuid);
      if (data.longId) setLongId(data.longId);
      const status = String(data.status || "").toLowerCase();
      if (SETTLING.has(status) || data.message) {
        // An unanswered submission: LHDN does not show it yet, never got it, or has it (saved now).
        setMsg(data.message || status);
        if (!SETTLING.has(status) || status === "not_received") setUnconfirmed(false);
        router.refresh();
        return { done: true as const };
      }
      if (data.longId) {
        setMsg(`Status: ${status || "valid"} · Long ID received. QR will appear on the invoice.`);
        router.refresh();
        return { done: true as const };
      }
      if (isFinalStatus(status)) {
        // An invalid document: LHDN's own reason, then what to fix here (phone, address, TIN…).
        setMsg(
          `Status: ${status}${status === "valid" ? " (no Long ID yet — try Check Status again)" : ""}` +
            (data.reason ? `\nLHDN: ${data.reason}` : "") +
            (data.advice ? `\n${data.advice}` : "")
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
    if (st && isFinalStatus(st) && st !== "valid") return;
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
        body: JSON.stringify({
          action: "save_buyer", idType, idNo, tin: bTin, name: bName, phone: bPhone,
          email: bEmail, address: bAddress, postcode: bPostcode, city: bCity, stateCode: bState,
        }),
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

  async function save(replace = false) {
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch(`/api/work-orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_einvoice", uuid, longId, environment: env, replace }),
      });
      const data = await res.json();
      if (res.status === 409 && data.code === "LIVE_UUID_EXISTS" && !replace) {
        setSaving(false);
        if (confirm(data.error)) return save(true);
        return;
      }
      if (!res.ok) setMsg(data.error || "Save failed");
      else {
        setMsg("Saved as pending. Press Check Status to confirm it with LHDN.");
        router.refresh();
      }
    } catch {
      setMsg("Save failed");
    }
    setSaving(false);
  }

  async function removeReference() {
    if (
      !confirm(
        "Remove this e-Invoice reference from the invoice? Only do this if it was typed in by mistake: the invoice then counts as not reported to LHDN and goes into the monthly consolidated e-Invoice."
      )
    )
      return;
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch(`/api/work-orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear_einvoice" }),
      });
      const data = await res.json();
      if (!res.ok) setMsg(data.error || "Save failed");
      else {
        setUuid("");
        setLongId("");
        setEnvChoice(null);
        setMsg("Reference removed.");
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
        if (data.code === "UNCONFIRMED" || data.code === "UNCONFIRMED_WAIT" || data.code === "UNCONFIRMED_UNSURE") setUnconfirmed(true);
        if (data.code === "UNCONFIRMED" || data.code === "ALREADY_AT_LHDN") router.refresh();
        setMsg((data.error || "Submit failed") + (data.detail ? "\n[LHDN] " + (typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail)) : ""));
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
    if (!submissionUID && !initialUuid && !unconfirmed) return;
    stopPolling();
    setMsg("Checking...");
    const result = await pollOnce(submissionUID);
    if (!result.done) {
      setMsg(`Status: ${result.status || "pending"}`);
    }
  }

  // The buyer can be fixed while LHDN does not count this sale as reported by its own e-Invoice:
  // no reference yet, one LHDN marked invalid / cancelled / rejected ("fix it, then submit
  // again"), or a sandbox test. Same rule as save_buyer on the server (buyerEditLock with the
  // Settings environment, passed in as buyerLocked). While a submission got no answer the buyer is
  // kept as sent, until Check Status settles it, except an unanswered sandbox test while Settings
  // are on production (the server does not lock for it either).
  // 【中文】还没有电子发票、LHDN 判为无效 / 已作废 / 已拒绝、或只是沙盒测试时，都可以修改买方资料（与服务器 save_buyer 规则相同）；上次提交没回应时先锁定（设置在正式环境时，沙盒测试没回应不锁）。
  const buyerEditable =
    !buyerLocked && !consolidatedLock && !(unconfirmed && !sandboxTestOnly) &&
    !isLiveEInvoice({ eInvoiceUuid: initialUuid, eInvoiceStatus: initialStatus, eInvoiceEnv: initialEnv });
  // A Malaysian individual (IC) may leave the TIN blank; everyone else needs it (LHDN guideline).
  const tinOptional = idType === "NRIC";

  return (
    <div className="no-print mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">LHDN MyInvois e-Invoice</h3>
      <p className="mb-3 text-xs text-slate-500">
        Fill UUID & Long ID manually, or click Submit to send to LHDN (requires Client ID/Secret in Settings
        and a digital certificate for production). After submit, status is checked automatically until a Long
        ID is returned.
      </p>
      {consolidatedLock && !uuid && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          This invoice was already reported to LHDN in the monthly consolidated e-Invoice (as General Public). Its buyer
          can no longer be changed and it cannot be submitted on its own. If the customer needs their own e-Invoice,
          issue a credit note and a new invoice.
        </div>
      )}
      {buyerEditable && buyer && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
          <div className="mb-1 font-semibold text-emerald-800">Buyer details saved for this invoice</div>
          <div className="grid grid-cols-1 gap-x-6 gap-y-0.5 text-slate-700 sm:grid-cols-2">
            <div>Name: {buyer.name}</div>
            <div>
              TIN: {buyer.tin || GENERAL_PUBLIC_TIN}
              {!buyer.tin && <span className="ml-1 text-xs text-slate-500">(LHDN general TIN for individuals)</span>}
            </div>
            <div>
              {buyer.idType}: {buyer.idNo}
            </div>
          </div>
          <div className="mt-1 text-xs text-slate-500">“Submit to LHDN” below uses these details.</div>
        </div>
      )}
      {buyerEditable && (
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
              placeholder={tinOptional ? "TIN (optional for IC)" : "TIN"}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <input
              value={bPhone}
              onChange={(e) => setBPhone(e.target.value)}
              placeholder="Buyer phone (needed by LHDN)"
              inputMode="tel"
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div className="mt-2 text-xs text-slate-500">
            {tinOptional
              ? "Most people do not know their TIN. For a Malaysian with an IC you may leave TIN blank: the e-Invoice then uses LHDN's general TIN for individuals (EI00000000010) with the IC number, as LHDN's guideline allows."
              : "A company (BRN), passport or army ID needs its TIN. Use Find TIN if the customer does not know it."}
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Buyer address and email (optional; printed on the invoice and sent to LHDN). Clear them if they belong to someone else.
          </div>
          <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <input
              value={bAddress}
              onChange={(e) => setBAddress(e.target.value)}
              placeholder="Street Address"
              maxLength={150}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm lg:col-span-2"
            />
            <input
              value={bPostcode}
              onChange={(e) => setBPostcode(e.target.value)}
              placeholder="Postcode"
              inputMode="numeric"
              maxLength={5}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <input
              value={bCity}
              onChange={(e) => setBCity(e.target.value)}
              placeholder="City"
              maxLength={50}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <select
              value={bState}
              onChange={(e) => setBState(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="">Select state…</option>
              {STATE_OPTIONS.map(([code, label]) => (
                <option key={code} value={code} data-no-i18n="">
                  {label}
                </option>
              ))}
            </select>
            <input
              value={bEmail}
              onChange={(e) => setBEmail(e.target.value)}
              placeholder="Email"
              type="email"
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm sm:col-span-2 lg:col-span-5"
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
              disabled={finding || (!bTin.trim() && !tinOptional) || !bName.trim() || !idNo.trim()}
              className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              Use for this invoice
            </button>
            {lookupMsg && <span className="text-sm text-slate-600">{lookupMsg}</span>}
          </div>
        </div>
      )}
      {initialUuid && (initialStatus || "").toLowerCase() === "invalid" && !msg && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
          LHDN marked this e-Invoice invalid. Press Check Status to see the reason, fix it, then submit again.
        </div>
      )}
      {unconfirmed && !sandboxTestOnly && (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
          LHDN did not answer the last submission. It may still have arrived, so do not submit again yet: press Check Status.
        </div>
      )}
      {unconfirmed && sandboxTestOnly && (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
          An earlier SANDBOX test submission got no answer from LHDN. It is not a real e-Invoice and does not lock this invoice.
          It can only be checked with Settings on Sandbox.
        </div>
      )}
      {initialUuid && initialEnv === "sandbox" && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
          Sandbox test result: this is not a valid e-Invoice and does not count as reported to LHDN.
        </div>
      )}
      {isOwner ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Issued in</label>
              <select
                value={env}
                onChange={(e) => setEnvChoice(e.target.value === "sandbox" ? "sandbox" : "production")}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="production">MyInvois portal (real e-Invoice)</option>
                <option value="sandbox">Sandbox (test only)</option>
              </select>
            </div>
          </div>
        </>
      ) : (
        initialUuid && (
          <div className="text-xs text-slate-600">
            UUID: {initialUuid}
            {initialLongId ? ` · Long ID: ${initialLongId}` : ""}
          </div>
        )
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {isOwner ? (
          <>
            <button
              onClick={() => save()}
              disabled={saving || !uuid.trim()}
              className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Manually"}
            </button>
            {/* Only a reference typed in by hand (not this app's own submission). 【中文】只限手动登记的资料。 */}
            {initialUuid && !initialSubmissionUid && !unconfirmed && (
              <button
                onClick={removeReference}
                disabled={saving}
                className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                Remove reference
              </button>
            )}
          </>
        ) : (
          <span className="text-xs text-slate-500">Only the boss can type in an e-Invoice reference by hand.</span>
        )}
        <button
          onClick={submitToLhdn}
          disabled={submitting || polling || !!consolidatedLock || unconfirmed}
          className="rounded-lg bg-blue-700 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {submitting ? "Submitting..." : "Submit to LHDN"}
        </button>
        {(submissionUID || initialUuid || unconfirmed) && (
          <button
            onClick={checkStatus}
            disabled={polling}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {polling ? "Checking…" : "Check Status"}
          </button>
        )}
        {msg && <span className="whitespace-pre-wrap break-all text-sm text-slate-600">{msg}</span>}
      </div>
    </div>
  );
}
