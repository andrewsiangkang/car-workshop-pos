"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Pencil, ShieldOff, BellRing, BellOff } from "lucide-react";
import { MY_STATES } from "@/lib/my-states";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { ReminderConsentDialog } from "@/components/customers/ReminderConsentDialog";

export type CustomerView = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  tin: string | null;
  address: string | null;
  postcode: string | null;
  city: string | null;
  stateCode: string | null;
  notes: string | null;
  language: string | null;
  reminderConsentAt: string | null;
  reminderOptOutAt: string | null;
  anonymisedAt: string | null;
};

const LANGUAGE_LABEL: Record<string, string> = { en: "English", zh: "中文", ms: "Bahasa Melayu" };
const input =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const label = "mb-1 block text-xs font-medium text-slate-600";
const button = "inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60";

function day(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString() : "";
}

function Row({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2 py-1.5 text-sm">
      <div className="text-slate-500">{name}</div>
      <div className="col-span-2 break-words text-slate-900">{children}</div>
    </div>
  );
}

/**
 * Customer page actions. Everyone: see the reminder consent and record consent / opt-out.
 * Boss only: correct the details (incl. the address used on invoices), export the customer's data
 * as a file, anonymise the record (PDPA).
 * 【中文】客户页面：所有人可以记录提醒同意 / 退订；老板可以更正资料（包括发票地址）、导出资料、匿名化（PDPA）。
 */
export function CustomerDetail({
  owner,
  customer,
  defaultLanguage,
  recentTaxDocuments,
}: {
  owner: boolean;
  customer: CustomerView;
  defaultLanguage: string;
  recentTaxDocuments: { count: number; latest: string | null };
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [consentMode, setConsentMode] = useState<"consent" | "optout" | null>(null);
  const [anonymising, setAnonymising] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [anonError, setAnonError] = useState("");
  const [busy, setBusy] = useState(false);
  const anonymised = !!customer.anonymisedAt;

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const body = Object.fromEntries(new FormData(e.currentTarget).entries());
    try {
      const res = await fetch(`/api/customers/${encodeURIComponent(customer.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Save failed");
      } else {
        setEditing(false);
        setMessage("Saved successfully");
        router.refresh();
      }
    } catch {
      setError("Network error. Please retry.");
    }
    setSaving(false);
  }

  async function exportData() {
    setMessage("");
    setError("");
    try {
      const res = await fetch(`/api/customers/${encodeURIComponent(customer.id)}/export`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Export failed");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `customer-data-${customer.id}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMessage("Customer data file downloaded");
    } catch {
      setError("Export failed");
    }
  }

  async function anonymise() {
    if (recentTaxDocuments.count > 0 && !understood) {
      setAnonError("Tick the box to confirm you understand the 7-year record-keeping duty");
      return;
    }
    setBusy(true);
    setAnonError("");
    try {
      const res = await fetch(`/api/customers/${encodeURIComponent(customer.id)}/anonymise`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmRecordKeeping: understood }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAnonError(data.error || "Anonymising failed");
      } else {
        setAnonymising(false);
        setMessage("Customer anonymised");
        router.refresh();
      }
    } catch {
      setAnonError("Network error. Please retry.");
    }
    setBusy(false);
  }

  const reminderStatus = anonymised ? (
    <span>Off (customer anonymised)</span>
  ) : customer.reminderOptOutAt ? (
    <span className="text-red-700">
      <span>Opted out</span> {day(customer.reminderOptOutAt)}
    </span>
  ) : customer.reminderConsentAt ? (
    <span className="text-emerald-700">
      <span>Agreed</span> {day(customer.reminderConsentAt)}
    </span>
  ) : (
    <span className="text-slate-500">No consent recorded</span>
  );

  return (
    <div className="space-y-4">
      {anonymised && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          <div className="font-medium">
            <span>This customer was anonymised on</span> {day(customer.anonymisedAt)}
          </div>
          <div className="mt-1">Their invoices and amounts are kept. Documents that must still be kept print the customer&apos;s details as before.</div>
        </div>
      )}
      {message && <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{message}</div>}
      {error && !editing && <div className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        {!editing ? (
          <>
            <div className="divide-y divide-slate-100">
              <Row name="Phone">{customer.phone || "-"}</Row>
              {owner && (
                <>
                  <Row name="Email">{customer.email || "-"}</Row>
                  <Row name="TIN">{customer.tin || "-"}</Row>
                  <Row name="Address">
                    {[customer.address, [customer.postcode, customer.city].filter(Boolean).join(" "), customer.stateCode ? MY_STATES[customer.stateCode] : ""]
                      .filter(Boolean)
                      .join(", ") || "-"}
                  </Row>
                </>
              )}
              <Row name="Notes">{customer.notes || "-"}</Row>
              <Row name="WhatsApp reminders">{reminderStatus}</Row>
              <Row name="Reminder language">{LANGUAGE_LABEL[customer.language || defaultLanguage] || "English"}</Row>
            </div>
            {!anonymised && (
              <div className="mt-4 flex flex-wrap gap-2">
                {customer.reminderConsentAt && !customer.reminderOptOutAt ? (
                  <button type="button" onClick={() => setConsentMode("optout")} className={button}>
                    <BellOff className="h-4 w-4" />
                    Record opt-out
                  </button>
                ) : (
                  <button type="button" onClick={() => setConsentMode("consent")} className={button}>
                    <BellRing className="h-4 w-4" />
                    Record consent
                  </button>
                )}
                {owner && (
                  <>
                    <button type="button" onClick={() => { setError(""); setMessage(""); setEditing(true); }} className={button}>
                      <Pencil className="h-4 w-4" />
                      Edit details
                    </button>
                    <button type="button" onClick={exportData} className={button}>
                      <Download className="h-4 w-4" />
                      Export this customer&apos;s data
                    </button>
                    <button
                      type="button"
                      onClick={() => { setAnonError(""); setUnderstood(false); setAnonymising(true); }}
                      className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
                    >
                      <ShieldOff className="h-4 w-4" />
                      Anonymise
                    </button>
                  </>
                )}
              </div>
            )}
            {anonymised && owner && (
              <div className="mt-4">
                <button type="button" onClick={exportData} className={button}>
                  <Download className="h-4 w-4" />
                  Export this customer&apos;s data
                </button>
              </div>
            )}
          </>
        ) : (
          <form onSubmit={save} className="space-y-3">
            {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label><span className={label}>Name *</span><input name="name" required maxLength={200} defaultValue={customer.name} className={input} /></label>
              <label><span className={label}>Phone</span><input name="phone" inputMode="tel" defaultValue={customer.phone === "N/A" ? "" : customer.phone} className={input} /></label>
              <label><span className={label}>Email</span><input name="email" type="email" maxLength={200} defaultValue={customer.email ?? ""} className={input} /></label>
              <label><span className={label}>TIN</span><input name="tin" maxLength={20} defaultValue={customer.tin ?? ""} className={input} /></label>
              <label className="sm:col-span-2"><span className={label}>Address (max 150 characters)</span><input name="address" maxLength={150} defaultValue={customer.address ?? ""} className={input} /></label>
              <label><span className={label}>Postcode</span><input name="postcode" inputMode="numeric" maxLength={5} pattern="\d{5}" title="5 digits" defaultValue={customer.postcode ?? ""} className={input} /></label>
              <label><span className={label}>City</span><input name="city" maxLength={50} defaultValue={customer.city ?? ""} className={input} /></label>
              <label>
                <span className={label}>State</span>
                <select name="stateCode" defaultValue={customer.stateCode ?? ""} className={input}>
                  <option value="">-</option>
                  {Object.entries(MY_STATES).map(([code, name]) => (
                    <option key={code} value={code}>{name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className={label}>Reminder language</span>
                <select name="language" defaultValue={customer.language ?? ""} className={input}>
                  <option value="">Same as the shop</option>
                  <option value="en">English</option>
                  <option value="zh">中文</option>
                  <option value="ms">Bahasa Melayu</option>
                </select>
              </label>
              <label className="sm:col-span-2"><span className={label}>Notes</span><textarea name="notes" rows={2} defaultValue={customer.notes ?? ""} className={input} /></label>
            </div>
            <p className="text-xs text-slate-500">Invoices issued since v0.3.29 keep the details they were printed with; older invoices reprint with the new details.</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setEditing(false); setError(""); }} className="rounded-lg border border-slate-200 px-4 py-2 text-sm">Cancel</button>
              <button disabled={saving} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving..." : "Save"}</button>
            </div>
          </form>
        )}
      </div>

      {consentMode && (
        <ReminderConsentDialog
          key={consentMode}
          open
          mode={consentMode}
          customerId={customer.id}
          defaultLanguage={customer.language || defaultLanguage}
          onDone={() => { setConsentMode(null); router.refresh(); }}
          onCancel={() => setConsentMode(null)}
        />
      )}

      <ConfirmDialog
        open={anonymising}
        danger
        busy={busy}
        error={anonError}
        title="Anonymise this customer?"
        confirmLabel="Anonymise"
        onConfirm={anonymise}
        onCancel={() => setAnonymising(false)}
        message={
          <div className="space-y-2">
            <p>The name, phone, e-mail, TIN, address and notes are removed, the car&apos;s VIN and service reminder are cleared, and no reminders are sent again. This cannot be undone.</p>
            <p>Invoices, receipts, credit notes and amounts are kept, because tax records must be kept for 7 years after the end of their year. Documents still inside that period keep printing the customer&apos;s details as they do today.</p>
            {recentTaxDocuments.count > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
                <div>
                  <span>Documents still inside the 7-year keeping period:</span> <strong>{recentTaxDocuments.count}</strong>
                  {recentTaxDocuments.latest && <> · <span>latest</span> {day(recentTaxDocuments.latest)}</>}
                </div>
                <label className="mt-2 flex items-start gap-2">
                  <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} className="mt-0.5" />
                  <span>I understand these documents must still be kept for 7 years and keep showing this customer&apos;s details.</span>
                </label>
              </div>
            )}
          </div>
        }
      />
    </div>
  );
}
