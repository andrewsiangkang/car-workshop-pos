"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** 【中文】作废按钮：要求填写原因，确认后作废（记录保留）。 Void button: asks for a reason, keeps the record. */
export function VoidButton({ url, label, confirmText }: { url: string; label: string; confirmText: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function go() {
    const reason = window.prompt(confirmText + "\n\nReason:");
    if (reason == null) return;
    if (!reason.trim()) {
      setError("A reason is required");
      return;
    }
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
      else router.refresh();
    } catch {
      setError("Failed");
    }
    setBusy(false);
  }

  return (
    <div className="no-print">
      <button
        disabled={busy}
        onClick={go}
        className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
      >
        {label}
      </button>
      {error && <div className="mt-2 max-w-md text-xs text-red-700">{error}</div>}
    </div>
  );
}
