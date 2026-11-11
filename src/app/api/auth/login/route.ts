import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  createSessionToken,
  sessionCookieOptions,
  COOKIE,
  loginLockedFor,
  recordLoginFailure,
  clearLoginFailures,
} from "@/lib/auth";

// Hash of a random string, computed once, so unknown usernames cost the same
// time as wrong passwords (no username enumeration by timing).
let dummyHash: Promise<string> | null = null;
async function getDummyHash() {
  const bcrypt = await import("bcryptjs");
  if (!dummyHash) dummyHash = bcrypt.hash(String(Math.random()), 10);
  return dummyHash;
}

export async function POST(request: Request) {
  try {
    const { username, password } = await request.json();
    const email = String(username || "").trim().toLowerCase();
    const pwd = String(password || "");
    if (!email || !pwd) {
      return NextResponse.json({ error: "Username and password required" }, { status: 400 });
    }

    // Keyed by username only: client IP headers can be forged, so they are not trusted.
    const key = email;
    const wait = loginLockedFor(key);
    if (wait > 0) {
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${Math.ceil(wait / 60)} minute(s).` },
        { status: 429, headers: { "Retry-After": String(wait) } }
      );
    }

    const user = await prisma.user.findUnique({ where: { email } });
    const bcrypt = await import("bcryptjs");
    const ok = await bcrypt.compare(pwd, user?.passwordHash || (await getDummyHash()));
    if (!user || !ok) {
      recordLoginFailure(key);
      return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
    }
    clearLoginFailures(key);

    const token = createSessionToken(user.id, user.passwordHash);
    const res = NextResponse.json({ ok: true, name: user.name });
    res.cookies.set(COOKIE, token, sessionCookieOptions());
    return res;
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
