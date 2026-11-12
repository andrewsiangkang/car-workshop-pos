"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, FolderOpen, RotateCcw, Usb } from "lucide-react";

type BackupFile = { name: string; size: number; mtime: number };
type Snapshot = {
  config: { enabled: boolean; intervalHours: number; keep: number; extraDir: string | null };
  status: {
    lastAt?: number;
    lastOk?: boolean;
    lastError?: string | null;
    extraOk?: boolean | null;
    extraError?: string | null;
  };
  files: BackupFile[];
  autoDir: string;
};

type Api = {
  get: () => Promise<Snapshot>;
  set: (p: Record<string, unknown>) => Promise<Snapshot>;
  chooseDir: () => Promise<Snapshot>;
  runNow: () => Promise<Snapshot & { result?: { ok: boolean; error?: string } }>;
  openFolder: () => Promise<unknown>;
  restore: (name: string) => Promise<{ ok: boolean; error?: string }>;
};

function fmt(ts?: number) {
  if (!ts) return "never";
  return new Date(ts).toLocaleString();
}

export function AutoBackupPanel() {
  const [api, setApi] = useState<Api | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (a: Api) => {
    try {
      setSnap(await a.get());
    } catch {
      setMsg("Could not read backup status");
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

  async function update(patch: Record<string, unknown>) {
    if (!api) return;
    setSnap(await api.set(patch));
    setMsg("Saved");
  }

  async function runNow() {
    if (!api) return;
    setBusy(true);
    setMsg("Backing up...");
    const r = await api.runNow();
    setSnap(r);
    setMsg(r.result?.ok ? "Backup created" : "Backup failed: " + (r.result?.error || "unknown error"));
    setBusy(false);
  }

  async function chooseDir() {
    if (!api) return;
    setSnap(await api.chooseDir());
  }

  async function restore(name: string) {
    if (!api) return;
    const r = await api.restore(name);
    if (!r.ok && r.error !== "cancelled") setMsg("Restore failed: " + r.error);
  }

  const c = snap?.config;
  const s = snap?.status;
  const stale =
    c?.enabled && s?.lastAt ? Date.now() - s.lastAt > c.intervalHours * 3600 * 1000 * 3 : false;

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

      <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm">
        <div className="mb-1 flex items-center gap-2 font-medium text-slate-800">
          <Usb className="h-4 w-4" /> Extra copy (USB drive / OneDrive / Google Drive folder)
        </div>
        <div className="break-all text-xs text-slate-600">
          {c?.extraDir ? c.extraDir : "Not set. A copy on a different drive protects you if this computer fails."}
        </div>
        {s?.extraOk === false && (
          <div className="mt-1 text-xs text-red-600">Last copy to this folder failed: {s.extraError}</div>
        )}
        <div className="mt-2 flex gap-2">
          <button onClick={chooseDir} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs hover:bg-slate-50">
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
      </div>

      {msg && <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{msg}</div>}

      <div>
        <div className="mb-2 text-sm font-medium text-slate-800">Saved backups ({snap?.files.length ?? 0})</div>
        <div className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-100">
          {snap?.files.length === 0 && <div className="p-3 text-sm text-slate-400">No backups yet</div>}
          {snap?.files.map((f) => (
            <div key={f.name} className="flex items-center justify-between px-3 py-2 text-sm">
              <div>
                <div className="text-slate-800">{fmt(f.mtime)}</div>
                <div className="text-xs text-slate-400">{f.name} · {(f.size / 1024).toFixed(0)} KB</div>
              </div>
              <button onClick={() => restore(f.name)} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50">
                <RotateCcw className="h-3 w-3" /> Restore
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
