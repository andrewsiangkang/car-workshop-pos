"use client";

import { useEffect, useState } from "react";
import { Trash2, KeyRound, UserPlus, ShieldCheck } from "lucide-react";

type Account = {
  id: string;
  name: string;
  username: string;
  role: string;
  ordersCreated: number;
};

export function StaffPanel() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"STAFF" | "OWNER">("STAFF");
  const [adding, setAdding] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/users");
      const data = await res.json();
      setAccounts(Array.isArray(data) ? data : []);
    } catch {
      setAccounts([]);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function addAccount() {
    setMsg(null);
    if (!username.trim() || password.length < 8) {
      setMsg({ ok: false, text: "Enter a username and a password of at least 8 characters" });
      return;
    }
    setAdding(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, username, password, role }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ ok: false, text: data.error || "Failed to create account" });
      } else {
        setMsg({ ok: true, text: `Account "${data.username}" created` });
        setName("");
        setUsername("");
        setPassword("");
        setRole("STAFF");
        await load();
      }
    } catch {
      setMsg({ ok: false, text: "Network error, please retry" });
    }
    setAdding(false);
  }

  async function resetPassword(a: Account) {
    const pwd = prompt(`New password for ${a.username} (at least 8 characters):`);
    if (pwd == null) return;
    const res = await fetch(`/api/users/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pwd }),
    });
    const data = await res.json();
    setMsg(res.ok ? { ok: true, text: `Password updated for ${a.username}` } : { ok: false, text: data.error || "Failed" });
  }

  async function changeRole(a: Account, newRole: string) {
    const res = await fetch(`/api/users/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: newRole }),
    });
    const data = await res.json();
    if (!res.ok) setMsg({ ok: false, text: data.error || "Failed" });
    else setMsg({ ok: true, text: `${a.username} is now ${newRole === "OWNER" ? "Boss" : "Staff"}` });
    await load();
  }

  async function remove(a: Account) {
    if (!confirm(`Delete account "${a.username}"?`)) return;
    const res = await fetch(`/api/users/${a.id}`, { method: "DELETE" });
    const data = await res.json();
    setMsg(res.ok ? { ok: true, text: "Account deleted" } : { ok: false, text: data.error || "Failed" });
    await load();
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <strong>Boss</strong> sees everything. <strong>Staff</strong> can make work orders, quotations, invoices and
          receipts, and manage customers and stock — but cannot see cost prices, collections, profit, reports or
          settings.
        </div>
      </div>

      {msg && (
        <div
          className={`rounded-lg px-4 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}
        >
          {msg.text}
        </div>
      )}

      <div>
        <h3 className="mb-3 text-sm font-semibold text-slate-700">Accounts</h3>
        <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {loading && <div className="px-4 py-6 text-center text-sm text-slate-400">Loading...</div>}
          {!loading && accounts.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-slate-400">No accounts</div>
          )}
          {accounts.map((a) => (
            <div key={a.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-medium text-slate-900">{a.name}</div>
                <div className="text-xs text-slate-500">
                  Username: {a.username} · {a.ordersCreated} work order(s)
                </div>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={a.role === "OWNER" ? "OWNER" : "STAFF"}
                  onChange={(e) => changeRole(a, e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
                >
                  <option value="STAFF">Staff</option>
                  <option value="OWNER">Boss</option>
                </select>
                <button
                  onClick={() => resetPassword(a)}
                  className="rounded p-1.5 text-slate-500 hover:bg-slate-100"
                  title="Reset password"
                >
                  <KeyRound className="h-4 w-4" />
                </button>
                <button
                  onClick={() => remove(a)}
                  className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  title="Delete account"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold text-slate-700">Add account</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Display name (e.g. Ahmad)"
            className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
          />
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username (for login)"
            autoCapitalize="none"
            className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password (min 8 characters)"
            autoComplete="new-password"
            className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "STAFF" | "OWNER")}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm"
          >
            <option value="STAFF">Staff (no cost / turnover)</option>
            <option value="OWNER">Boss (sees everything)</option>
          </select>
        </div>
        <button
          onClick={addAccount}
          disabled={adding}
          className="mt-3 inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-60"
        >
          <UserPlus className="h-4 w-4" />
          {adding ? "Adding..." : "Add Account"}
        </button>
      </div>
    </div>
  );
}
