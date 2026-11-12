"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const input =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

/** 【中文】独立付款凭证：用于没有供应商发票的付款（租金、电费、工资、零星采购等）。 */
export function NewVoucherForm() {
  const router = useRouter();
  const [payee, setPayee] = useState("");
  const [purpose, setPurpose] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("CASH");
  const [reference, setReference] = useState("");
  const [fromDrawer, setFromDrawer] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/payment-vouchers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payee, purpose, amount: Number(amount), method, reference, fromDrawer: method === "CASH" && fromDrawer }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed");
        return;
      }
      router.push(`/payment-vouchers/${data.id}`);
      router.refresh();
    } catch {
      setError("Network error, please retry");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <input className={input} placeholder="Pay to (name)" value={payee} onChange={(e) => setPayee(e.target.value)} />
        <input className={input} placeholder="Purpose (e.g. Shop rent November)" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
        <input className={input} placeholder="Amount (RM)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <select className={input} value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="CASH">Cash</option>
          <option value="TRANSFER">Bank Transfer</option>
          <option value="CARD">Card</option>
          <option value="TNG">Touch &apos;n Go</option>
          <option value="OTHER">Other</option>
        </select>
        <input className={input + " sm:col-span-2"} placeholder="Reference / Transaction ID (optional)" value={reference} onChange={(e) => setReference(e.target.value)} />
      </div>
        {method === "CASH" && (
          <label className="flex items-center gap-2 text-sm text-slate-700 ">
            <input type="checkbox" checked={fromDrawer} onChange={(e) => setFromDrawer(e.target.checked)} />
            Paid from the counter drawer (reduces the drawer cash)
          </label>
        )}
      {error && <div className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
      <button type="button" onClick={submit} disabled={busy} className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-60">
        {busy ? "Saving..." : "Create Voucher"}
      </button>
    </div>
  );
}
