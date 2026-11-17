export const MIN_PASSWORD_LENGTH: 8;

export const LOGIN_FREE_ATTEMPTS: number;
export const LOGIN_BASE_LOCK_SECONDS: number;
export const LOGIN_MAX_LOCK_SECONDS: number;
export const LOGIN_RESET_AFTER_MS: number;
export function lockSecondsAfter(failures: number): number;
export function lockSteps(): Array<[number, number]>;
export function buildReserveAttemptSql(key: string, nowMs: number): { sql: string; params: Array<string | number | null> };
export function waitSecondsUntil(lockedUntil: string | Date | number | null | undefined, nowMs: number): number;
export function lockWaitSeconds(lockedUntil: string | Date | number | null | undefined, nowMs: number): number;
export function reserveLoginWithRetry(io: {
  reserve: (nowMs: number) => Promise<boolean>;
  readLockedUntil: () => Promise<string | Date | number | null | undefined>;
  now?: () => number;
}): Promise<{ ok: true } | { ok: false; waitSeconds: number }>;

export type RequestOrigin = "desktop" | "loopback" | "remote";
export function hostnameOf(host: string | null | undefined): string;
export function isLoopbackHostname(hostname: string): boolean;
export function isLoopbackAddress(forwardedFor: string | null | undefined): boolean;
export function classifyRequestOrigin(r: {
  host?: string | null;
  forwardedFor?: string | null;
  lanAccess?: string | null;
  desktopProof?: boolean;
  peerAddress?: string | null;
}): RequestOrigin;
export type SetupRefusal = "NOT_LOCAL" | "LAN_ON" | "NEED_CODE";
export function setupDecision(
  origin: RequestOrigin,
  lanAccess: string | null | undefined,
  setupCodeOk?: boolean
): { ok: true } | { ok: false; code: SetupRefusal };

export const SETUP_CODE_ALPHABET: string;
export const SETUP_CODE_LENGTH: number;
export function setupCodeFromBytes(bytes: ArrayLike<number>): string;
export function normalizeSetupCode(s: unknown): string;
export function setupCodeMatches(expected: string | null | undefined, given: unknown): boolean;

export function logoutEndsAllSessions(body: unknown): boolean;

export const SESSION_SECONDS_SHOP_COMPUTER: number;
export const SESSION_SECONDS_LAN_DEVICE: number;
export function sessionMaxAgeSeconds(origin: RequestOrigin): number;
export function cookieShouldBeSecure(r: { forwardedProto?: string | null; urlProtocol?: string | null; force?: string | null }): boolean;

export function sessionFingerprintInput(passwordHash: string, updatedAtMs: number): string;

export function accountChangeError(c: {
  isSelf: boolean;
  currentRole: string;
  currentlyDisabled: boolean;
  nextRole?: string;
  nextDisabled?: boolean;
  otherActiveOwners: number;
}): string;

export function promptValueError(v: {
  value: string;
  required?: boolean;
  minLength?: number;
  confirm?: boolean;
  confirmValue?: string;
}): string;
