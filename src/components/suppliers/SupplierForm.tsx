"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const input =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

/** 【中文】修改供应商联系资料（电话、地址、备注），方便下次订货联系。 */
export function SupplierForm({ id, phone, address, notes }: { id: string; phone: string; address: string; notes: string }) {
  const router = useRouter();
  const [f, setF] = useState({ phone, address, notes });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch(`/api/suppliers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(f),
      });
      setMsg(res.ok ? "Saved ✓" : "Save failed");
      if (res.ok) router.refresh();
    } catch {
      setMsg("Network error, please retry");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <input className={input} placeholder="Phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
      <input className={input} placeholder="Address" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
      <input className={input} placeholder="Notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      <div className="sm:col-span-3">
        <button type="button" onClick={save} disabled={busy} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-60">
          {busy ? "Saving..." : "Save"}
        </button>
        {msg && <span className="ml-3 text-sm text-slate-600">{msg}</span>}
      </div>
    </div>
  );
}
