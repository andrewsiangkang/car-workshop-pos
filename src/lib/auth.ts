import { cookies } from "next/headers";
import crypto from "crypto";
import { NextResponse } from "next/server";

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

export { COOKIE };
