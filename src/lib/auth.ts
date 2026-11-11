import { cookies } from "next/headers";
import crypto from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Secret is generated per installation by the desktop app and passed in via AUTH_SECRET.
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
export const MIN_PASSWORD_LENGTH = 8;

function sign(data: string) {
  return crypto.createHmac("sha256", getSecret()).update(data).digest("hex");
}

/**
 * Short fingerprint of the user's current password hash. It is baked into the
 * session token, so changing / resetting a password logs out every old session.
 */
function passwordFingerprint(passwordHash: string) {
  return sign("pw:" + passwordHash).slice(0, 16);
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function createSessionToken(userId: string, passwordHash: string) {
  const expiry = Date.now() + MAX_AGE * 1000;
  const payload = `${userId}|${expiry}|${passwordFingerprint(passwordHash)}`;
  const sig = sign(payload);
  return Buffer.from(`${payload}|${sig}`).toString("base64url");
}

type TokenData = { userId: string; fp: string };

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
export async function requireOwner(): Promise<NextResponse | null> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isOwner(user)) {
    return NextResponse.json({ error: "Only the boss can do this" }, { status: 403 });
  }
  return null;
}

// ---------- Login brute-force protection (in-memory, per username + IP) ----------
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
const fails = new Map<string, { count: number; until: number }>();

/** Seconds the key is still locked for (0 = not locked). */
export function loginLockedFor(key: string): number {
  const f = fails.get(key);
  if (!f || !f.until) return 0;
  if (Date.now() < f.until) return Math.ceil((f.until - Date.now()) / 1000);
  fails.delete(key);
  return 0;
}
export function recordLoginFailure(key: string) {
  const f = fails.get(key) || { count: 0, until: 0 };
  f.count += 1;
  if (f.count >= MAX_FAILS) {
    f.until = Date.now() + LOCK_MS;
    f.count = 0;
  }
  fails.set(key, f);
  if (fails.size > 5000) fails.clear(); // memory guard
}
export function clearLoginFailures(key: string) {
  fails.delete(key);
}

export { COOKIE };
