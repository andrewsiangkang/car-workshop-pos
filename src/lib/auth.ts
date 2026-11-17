import { cookies } from "next/headers";
import crypto from "crypto";
import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE, getAuthSecret } from "@/lib/session-token.mjs";
import {
  MIN_PASSWORD_LENGTH as MIN_PW,
  sessionFingerprintInput,
  sessionMaxAgeSeconds,
  cookieShouldBeSecure,
  SESSION_SECONDS_SHOP_COMPUTER,
} from "@/lib/accounts-core.mjs";
import { requestOrigin } from "@/lib/accounts-local";

// Secret is generated per installation by the desktop app and passed in via AUTH_SECRET.
// (Shared with middleware.ts, which checks the same signature before any page runs.)
const getSecret = getAuthSecret;
const COOKIE = SESSION_COOKIE;
// 7 days on the shop computer; 12 hours from a phone / tablet / other PC (see sessionCookieFor).
const MAX_AGE = SESSION_SECONDS_SHOP_COMPUTER;

/** Minimum password length for every account (defined in accounts-core.mjs so browser pages can use it too). */
// 【中文】密码最少长度（8 位）；定义在 accounts-core.mjs，网页端也能引用。
export const MIN_PASSWORD_LENGTH = MIN_PW;

// 【中文】用密钥对数据做 HMAC 签名。
function sign(data: string) {
  return crypto.createHmac("sha256", getSecret()).update(data).digest("hex");
}

/** What a login cookie is bound to. Pass the user row as read from the database. */
export type SessionUser = { id: string; passwordHash: string; updatedAt: Date };

/**
 * Short fingerprint of the user's password hash AND the account's updatedAt. It is baked into
 * the session token, so a password change / reset, a "log out everywhere" (revokeUserSessions),
 * disabling the account, or any other edit of the account row ends every old session of that user.
 * Trade-off (no session table, so no schema change): sessions cannot be ended one device at a time.
 * Which logouts end the account's sessions on EVERY device (POST /api/auth/logout):
 * - body {"everywhere": true}, sent by a deliberate "Log Out" (the Sidebar button) — yes (a shared
 *   staff login is signed out on every tablet);
 * - the 5-minute idle logout (no body) — no: it only clears the cookie on its own device, so a
 *   phone waking up in a pocket cannot kill a half-filled work order on the shop computer.
 * Editing an account (rename, role) also signs that person out. Updating to this version signs everyone out once.
 * A per-device Session table would remove this trade-off later.
 */
// 【中文】登录指纹 = 密码哈希 + 账号 updatedAt：改密码、「所有设备登出」、停用、改角色等都会让该用户所有旧登录立刻失效。
// 取舍：没有会话表（不改数据库结构），无法只结束一台设备的登录。只有主动登出（带 everywhere: true）才会让该账号在所有设备上登出；
// 5 分钟闲置自动登出只清除本设备的 cookie，不会影响其他设备。
function sessionFingerprint(u: Pick<SessionUser, "passwordHash" | "updatedAt">) {
  return sign(sessionFingerprintInput(u.passwordHash, new Date(u.updatedAt).getTime())).slice(0, 16);
}

// 【中文】恒定时间比较，防止通过响应时间差猜出签名。
function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// 【中文】登录成功后生成登录凭证（cookie 内容）：用户ID + 到期时间 + 登录指纹 + 签名。
export function createSessionToken(user: SessionUser, maxAgeSeconds: number = MAX_AGE) {
  const expiry = Date.now() + maxAgeSeconds * 1000;
  const payload = `${user.id}|${expiry}|${sessionFingerprint(user)}`;
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

/**
 * Login cookie flags: HttpOnly (scripts cannot read it), SameSite=Strict (never sent by another
 * site), Secure when the request came over HTTPS (or COOKIE_SECURE=1). The app is normally served
 * over plain http on localhost / the shop LAN, where a Secure cookie would never be stored.
 * Pass the request so its lifetime and Secure flag follow where it came from.
 */
// 【中文】登录 cookie 的属性：HttpOnly、SameSite=Strict；HTTPS 请求才加 Secure（明文 HTTP 下加了会存不进去）。
export function sessionCookieOptions(request?: Request, maxAgeSeconds: number = MAX_AGE) {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    path: "/",
    maxAge: maxAgeSeconds,
    secure: cookieShouldBeSecure({
      forwardedProto: request?.headers.get("x-forwarded-proto"),
      urlProtocol: request ? safeProtocol(request.url) : null,
      force: process.env.COOKIE_SECURE,
    }),
  };
}

function safeProtocol(url: string) {
  try {
    return new URL(url).protocol;
  } catch {
    return null;
  }
}

/**
 * A new login cookie for this request. Logins from a phone, tablet or another PC on the shop
 * Wi-Fi last 12 hours (the app has no HTTPS certificate, so the cookie crosses the Wi-Fi in plain
 * text); logins on the shop computer itself last 7 days.
 */
// 【中文】为这次请求生成登录 cookie：手机、平板、其他电脑登录 12 小时有效；店里电脑本机 7 天。
export function sessionCookieFor(request: Request, user: SessionUser) {
  const maxAge = sessionMaxAgeSeconds(requestOrigin(request));
  return { token: createSessionToken(user, maxAge), options: sessionCookieOptions(request, maxAge) };
}

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: string;
};

/**
 * Load the logged-in user fresh from the DB, so role changes, deletions, password
 * resets, logouts and disabled accounts take effect immediately.
 */
// 【中文】取得当前登录用户；会再查数据库，确认用户还存在、没被停用、密码没被重置、没有登出过。
export async function getCurrentUser(): Promise<CurrentUser | null> {
  try {
    const jar = await cookies();
    const token = jar.get(COOKIE)?.value;
    if (!token) return null;
    const t = decodeSessionToken(token);
    if (!t) return null;
    const u = await prisma.user.findUnique({
      where: { id: t.userId },
      select: { id: true, name: true, email: true, role: true, passwordHash: true, updatedAt: true, disabledAt: true },
    });
    // A disabled account counts as logged out everywhere at once.
    if (!u || u.disabledAt || !safeEqual(sessionFingerprint(u), t.fp)) return null;
    return { id: u.id, name: u.name, email: u.email, role: String(u.role) };
  } catch {
    return null;
  }
}

/**
 * End every session of this user (all devices) by moving the account's updatedAt forward,
 * which changes the fingerprint in their login cookies. Called for a deliberate logout
 * ({"everywhere": true}), never for the idle logout. See sessionFingerprint() for the trade-off.
 */
// 【中文】结束该用户在所有设备上的登录（把账号的 updatedAt 往前推，旧 cookie 的指纹就对不上了）。
export async function revokeUserSessions(userId: string): Promise<void> {
  await prisma.user.updateMany({ where: { id: userId }, data: { updatedAt: new Date() } });
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

/**
 * Call at the top of every server page that reads data. A check in layout.tsx alone is
 * not enough: Next.js can render a page segment without re-running its parent layout
 * (partial rendering on client navigation), so the page must check for itself.
 */
// 【中文】页面守卫：每个读取数据的服务器页面开头都要调用。只靠 layout 检查不够，Next.js 局部渲染时可能不会重新执行 layout。
export async function requirePageUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Same as requirePageUser(), and only the boss (OWNER) may continue; staff go to the dashboard. */
// 【中文】老板专属页面守卫：未登录去登录页，员工去首页。
export async function requirePageOwner(): Promise<CurrentUser> {
  const user = await requirePageUser();
  if (!isOwner(user)) redirect("/dashboard");
  return user;
}

export { COOKIE };
