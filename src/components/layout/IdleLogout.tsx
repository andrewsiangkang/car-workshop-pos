"use client";

import { useEffect, useRef, useState } from "react";
import { IDLE_STORAGE_KEY, idleState } from "@/lib/idle";

const EVENTS = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "wheel", "click"] as const;

function readStored(): number {
  try {
    const n = Number(localStorage.getItem(IDLE_STORAGE_KEY));
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function writeStored(t: number) {
  try {
    localStorage.setItem(IDLE_STORAGE_KEY, String(t));
  } catch {}
}

/**
 * Signs the user out after 5 minutes without a mouse move, key press, touch or scroll,
 * so a counter left unattended cannot be used by accident. The last 30 seconds show a
 * warning with a "Stay Logged In" button. Activity in any open window counts for all of
 * them, and a computer that went to sleep is signed out as soon as it wakes up.
 */
export function IdleLogout() {
  const last = useRef(Date.now());
  const warning = useRef(false);
  const leaving = useRef(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  function stay() {
    const now = Date.now();
    last.current = now;
    writeStored(now);
    warning.current = false;
    setSecondsLeft(null);
  }

  async function logout() {
    if (leaving.current) return;
    leaving.current = true;
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {}
    window.location.href = "/login?idle=1";
  }

  useEffect(() => {
    // Coming back to an old window after a long break (or to a browser that was closed) = already idle.
    // Signing in writes a fresh time, so a new login is never treated as idle.
    const stored = readStored();
    if (stored > 0) last.current = stored;
    else writeStored(last.current);

    const touch = () => {
      if (warning.current) return; // once the warning shows, only the button counts
      const now = Date.now();
      if (now - last.current < 1000) return; // do not write storage on every mouse move
      last.current = now;
      writeStored(now);
    };
    EVENTS.forEach((e) => window.addEventListener(e, touch, { passive: true, capture: true }));

    const tick = () => {
      const lastActive = Math.max(last.current, readStored());
      const s = idleState(Date.now() - lastActive);
      if (s.expired) {
        void logout();
        return;
      }
      warning.current = s.secondsLeft !== null;
      setSecondsLeft(s.secondsLeft);
    };
    const timer = window.setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);

    return () => {
      EVENTS.forEach((e) => window.removeEventListener(e, touch, { capture: true }));
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (secondsLeft === null) return null;
  return (
    <div className="no-print fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4" role="alertdialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl">
        <h2 className="text-lg font-bold text-slate-900">Auto Logout Warning</h2>
        <p className="mt-2 text-sm text-slate-600">
          <span>No activity detected. You will be logged out in</span> <b>{secondsLeft}</b> <span>seconds.</span>
        </p>
        <div className="mt-5 flex justify-center gap-3">
          <button onClick={stay} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800" autoFocus>
            Stay Logged In
          </button>
          <button onClick={() => void logout()} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
            Log Out Now
          </button>
        </div>
      </div>
    </div>
  );
}
