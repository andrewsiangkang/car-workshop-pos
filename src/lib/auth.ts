import { cookies } from "next/headers";
import crypto from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Secret is generated per installation by the desktop app and passed in via AUTH_SECRET.
// 【中文】读取本机专属的签名密钥（AUTH_SECRET），用来给登录凭证签名，防止被伪造。
function getSecret() {
  const s = process.env.AUTH_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET is not set");
  }
  return "dev-only-secret-not-for-production";
}
const COOKIE = "session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days (was 30)

/** Minimum password length for every account. */
// 【中文】密码最少长度（8 位）。
export const MIN_PASSWORD_LENGTH = 8;

// 【中文】用密钥对数据做 HMAC 签名。
function sign(data: string) {
  return crypto.createHmac("sha256", getSecret()).update(data).digest("hex");
}

/**
 * Short fingerprint of the user's current password hash. It is baked into the
 * session token, so changing / resetting a password logs out every old session.
 */
// 【中文】取密码哈希的指纹：登录凭证绑定它，所以老板重置员工密码后，旧登录立刻失效。
function passwordFingerprint(passwordHash: string) {
  return sign("pw:" + passwordHash).slice(0, 16);
}

// 【中文】恒定时间比较，防止通过响应时间差猜出签名。
function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// 【中文】登录成功后生成登录凭证（cookie 内容）：用户ID + 到期时间 + 密码指纹 + 签名。
export function createSessionToken(userId: string, passwordHash: string) {
  const expiry = Date.now() + MAX_AGE * 1000;
  const payload = `${userId}|${expiry}|${passwordFingerprint(passwordHash)}`;
  const sig = sign(payload);
  return Buffer.from(`${payload}|${sig}`).toString("base64url");
}

type TokenData = { userId: string; fp: string };

// 【中文】解析并校验登录凭证：签名不对或已过期则返回空。
function decodeSessionToken(token: string): TokenData | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString();
    const parts = decoded.split("|");
    if (parts.length !== 4) return null;
    const [userId, expiryStr, fp, sig] = parts;
    if (!safeEqual(sign(`${userId}|${expiryStr}|${fp}`), sig)) return null;
    if (!(Date.now() <= Number(expiryStr))) return null;
    return { userId, fp };
  } catch {
    return null;
  }
}

/** Signature + expiry check only (no DB). Use getCurrentUser() for access control. */
export function verifySessionToken(token: string): string | null {
  return decodeSessionToken(token)?.userId ?? null;
}

export async function getSessionUserId(): Promise<string | null> {
  return (await getCurrentUser())?.id ?? null;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    path: "/",
    maxAge: MAX_AGE,
    // App is served over plain http on localhost / LAN, so a Secure cookie would never be stored.
    // If the app is put behind HTTPS, start it with COOKIE_SECURE=1.
    secure: process.env.COOKIE_SECURE === "1",
  };
}

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: string;
};

/**
 * Load the logged-in user fresh from the DB, so role changes, deletions and
 * password resets take effect immediately.
 */
// 【中文】取得当前登录用户；会再查数据库，确认用户还存在且密码没被重置。
export async function getCurrentUser(): Promise<CurrentUser | null> {
  try {
    const jar = await cookies();
    const token = jar.get(COOKIE)?.value;
    if (!token) return null;
    const t = decodeSessionToken(token);
    if (!t) return null;
    const u = await prisma.user.findUnique({
      where: { id: t.userId },
      select: { id: true, name: true, email: true, role: true, passwordHash: true },
    });
    if (!u || !safeEqual(passwordFingerprint(u.passwordHash), t.fp)) return null;
    return { id: u.id, name: u.name, email: u.email, role: String(u.role) };
  } catch {
    return null;
  }
}

/** Call at the top of every protected API handler. Returns a 401 response or null. */
// 【中文】接口守卫：未登录返回 401。所有需要登录的 API 开头都要调用。
export async function requireAuth(): Promise<NextResponse | null> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return null;
}

/** Only the boss (OWNER) may see cost, turnover, profit and settings. STAFF / TECHNICIAN may not. */
export function isOwner(user: { role: string } | null | undefined): boolean {
  return !!user && user.role === "OWNER";
}

/** Call at the top of owner-only API handlers. Returns 401 / 403 response or null. */
// 【中文】接口守卫：只有老板（OWNER）能通过，否则返回 403。
export async function requireOwner(): Promise<NextResponse | null> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isOwner(user)) {
    return NextResponse.json({ error: "Only the boss can do this" }, { status: 403 });
  }
  return null;
}

// ---------- Login brute-force protection (in-memory, per username) ----------
// 【中文】登录防暴力破解（按用户名）：输错越多锁得越久 —— 5 次锁 1 分钟，10 次锁 5 分钟，15 次以上锁 15 分钟。
// 别人故意输错只能让老板等 1 分钟，而不是一下锁 15 分钟；猜密码的人则越猜越慢。重启程序会清零。
// Keyed by username only (client IP headers can be forged). The lock grows with the
// number of failures, so someone on the Wi-Fi typing wrong passwords on purpose only
// delays the real user briefly at first, while guessing stays very slow. A failure
// count is forgotten after 1 hour without failures. Restarting the app clears it.
const STEPS: Array<[number, number]> = [
  [15, 15 * 60 * 1000],
  [10, 5 * 60 * 1000],
  [5, 60 * 1000],
];
const FORGET_MS = 60 * 60 * 1000;
const fails = new Map<string, { count: number; until: number; last: number }>();

/** Seconds the key is still locked for (0 = not locked). */
export function loginLockedFor(key: string): number {
  const f = fails.get(key);
  if (!f) return 0;
  if (Date.now() - f.last > FORGET_MS) {
    fails.delete(key);
    return 0;
  }
  return f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0;
}
export function recordLoginFailure(key: string) {
  const now = Date.now();
  const prev = fails.get(key);
  const f = prev && now - prev.last <= FORGET_MS ? prev : { count: 0, until: 0, last: now };
  f.count += 1;
  f.last = now;
  // Lock at every 5th failure; longer the more failures there have been.
  if (f.count % 5 === 0) {
    const step = STEPS.find(([n]) => f.count >= n);
    if (step) f.until = now + step[1];
  }
  fails.set(key, f);
  if (fails.size > 5000) fails.clear(); // memory guard
}
export function clearLoginFailures(key: string) {
  fails.delete(key);
}

export { COOKIE };
