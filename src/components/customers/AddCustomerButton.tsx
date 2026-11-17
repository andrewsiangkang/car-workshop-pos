"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { MY_STATES } from "@/lib/my-states";

const input =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

export function AddCustomerButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setSaving(true);
    const form = new FormData(e.currentTarget);
    const f = { ...Object.fromEntries(form.entries()), reminderConsent: form.get("reminderConsent") === "on" };
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(f),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || "Save failed");
      else {
        setOpen(false);
        router.refresh();
      }
    } catch {
      setError("Save failed");
    }
    setSaving(false);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-800"
      >
        <Plus className="h-4 w-4" />
        Add Customer
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4">
          <form onSubmit={onSubmit} className="my-6 w-full max-w-md space-y-3 rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900">Add Customer</h2>
            {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
            <input name="name" required maxLength={200} placeholder="Name *" className={input} />
            <input name="phone" required inputMode="tel" placeholder="Phone *" className={input} />
            <input name="email" type="email" placeholder="Email（optional）" className={input} />
            <input name="tin" maxLength={20} placeholder="TIN（e-Invoice for，optional）" className={input} />
            {/* Address for invoices / e-Invoices (optional). LHDN limits: 150 / 50 characters, 5-digit postcode. */}
            <input name="address" maxLength={150} placeholder="Address (optional, max 150 characters)" className={input} />
            <div className="grid grid-cols-3 gap-2">
              <input name="postcode" inputMode="numeric" maxLength={5} pattern="\d{5}" title="5 digits" placeholder="Postcode" className={input} />
              <input name="city" maxLength={50} placeholder="City" className={`${input} col-span-2`} />
            </div>
            <select name="stateCode" defaultValue="" className={input}>
              <option value="">State (optional)</option>
              {Object.entries(MY_STATES).map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
            <textarea name="notes" placeholder="Notes" rows={2} className={input} />
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" name="reminderConsent" className="mt-0.5" />
              <span>Customer agrees to WhatsApp service reminders</span>
            </label>
            <select name="language" defaultValue="" className={input}>
              <option value="">Reminder language: same as the shop</option>
              <option value="en">English</option>
              <option value="zh">中文</option>
              <option value="ms">Bahasa Melayu</option>
            </select>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
              <button disabled={saving} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50">
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
