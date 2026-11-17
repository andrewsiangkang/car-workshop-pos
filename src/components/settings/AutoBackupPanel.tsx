"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, FolderOpen, RotateCcw, Usb, KeyRound, FileUp, AlertTriangle } from "lucide-react";

type BackupFile = { name: string; size: number; mtime: number; preRestore?: boolean };
type Snapshot = {
  config: { enabled: boolean; intervalHours: number; keep: number; extraDir: string | null };
  status: {
    lastAt?: number;
    lastOk?: boolean;
    lastError?: string | null;
    lastMethod?: "snapshot" | "copy";
    extraOk?: boolean | null;
    extraError?: string | null;
  };
  files: BackupFile[];
  autoDir: string;
  hasPassword?: boolean;
  passwordSetAt?: number | null;
  extraPlainCount?: number;
  error?: string;
  detail?: string;
};
type Result = { ok: boolean; error?: string; detail?: string };
type Picked = Result & { id?: string; name?: string; encrypted?: boolean };

type Api = {
  get: () => Promise<Snapshot>;
  set: (p: Record<string, unknown>) => Promise<Snapshot>;
  chooseDir: () => Promise<Snapshot & { result?: Result }>;
  runNow: () => Promise<Snapshot & { result?: Result }>;
  openFolder: () => Promise<unknown>;
  restore: (name: string) => Promise<Result>;
  setPassword: (password: string) => Promise<Snapshot & Result & { result?: Result }>;
  removePassword: () => Promise<Snapshot>;
  deletePlainExtra: () => Promise<Snapshot>;
  pickRestoreFile: () => Promise<Picked>;
  restoreFile: (id: string, password: string) => Promise<Result>;
};

// Messages are whole English sentences so the page dictionary can translate them.
// 【中文】提示文字用完整的英文句子，方便界面词典翻译。
const ERRORS: Record<string, string> = {
  "owner-only": "Only the boss can do this. Log in with the boss account and try again.",
  "server-down": "The app's server is not running. Close and reopen the app, then try again.",
  busy: "A restore is already in progress.",
  WRONG_PASSWORD: "Wrong backup password.",
  PASSWORD_REQUIRED: "Enter the backup password.",
  NOT_A_BACKUP: "This file is not a Workshop POS backup.",
  DAMAGED: "This backup file is damaged or was changed. Nothing was changed.",
  VERIFY_FAILED: "This backup file is damaged or is not a Workshop POS database. Nothing was changed.",
  SAFETY_COPY_FAILED: "Could not save a safety copy of the current data, so nothing was changed. Check the free disk space and try again.",
  LIVE_DB: "That is the database the app is using now. Choose a backup file instead.",
  TOO_SHORT: "The password must be at least 8 characters.",
  TOO_LONG: "The password is too long.",
  SAME_FOLDER: "Choose a folder on another drive (USB drive or cloud folder), not the app's own data folder.",
  NO_ENCRYPTED_COPY: "Make an encrypted copy in this folder first, then delete the old unencrypted copies.",
};

function errorText(code?: string) {
  return (code && ERRORS[code]) || "Something went wrong. Nothing was changed.";
}

function fmt(ts?: number | null) {
  if (!ts) return "never";
  return new Date(ts).toLocaleString();
}

export function AutoBackupPanel() {
  const [api, setApi] = useState<Api | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [msg, setMsg] = useState<{ text: string; detail?: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const [restorePw, setRestorePw] = useState("");

  const load = useCallback(async (a: Api) => {
    try {
      setSnap(await a.get());
    } catch {
      setMsg({ text: "Could not read backup status", bad: true });
    }
  }, []);

  useEffect(() => {
    const a = (window as unknown as { workshopBackup?: Api }).workshopBackup;
    if (a) {
      setApi(a);
      load(a);
    }
  }, [load]);

  if (!api) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
        <div className="mb-1 flex items-center gap-2 font-medium text-slate-900">
          <ShieldCheck className="h-4 w-4 text-emerald-600" />
          Automatic backup
        </div>
        Automatic backups run on the shop computer (in the desktop app). Open Settings → Backup there to
        change the schedule, choose a USB / cloud folder, or restore.
      </div>
    );
  }

  /** Show a snapshot from the desktop app, and its error if it refused the change. */
  function apply(s: Snapshot, okText?: string) {
    setSnap(s);
    if (s.error) setMsg({ text: errorText(s.error), detail: s.detail, bad: true });
    else if (okText) setMsg({ text: okText });
  }

  async function update(patch: Record<string, unknown>) {
    if (!api) return;
    apply(await api.set(patch), "Saved");
  }

  async function runNow() {
    if (!api) return;
    setBusy(true);
    setMsg({ text: "Backing up..." });
    const r = await api.runNow();
    setSnap(r);
    setMsg(r.result?.ok ? { text: "Backup created" } : { text: "Backup failed:", detail: r.result?.error || "unknown error", bad: true });
    setBusy(false);
  }

  async function chooseDir() {
    if (!api) return;
    setBusy(true);
    try {
      apply(await api.chooseDir());
    } finally {
      setBusy(false);
    }
  }

  async function savePassword() {
    if (!api) return;
    if (pw1.length < 8) return setMsg({ text: errorText("TOO_SHORT"), bad: true });
    if (pw1 !== pw2) return setMsg({ text: "The two passwords do not match.", bad: true });
    setBusy(true);
    setMsg({ text: "Saving..." });
    try {
      const r = await api.setPassword(pw1);
      setSnap(r);
      if (!r.ok) {
        setMsg({ text: errorText(r.error), bad: true });
        return;
      }
      setPw1("");
      setPw2("");
      setPwOpen(false);
      setMsg({ text: "Backup password saved. Copies to the extra folder are encrypted with it." });
    } finally {
      setBusy(false);
    }
  }

  async function removePassword() {
    if (!api) return;
    apply(await api.removePassword());
  }

  async function deletePlain() {
    if (!api) return;
    apply(await api.deletePlainExtra());
  }

  async function restore(name: string) {
    if (!api) return;
    setBusy(true);
    try {
      const r = await api.restore(name);
      if (!r.ok && r.error !== "cancelled") setMsg({ text: errorText(r.error), detail: r.detail, bad: true });
    } finally {
      setBusy(false);
    }
  }

  async function pickFile() {
    if (!api) return;
    setPicked(null);
    setRestorePw("");
    const r = await api.pickRestoreFile();
    if (!r.ok) {
      if (r.error !== "cancelled") setMsg({ text: errorText(r.error), bad: true });
      return;
    }
    if (r.encrypted && r.id) {
      setPicked({ id: r.id, name: r.name || "" });
      setMsg(null);
      return;
    }
    if (r.id) await restoreFile(r.id, "");
  }

  async function restoreFile(id: string, password: string) {
    if (!api) return;
    setBusy(true);
    setMsg({ text: "Checking the backup file..." });
    try {
      const r = await api.restoreFile(id, password);
      if (r.ok || r.error === "cancelled") {
        setMsg(null);
        return;
      }
      setMsg({ text: errorText(r.error), detail: r.error === "WRONG_PASSWORD" ? undefined : r.detail, bad: true });
    } finally {
      setBusy(false);
    }
  }

  const c = snap?.config;
  const s = snap?.status;
  const hasPassword = !!snap?.hasPassword;
  const stale =
    c?.enabled && s?.lastAt ? Date.now() - s.lastAt > c.intervalHours * 3600 * 1000 * 3 : false;
  const showPwForm = !hasPassword || pwOpen;

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-medium text-slate-900">
          <ShieldCheck className="h-5 w-5 text-emerald-600" />
          Automatic backup
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={!!c?.enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
          />
          Enabled
        </label>
      </div>

      <div className="text-sm text-slate-600">
        Last backup: <span className="font-medium text-slate-900">{fmt(s?.lastAt)}</span>{" "}
        {s?.lastOk === false && (
          <span className="text-red-600">— failed: {s.lastError}</span>
        )}
        {stale && <span className="text-amber-600"> — overdue</span>}
        {s?.lastOk && s.lastMethod === "copy" && (
          <div className="mt-1 text-xs text-amber-700">
            The last backup was a checked file copy (the server&apos;s snapshot was not available).
          </div>
        )}
        <div className="mt-1 text-xs text-slate-500">
          Backups are made when the app starts, every {c?.intervalHours ?? 6} hours while it is open, and when
          you close it. Only changes since the last backup are saved.
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-sm text-slate-700">
          Backup every
          <select
            value={c?.intervalHours ?? 6}
            onChange={(e) => update({ intervalHours: Number(e.target.value) })}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            {[1, 3, 6, 12, 24].map((h) => (
              <option key={h} value={h}>{h} hour{h > 1 ? "s" : ""}</option>
            ))}
          </select>
        </label>
        <label className="text-sm text-slate-700">
          Keep latest
          <select
            value={c?.keep ?? 30}
            onChange={(e) => update({ keep: Number(e.target.value) })}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            {[10, 30, 60, 100].map((n) => (
              <option key={n} value={n}>{n} backups</option>
            ))}
          </select>
        </label>
      </div>
      <div className="-mt-2 text-xs text-slate-500">
        Also always kept: one backup for each of the last 7 days, one for each of the last 12 months, and the newest safety copies made before a restore.
      </div>

      <div className="space-y-2 rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm">
        <div className="flex items-center gap-2 font-medium text-slate-800">
          <Usb className="h-4 w-4" /> Extra copy (USB drive / OneDrive / Google Drive folder)
        </div>
        <div className="break-all text-xs text-slate-600" data-no-i18n={c?.extraDir ? "" : undefined}>
          {c?.extraDir ? c.extraDir : "Not set. A copy on a different drive protects you if this computer fails."}
        </div>

        {/* Backup password: copies that leave this PC are always encrypted with it. */}
        <div className="rounded-md border border-slate-200 bg-white p-3">
          <div className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-800">
            <KeyRound className="h-3.5 w-3.5" /> Backup password
          </div>
          {hasPassword ? (
            <div className="text-xs text-slate-600">
              Copies in this folder are encrypted with your backup password (file names end in .db.enc).
            </div>
          ) : (
            <div className="flex items-start gap-1.5 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {c?.extraDir ? (
                <span>No backup password set: nothing is copied to this folder until you set one.</span>
              ) : (
                <span>Set a backup password first. Copies on a USB drive or cloud folder are encrypted with it.</span>
              )}
            </div>
          )}

          {showPwForm ? (
            <div className="mt-2 space-y-2">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <input
                  type="password"
                  autoComplete="new-password"
                  value={pw1}
                  onChange={(e) => setPw1(e.target.value)}
                  placeholder="New backup password"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
                <input
                  type="password"
                  autoComplete="new-password"
                  value={pw2}
                  onChange={(e) => setPw2(e.target.value)}
                  placeholder="Type it again"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div className="text-xs text-slate-500">
                At least 8 characters. Write it down and keep it somewhere safe: without it nobody can open these copies, not even us.
              </div>
              {hasPassword && (
                <div className="text-xs text-slate-500">Copies made before a password change still need the old password.</div>
              )}
              <div className="flex gap-2">
                <button disabled={busy} onClick={savePassword} className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-900 disabled:opacity-50">
                  Save password
                </button>
                {hasPassword && (
                  <button onClick={() => { setPwOpen(false); setPw1(""); setPw2(""); }} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs hover:bg-slate-50">
                    Cancel
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-2 flex gap-2">
              <button onClick={() => setPwOpen(true)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs hover:bg-slate-50">
                Change password
              </button>
              <button onClick={removePassword} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs hover:bg-slate-50">
                Remove password
              </button>
            </div>
          )}
        </div>

        {s?.extraOk === false && s.extraError && s.extraError !== "NO_PASSWORD" && (
          <div className="text-xs text-red-600">
            <span>Last copy to this folder failed:</span> <span data-no-i18n="">{s.extraError}</span>
          </div>
        )}
        {!!snap?.extraPlainCount && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
            <span>This folder still has unencrypted backup copies from an older version:</span>
            <span className="font-semibold">{snap.extraPlainCount}</span>
            {/* Only offered once a backup password exists (no encrypted copy can exist without one). */}
            {hasPassword && (
              <button onClick={deletePlain} className="rounded-md border border-amber-300 bg-white px-2 py-1 hover:bg-amber-100">
                Delete unencrypted copies
              </button>
            )}
          </div>
        )}
        <div className="flex gap-2">
          <button disabled={busy} onClick={chooseDir} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50">
            {c?.extraDir ? "Change folder" : "Choose folder"}
          </button>
          {c?.extraDir && (
            <button onClick={() => update({ extraDir: null })} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs hover:bg-slate-50">
              Remove
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button disabled={busy} onClick={runNow} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
          Back up now
        </button>
        <button onClick={() => api.openFolder()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
          <FolderOpen className="h-4 w-4" /> Open backup folder
        </button>
        <button disabled={busy} onClick={pickFile} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          <FileUp className="h-4 w-4" /> Restore from a backup file…
        </button>
      </div>
      <div className="-mt-2 text-xs text-slate-500">
        Restore a backup from this computer, a USB drive or a cloud folder (.db or encrypted .db.enc file). A safety copy of the current data is saved first.
      </div>

      {picked && (
        <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm">
          <div className="text-blue-900">This backup is encrypted. Enter the backup password to restore it:</div>
          <div className="break-all text-xs text-blue-800" data-no-i18n="">{picked.name}</div>
          <div className="flex flex-wrap gap-2">
            <input
              type="password"
              autoComplete="off"
              value={restorePw}
              onChange={(e) => setRestorePw(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && restorePw) restoreFile(picked.id, restorePw); }}
              placeholder="Backup password"
              className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <button disabled={busy || !restorePw} onClick={() => restoreFile(picked.id, restorePw)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              Restore
            </button>
            <button onClick={() => { setPicked(null); setRestorePw(""); }} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50">
              Cancel
            </button>
          </div>
        </div>
      )}

      {msg && (
        <div className={`rounded-lg px-3 py-2 text-sm ${msg.bad ? "bg-red-50 text-red-700" : "bg-slate-50 text-slate-700"}`}>
          <span>{msg.text}</span>
          {msg.detail && <span data-no-i18n=""> {msg.detail}</span>}
        </div>
      )}

      <div>
        <div className="mb-2 text-sm font-medium text-slate-800">Saved backups ({snap?.files.length ?? 0})</div>
        <div className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-100">
          {snap?.files.length === 0 && <div className="p-3 text-sm text-slate-400">No backups yet</div>}
          {snap?.files.map((f) => (
            <div key={f.name} className="flex items-center justify-between px-3 py-2 text-sm">
              <div>
                <div className="text-slate-800">
                  {fmt(f.mtime)}
                  {f.preRestore && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">Safety copy before restore</span>}
                </div>
                <div className="text-xs text-slate-400">{f.name} · {(f.size / 1024).toFixed(0)} KB</div>
              </div>
              <button disabled={busy} onClick={() => restore(f.name)} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                <RotateCcw className="h-3 w-3" /> Restore
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
