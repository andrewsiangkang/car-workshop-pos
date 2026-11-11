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
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function sign(data: string) {
  return crypto.createHmac("sha256", getSecret()).update(data).digest("hex");
}

export function createSessionToken(userId: string) {
  const expiry = Date.now() + MAX_AGE * 1000;
  const payload = `${userId}|${expiry}`;
  const sig = sign(payload);
  return Buffer.from(`${payload}|${sig}`).toString("base64url");
}

export function verifySessionToken(token: string): string | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString();
    const parts = decoded.split("|");
    if (parts.length !== 3) return null;
    const [userId, expiryStr, sig] = parts;
    const payload = `${userId}|${expiryStr}`;
    if (sign(payload) !== sig) return null;
    if (Date.now() > Number(expiryStr)) return null;
    return userId;
  } catch {
    return null;
  }
}

export async function getSessionUserId(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: MAX_AGE,
    // App is served over plain http on localhost / LAN, so a Secure cookie would never be stored.
    secure: false,
  };
}

/** Call at the top of every protected API handler. Returns a 401 response or null. */
export async function requireAuth(): Promise<NextResponse | null> {
  let id: string | null = null;
  try {
    id = await getSessionUserId();
  } catch {
    id = null;
  }
  if (!id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return null;
}

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: string;
};

/** Load the logged-in user (fresh from DB, so role changes / deletions take effect immediately). */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  try {
    const id = await getSessionUserId();
    if (!id) return null;
    const u = await prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, role: true },
    });
    return u ? { ...u, role: String(u.role) } : null;
  } catch {
    return null;
  }
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

export { COOKIE };
