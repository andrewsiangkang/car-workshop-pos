"use client";

import { useEffect, useState } from "react";

type Result = {
  current: string;
  latest?: string;
  url?: string;
  pageUrl?: string;
  hasUpdate?: boolean;
  error?: string;
};
type Api = {
  check: () => Promise<Result>;
  open: (url: string) => Promise<boolean>;
};

export function UpdatePanel() {
  const [version, setVersion] = useState("");
  const [api, setApi] = useState<Api | null>(null);
  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/version")
      .then((r) => r.json())
      .then((d) => setVersion(d.version || ""))
      .catch(() => {});
    const a = (window as unknown as { workshopUpdate?: Api }).workshopUpdate;
    if (a) setApi(a);
  }, []);

  async function check() {
    if (!api) return;
    setBusy(true);
    setRes(await api.check());
    setBusy(false);
  }

  return (
    <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
      <h3 className="text-sm font-semibold text-slate-800">Version &amp; updates</h3>
      <p className="mt-1 text-xs text-slate-500">Current version: v{version || "…"}</p>
      <p className="mt-1 text-xs text-slate-400">
        The desktop app checks for a new version each time it starts. Your data is kept when you install an update.
      </p>
      {api && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            onClick={check}
            disabled={busy}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {busy ? "Checking..." : "Check for updates"}
          </button>
          {res?.error && <span className="text-sm text-amber-600">Could not check: {res.error}</span>}
          {res && !res.error && !res.hasUpdate && (
            <span className="text-sm text-emerald-700">You are up to date (latest: v{res.latest}).</span>
          )}
          {res?.hasUpdate && res.url && (
            <button
              onClick={() => api.open(res.url!)}
              className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800"
            >
              Download v{res.latest}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
