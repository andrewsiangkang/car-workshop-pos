"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/Dialog";

export type ConsentState = {
  reminderConsentAt: string | null;
  reminderOptOutAt: string | null;
  language: string | null;
};

const LANGUAGE_OPTIONS: Array<[string, string]> = [
  ["en", "English"],
  ["zh", "中文"],
  ["ms", "Bahasa Melayu"],
];

/**
 * Records a customer's answer about WhatsApp service reminders (POST /api/customers/[id]/consent).
 * "consent": the customer agreed (and in which language they want the reminders);
 * "optout": the customer does not want them. Used on the reminders page and the customer page.
 * 【中文】记录客户对 WhatsApp 保养提醒的回答：同意（并选择提醒语言）或退订。保养提醒页和客户页都用。
 */
export function ReminderConsentDialog({
  open,
  mode,
  customerId,
  defaultLanguage,
  onDone,
  onCancel,
}: {
  open: boolean;
  mode: "consent" | "optout";
  customerId: string;
  defaultLanguage: string;
  onDone: (state: ConsentState) => void;
  onCancel: () => void;
}) {
  const [language, setLanguage] = useState(defaultLanguage);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/customers/${encodeURIComponent(customerId)}/consent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "consent" ? { action: "consent", language } : { action: "optout" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Save failed");
        return;
      }
      onDone({
        reminderConsentAt: data.reminderConsentAt ?? null,
        reminderOptOutAt: data.reminderOptOutAt ?? null,
        language: data.language ?? null,
      });
    } catch {
      setError("Network error. Please retry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      open={open}
      busy={busy}
      error={error}
      danger={mode === "optout"}
      title={mode === "consent" ? "Record reminder consent" : "Record opt-out"}
      confirmLabel={mode === "consent" ? "Customer agreed" : "Stop reminders"}
      message={
        mode === "consent" ? (
          <div className="space-y-3">
            <p>Only record this after the customer has said yes to receiving service reminders by WhatsApp. They can stop them at any time.</p>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Reminder language</span>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                {LANGUAGE_OPTIONS.map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : (
          <p>No more WhatsApp service reminders will be offered for this customer until they agree again.</p>
        )
      }
      onConfirm={save}
      onCancel={onCancel}
    />
  );
}
