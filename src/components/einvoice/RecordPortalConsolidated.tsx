"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency } from "@/lib/utils";

/**
 * Boss only (the monthly page is owner-only): record a consolidated e-Invoice that was
 * submitted in the MyInvois portal. Submitting to LHDN production from this app is not
 * available yet, so this is how a real month gets reported. It links exactly the invoices
 * listed on the page (`orderIds`) with the credit notes netted in (`creditNoteIds`) and the
 * total shown; the server refuses if any of them changed meanwhile.
 * Only shown while Settings are on Production, so the page list is the real (production) one.
 */
// 【中文】登记老板在 MyInvois 网站提交的合并电子发票：只链接页面列出的发票和扣掉的退款单，总额必须一致；先记为待确认，再按「Check Status」向 LHDN 核对。
export function RecordPortalConsolidated({
  month,
  orderIds,
  creditNoteIds,
  count,
  total,
  defaultNumber,
}: {
  month: string;
  orderIds: string[];
  creditNoteIds: string[];
  count: number;
  total: number;
  defaultNumber: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [number, setNumber] = useState(defaultNumber);
  const [uuid, setUuid] = useState("");
  const [longId, setLongId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function save() {
    const ok = window.confirm(
      `Record UUID ${uuid.trim()} as the consolidated e-Invoice for ${month}? It will cover ${count} invoice(s)` +
        (creditNoteIds.length ? ` with ${creditNoteIds.length} credit note(s) netted off` : "") +
        `, total ${total.toFixed(2)}. The total in the MyInvois portal must be the same.`
    );
    if (!ok) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/einvoice/consolidated", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // The server checks these against what it would save (a credit note issued meanwhile is refused).
        body: JSON.stringify({ month, uuid: uuid.trim(), longId: longId.trim(), number: number.trim(), orderIds, creditNoteIds, total }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setMsg(d.error || "Save failed");
      else {
        setOpen(false);
        setMsg("Saved as pending. Press Check Status to confirm it with LHDN.");
        router.refresh();
      }
    } catch {
      setMsg("Save failed");
    }
    setBusy(false);
  }

  const input = "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm";
  return (
    <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <div className="font-semibold text-slate-900">Submitted in the MyInvois portal?</div>
          <p className="mt-1 text-sm text-slate-600">
            Sending to LHDN production from this app is not available yet. After you submit the consolidated e-Invoice in
            the MyInvois portal, record it here so these invoices count as reported.
          </p>
          <p className="mt-1 text-sm text-slate-700">
            {count} invoice(s) · {formatCurrency(total)}
          </p>
          {creditNoteIds.length > 0 && (
            <p className="text-xs text-slate-500">
              {creditNoteIds.length} credit note(s) netted off (shown in the Credit Notes column above)
            </p>
          )}
        </div>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-lg border border-violet-300 px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-50"
          >
            Record portal e-Invoice
          </button>
        )}
      </div>
      {open && (
        <div className="mt-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Document number</label>
              <input value={number} onChange={(e) => setNumber(e.target.value)} maxLength={50} className={input} />
              <p className="mt-1 text-xs text-slate-500">Type it exactly as the MyInvois portal shows it.</p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">UUID</label>
              <input value={uuid} onChange={(e) => setUuid(e.target.value)} className={input} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Long ID (optional)</label>
              <input value={longId} onChange={(e) => setLongId(e.target.value)} className={input} />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={busy || !uuid.trim() || !number.trim()}
              className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {busy ? "Saving..." : "Save portal e-Invoice"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={busy}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {msg && <div className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{msg}</div>}
    </div>
  );
}
