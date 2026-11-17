"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cleanMoneyInput } from "@/lib/money-input";

const input =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

/**
 * 【中文】新增一笔营业开支（租金、电费、工资等不是用付款凭证付的费用）。
 * Add one operating expense paid outside the system (bank transfer, card, auto-debit).
 */
export function ExpenseForm({ today, categories }: { today: string; categories: string[] }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState(categories[0] || "");
  const [expenseDate, setExpenseDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function submit() {
    setError("");
    setSaved(false);
    setBusy(true);
    try {
      const res = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, amount, category, expenseDate, notes }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Failed to save expense");
        return;
      }
      setTitle("");
      setAmount("");
      setNotes("");
      setSaved(true);
      router.push(`/expenses?month=${expenseDate.slice(0, 7)}`);
      router.refresh();
    } catch {
      setError("Network error, please retry");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs text-slate-500">What was it for?</label>
          <input className={input} value={title} maxLength={150} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Electricity bill October" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">Amount (RM)</label>
          <input className={input} inputMode="decimal" value={amount} onChange={(e) => setAmount(cleanMoneyInput(e.target.value))} placeholder="0.00" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">Date paid</label>
          <input className={input} type="date" value={expenseDate} max={today} onChange={(e) => setExpenseDate(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">Category</label>
          <select className={input} value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <label className="mb-1 block text-xs text-slate-500">Notes (optional, e.g. bank reference)</label>
          <input className={input} value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      {error && <div className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
      {saved && !error && <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-700">Expense saved.</div>}
      <button
        type="button"
        onClick={submit}
        disabled={busy || !title.trim() || !amount || !expenseDate}
        className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-60"
      >
        {busy ? "Saving..." : "Add Expense"}
      </button>
    </div>
  );
}
