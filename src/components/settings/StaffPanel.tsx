"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Trash2, KeyRound, UserPlus, ShieldCheck, UserX, UserCheck } from "lucide-react";
import { ConfirmDialog, PromptDialog } from "@/components/ui/Dialog";
import { MIN_PASSWORD_LENGTH } from "@/lib/accounts-core.mjs";

type Account = {
  id: string;
  name: string;
  username: string;
  role: string;
  disabledAt: string | null;
  isSelf: boolean;
  ordersCreated: number;
};

/** A status line: translatable text plus an optional account name that is never translated. */
type Msg = { ok: boolean; text: string; who?: string };

/** Actions that wait for the boss to confirm in a dialog. */
type Pending =
  | { kind: "role"; a: Account; role: "OWNER" | "STAFF" }
  | { kind: "disable"; a: Account; disable: boolean }
  | { kind: "delete"; a: Account };

// The account name inside a sentence; data-no-i18n keeps the page translator off it.
const Who = ({ a }: { a: Account }) => (
  <b data-no-i18n className="text-slate-900">
    {a.username}
  </b>
);

/**
 * 【中文】账号管理（仅老板）：新增、重置密码（页面对话框，桌面版也能用）、改角色（要确认）、停用 / 启用（离职员工）、删除。
 * Boss-only account management. Every action that matters asks first in an in-page dialog
 * (window.prompt() does nothing in the desktop app).
 */
export function StaffPanel() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<Msg | null>(null);

  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"STAFF" | "OWNER">("STAFF");
  const [adding, setAdding] = useState(false);

  // Dialog state (shared by the password dialog and the confirm dialog; only one is open at a time).
  const [resetFor, setResetFor] = useState<Account | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState("");

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
    if (!username.trim() || password.length < MIN_PASSWORD_LENGTH) {
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
        setMsg({ ok: true, text: "Account created:", who: data.username });
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

  function closeDialogs() {
    setResetFor(null);
    setPending(null);
    setDialogBusy(false);
    setDialogError("");
  }

  /** Sends one change; on success closes the dialog, shows `done` and reloads the list. */
  async function send(a: Account, init: RequestInit, done: Msg) {
    setDialogBusy(true);
    setDialogError("");
    try {
      const res = await fetch(`/api/users/${a.id}`, init);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDialogError(data.error || "Failed");
        setDialogBusy(false);
        return;
      }
      closeDialogs();
      setMsg(done);
      await load();
    } catch {
      setDialogError("Network error, please retry");
      setDialogBusy(false);
    }
  }

  const patch = (body: Record<string, unknown>): RequestInit => ({
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  function resetPassword(a: Account, pwd: string) {
    void send(a, patch({ password: pwd }), { ok: true, text: "Password updated for", who: a.username });
  }

  function confirmPending() {
    if (!pending) return;
    const { a } = pending;
    if (pending.kind === "role") {
      void send(a, patch({ role: pending.role }), {
        ok: true,
        text: pending.role === "OWNER" ? "Now a Boss account:" : "Now a Staff account:",
        who: a.username,
      });
    } else if (pending.kind === "disable") {
      void send(a, patch({ disabled: pending.disable }), {
        ok: true,
        text: pending.disable ? "Account disabled:" : "Account enabled:",
        who: a.username,
      });
    } else {
      void send(a, { method: "DELETE" }, { ok: true, text: "Account deleted" });
    }
  }

  // Wording of the confirm dialog for each pending action.
  let confirm: { title: ReactNode; message: ReactNode; label: string; danger: boolean } | null = null;
  if (pending?.kind === "role" && pending.role === "OWNER") {
    confirm = {
      title: (
        <>
          <span>Make this account a Boss?</span> <Who a={pending.a} />
        </>
      ),
      message: "A Boss sees cost prices, profit, reports and settings, and can manage every account. They will need to sign in again.",
      label: "Make Boss",
      danger: false,
    };
  } else if (pending?.kind === "role") {
    confirm = {
      title: (
        <>
          <span>Change this account to Staff?</span> <Who a={pending.a} />
        </>
      ),
      message: "They will no longer see cost prices, profit, reports or settings. They will need to sign in again.",
      label: "Change to Staff",
      danger: false,
    };
  } else if (pending?.kind === "disable" && pending.disable) {
    confirm = {
      title: (
        <>
          <span>Disable this account?</span> <Who a={pending.a} />
        </>
      ),
      message:
        "They are signed out on every device at once and cannot sign in until you enable the account again. Their work orders and records are kept.",
      label: "Disable account",
      danger: true,
    };
  } else if (pending?.kind === "disable") {
    confirm = {
      title: (
        <>
          <span>Enable this account again?</span> <Who a={pending.a} />
        </>
      ),
      message: "They can sign in again with their existing password.",
      label: "Enable account",
      danger: false,
    };
  } else if (pending?.kind === "delete") {
    confirm = {
      title: (
        <>
          <span>Delete this account?</span> <Who a={pending.a} />
        </>
      ),
      message: "This cannot be undone. Accounts that already have work orders cannot be deleted; disable them instead.",
      label: "Delete account",
      danger: true,
    };
  }

  const active = accounts.filter((a) => !a.disabledAt);
  const disabled = accounts.filter((a) => a.disabledAt);

  function row(a: Account) {
    const off = !!a.disabledAt;
    return (
      <div key={a.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className={off ? "opacity-70" : undefined}>
          <div className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
            <span data-no-i18n>{a.name}</span>
            {a.isSelf && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700">You</span>}
            {off && <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-700">Disabled</span>}
          </div>
          <div className="text-xs text-slate-500">
            <span>Username:</span> <span data-no-i18n>{a.username}</span> · {a.ordersCreated} <span>work order(s)</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={a.role === "OWNER" ? "OWNER" : "STAFF"}
            onChange={(e) => {
              setDialogError("");
              setPending({ kind: "role", a, role: e.target.value === "OWNER" ? "OWNER" : "STAFF" });
            }}
            disabled={a.isSelf}
            title={a.isSelf ? "You cannot remove your own boss access" : undefined}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm disabled:opacity-60"
          >
            <option value="STAFF">Staff</option>
            <option value="OWNER">Boss</option>
          </select>
          {!off && (
            <button
              onClick={() => {
                setDialogError("");
                setResetFor(a);
              }}
              className="rounded p-1.5 text-slate-500 hover:bg-slate-100"
              title="Reset password"
              aria-label="Reset password"
            >
              <KeyRound className="h-4 w-4" />
            </button>
          )}
          {!a.isSelf && (
            <button
              onClick={() => {
                setDialogError("");
                setPending({ kind: "disable", a, disable: !off });
              }}
              className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium ${
                off
                  ? "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                  : "border-amber-200 text-amber-800 hover:bg-amber-50"
              }`}
            >
              {off ? <UserCheck className="h-3.5 w-3.5" /> : <UserX className="h-3.5 w-3.5" />}
              <span>{off ? "Enable" : "Disable"}</span>
            </button>
          )}
          {!a.isSelf && (
            <button
              onClick={() => {
                setDialogError("");
                setPending({ kind: "delete", a });
              }}
              className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
              title="Delete account"
              aria-label="Delete account"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    );
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
          <span>{msg.text}</span>
          {msg.who && (
            <>
              {" "}
              <b data-no-i18n>{msg.who}</b>
            </>
          )}
        </div>
      )}

      <div>
        <h3 className="mb-3 text-sm font-semibold text-slate-700">Accounts</h3>
        <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {loading && <div className="px-4 py-6 text-center text-sm text-slate-400">Loading...</div>}
          {!loading && active.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-slate-400">No accounts</div>
          )}
          {active.map(row)}
        </div>
      </div>

      {disabled.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-semibold text-red-700">Disabled accounts</h3>
          <p className="mb-3 text-xs text-slate-500">These people cannot sign in. Their work orders and records are kept.</p>
          <div className="divide-y divide-red-100 rounded-lg border border-red-200 bg-red-50/30">{disabled.map(row)}</div>
        </div>
      )}

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

      <PromptDialog
        open={!!resetFor}
        title="Reset password"
        message={
          resetFor && (
            <>
              <span>New password for</span> <Who a={resetFor} />
              <span className="mt-1 block text-xs text-slate-500">
                At least 8 characters. They will be signed out everywhere and must use the new password.
              </span>
            </>
          )
        }
        mode="password"
        label="New password"
        minLength={MIN_PASSWORD_LENGTH}
        confirmField
        confirmLabel="Save new password"
        busy={dialogBusy}
        error={dialogError}
        onConfirm={(pwd) => resetFor && resetPassword(resetFor, pwd)}
        onCancel={closeDialogs}
      />

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title}
        message={confirm?.message}
        confirmLabel={confirm?.label}
        danger={confirm?.danger}
        busy={dialogBusy}
        error={dialogError}
        onConfirm={confirmPending}
        onCancel={closeDialogs}
      />
    </div>
  );
}
