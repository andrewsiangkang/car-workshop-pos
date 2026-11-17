"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { PromptDialog } from "@/components/ui/Dialog";

/**
 * 【中文】作废按钮：在页面内的对话框里填写原因（必填），确认后作废（记录保留）。桌面版不支持 window.prompt()，所以改用页面对话框。
 * Void button: asks for a reason in an in-page dialog (window.prompt() does nothing in the
 * desktop app), keeps the record. The reason is sent exactly as typed; the API trims it.
 */
export function VoidButton({ url, label, confirmText }: { url: string; label: string; confirmText: ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function go(reason: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const d = await res.json();
      if (!res.ok) setError(d.error || "Failed");
      else {
        setOpen(false);
        router.refresh();
      }
    } catch {
      setError("Failed");
    }
    setBusy(false);
  }

  return (
    <div className="no-print">
      <button
        disabled={busy}
        onClick={() => {
          setError("");
          setOpen(true);
        }}
        className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
      >
        {label}
      </button>
      <PromptDialog
        open={open}
        title={label}
        message={confirmText}
        mode="textarea"
        label="Reason"
        required
        maxLength={300}
        confirmLabel={label}
        danger
        busy={busy}
        error={error}
        onConfirm={go}
        onCancel={() => {
          setOpen(false);
          setError("");
        }}
      />
    </div>
  );
}
