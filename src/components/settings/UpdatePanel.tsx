"use client";

import { useEffect, useState } from "react";

type Result = {
  current: string;
  latest?: string;
  pageUrl?: string;
  hasUpdate?: boolean;
  /** The release publishes a checksum, so the desktop app can check and install it. */
  canInstall?: boolean;
  /** The demo version: it never installs updates. */
  demo?: boolean;
  error?: string;
};
type InstallResult = { ok: boolean; error?: string };
type Api = {
  check: () => Promise<Result>;
  /** Download, check the SHA-256 and install (each step confirmed in a desktop dialog). */
  install?: () => Promise<InstallResult>;
  /** Open the release page in the browser. */
  open: (url: string) => Promise<boolean>;
};

// 【中文】更新失败的原因（桌面程序的对话框里有详细说明，这里只显示一句）。
function installMessage(r: InstallResult): string {
  if (r.ok) return "The app will close and the installer will open.";
  switch (r.error) {
    case "cancelled":
    case "busy":
      return "";
    case "NO_CHECKSUM":
    case "CHECKSUM_CONFLICT":
      return "This release has no checksum to check the installer against, so it was not installed.";
    case "CHECKSUM_MISMATCH":
      return "The downloaded installer did not match the published checksum. It was deleted and not installed.";
    case "NOT_PACKAGED":
      return "Updates can only be installed in the installed desktop app.";
    case "demo":
      return "The demo version does not install updates.";
    default:
      return "The download failed. Check the internet connection and try again.";
  }
}

export function UpdatePanel() {
  const [version, setVersion] = useState("");
  const [api, setApi] = useState<Api | null>(null);
  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installMsg, setInstallMsg] = useState("");

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
    setInstallMsg("");
    setRes(await api.check());
    setBusy(false);
  }

  // 【中文】下载并安装：桌面程序下载安装程序，核对发布时附带的 SHA-256，一致才会安装。
  async function install() {
    if (!api?.install) return;
    setInstalling(true);
    setInstallMsg("");
    try {
      setInstallMsg(installMessage(await api.install()));
    } catch {
      setInstallMsg(installMessage({ ok: false }));
    }
    setInstalling(false);
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
            disabled={busy || installing}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {busy ? "Checking..." : "Check for updates"}
          </button>
          {res?.error && <span className="text-sm text-amber-600">Could not check: {res.error}</span>}
          {res?.demo && <span className="text-sm text-slate-600">The demo version does not install updates.</span>}
          {res && !res.error && !res.demo && !res.hasUpdate && (
            <span className="text-sm text-emerald-700">You are up to date (latest: v{res.latest}).</span>
          )}
          {res?.hasUpdate && res.canInstall && api.install && (
            <button
              onClick={install}
              disabled={installing}
              className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50"
            >
              {installing ? "Downloading and checking the installer…" : <>Download and install v{res.latest}</>}
            </button>
          )}
          {res?.hasUpdate && !res.canInstall && (
            <span className="text-sm text-amber-700">
              This release has no checksum to check the installer against, so it cannot be installed from here. Contact support.
            </span>
          )}
          {res?.hasUpdate && res.pageUrl && (
            <button
              onClick={() => api.open(res.pageUrl!)}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              What&apos;s new
            </button>
          )}
        </div>
      )}
      {res?.hasUpdate && res.canInstall && (
        <p className="mt-2 text-xs text-slate-500">
          The installer is downloaded and checked against the checksum published with the release before it runs. The app makes a final backup and closes first.
        </p>
      )}
      {installMsg && <p className="mt-2 text-sm text-slate-700">{installMsg}</p>}
    </div>
  );
}
