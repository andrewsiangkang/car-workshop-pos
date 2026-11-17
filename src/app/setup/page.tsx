"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Wrench } from "lucide-react";
import { MIN_PASSWORD_LENGTH } from "@/lib/accounts-core.mjs";

type Blocked = { code: "NOT_LOCAL" | "LAN_ON"; error: string };
type NetworkBridge = { set: (enabled: boolean) => Promise<{ ok?: boolean; error?: string }> };

// The desktop app's phone / tablet switch (electron/preload.js); missing in an ordinary browser.
function networkBridge(): NetworkBridge | null {
  const w = window as unknown as { workshopNetwork?: NetworkBridge };
  return typeof w.workshopNetwork?.set === "function" ? w.workshopNetwork : null;
}

/**
 * 【中文】首次设置：创建老板账号。只能在这台电脑上完成；如果「手机 / 平板访问」开着，先在这里把它关掉；
 * 手动运行（start.bat / npm run dev）时还要输入服务器窗口显示的设置码。
 * First-run setup. Only the shop computer may create the boss account; while phone / tablet
 * access is on, the desktop app can switch it off from here first. On a dev / manual run the
 * one-time code printed in the server window is needed as well.
 */
export default function SetupPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("Owner");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [canSwitchOff, setCanSwitchOff] = useState(false);
  const [switching, setSwitching] = useState(false);
  // Hint shown when the server asks for the one-time setup code (dev / manual run).
  const [codeHint, setCodeHint] = useState("");
  const [setupCode, setSetupCode] = useState("");

  useEffect(() => {
    setCanSwitchOff(!!networkBridge());
    fetch("/api/auth/setup")
      .then((r) => r.json())
      .then((d) => {
        if (d.setupHere?.code === "NEED_CODE") setCodeHint(d.setupHere.error);
        else if (d.setupHere && !d.setupHere.ok) setBlocked({ code: d.setupHere.code, error: d.setupHere.error });
      })
      .catch(() => {});
  }, []);

  async function switchPhoneAccessOff() {
    const bridge = networkBridge();
    if (!bridge) return;
    setSwitching(true);
    try {
      const r = await bridge.set(false);
      // On success the desktop app restarts its server and reloads this window by itself.
      if (!r?.ok) setSwitching(false);
    } catch {
      setSwitching(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, name, ...(codeHint ? { setupCode } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "NOT_LOCAL" || data.code === "LAN_ON") setBlocked({ code: data.code, error: data.error });
        else {
          if (data.code === "NEED_CODE" && !codeHint) setCodeHint(data.error);
          setError(data.error || "Setup failed");
        }
        setLoading(false);
        return;
      }
      try {
        localStorage.setItem("workshop-last-active", String(Date.now()));
      } catch {}
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Network error");
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm">
        <div className="mb-6 flex flex-col items-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-700 text-white">
            <Wrench className="h-6 w-6" />
          </div>
          <h1 className="mt-4 text-xl font-bold text-slate-900">First Time Setup</h1>
          <p className="mt-1 text-center text-sm text-slate-500">Create your login username and password</p>
        </div>
        {blocked && (
          <div className="mb-4 rounded-lg bg-amber-50 px-3 py-3 text-sm text-amber-900">
            <p>{blocked.error}</p>
            {blocked.code === "LAN_ON" && canSwitchOff && (
              <button
                type="button"
                onClick={switchPhoneAccessOff}
                disabled={switching}
                className="mt-3 w-full rounded-lg bg-amber-600 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60"
              >
                {switching ? "Restarting..." : "Turn off phone / tablet access"}
              </button>
            )}
            {blocked.code === "LAN_ON" && (
              <p className="mt-2 text-xs text-amber-800">You can turn it on again later in Settings → Phone / Tablet.</p>
            )}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          {codeHint && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Setup Code *</label>
              <p className="mb-2 text-xs text-slate-500">{codeHint}</p>
              <input
                type="text"
                value={setupCode}
                onChange={(e) => setSetupCode(e.target.value)}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 font-mono text-sm tracking-widest outline-none focus:border-blue-500"
                required
              />
            </div>
          )}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Display Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Username *</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
              required
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Password *</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              placeholder="At least 8 characters"
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
              required
              minLength={MIN_PASSWORD_LENGTH}
            />
          </div>
          <button
            type="submit"
            disabled={loading || !!blocked}
            className="w-full rounded-lg bg-blue-700 py-2.5 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-60"
          >
            {loading ? "Creating..." : "Create Account & Enter"}
          </button>
        </form>
        {error === "Already set up" && (
          <div className="mt-4 text-center">
            <p className="text-xs text-slate-500 mb-2">Database already has a user.</p>
            <p className="text-xs text-slate-400">Forgot your password? Close the app, delete the file workshop.db inside %APPDATA%\修车店POS\data (this erases all data; make a backup copy first), then reopen.</p>
          </div>
        )}
      </div>
    </div>
  );
}
