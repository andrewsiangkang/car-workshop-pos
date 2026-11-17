/** Auto logout: how long without any activity before the user is signed out, and how long the warning shows. */
export const IDLE_LOGOUT_MS = 5 * 60 * 1000; // 5 minutes
export const IDLE_WARN_MS = 30 * 1000; // warn for the last 30 seconds
export const IDLE_STORAGE_KEY = "workshop-last-active";

export type IdleState = { idleMs: number; secondsLeft: number | null; expired: boolean };

/** Pure helper (easy to test): what should the screen do after `idleMs` without activity? */
export function idleState(idleMs: number): IdleState {
  if (idleMs >= IDLE_LOGOUT_MS) return { idleMs, secondsLeft: 0, expired: true };
  if (idleMs >= IDLE_LOGOUT_MS - IDLE_WARN_MS) {
    return { idleMs, secondsLeft: Math.ceil((IDLE_LOGOUT_MS - idleMs) / 1000), expired: false };
  }
  return { idleMs, secondsLeft: null, expired: false };
}
