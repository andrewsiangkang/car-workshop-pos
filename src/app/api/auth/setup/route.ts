import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSessionToken, sessionCookieOptions, COOKIE, MIN_PASSWORD_LENGTH } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const count = await prisma.user.count();
    if (count > 0) {
      return NextResponse.json({ error: "Already set up" }, { status: 400 });
    }

    const { username, password, name } = await request.json();
    const email = String(username || "").trim().toLowerCase();
    const pwd = String(password || "");
    const displayName = String(name || "Owner").trim() || "Owner";

    if (!email || pwd.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: `Username required and password at least ${MIN_PASSWORD_LENGTH} characters` },
        { status: 400 }
      );
    }

    const bcrypt = await import("bcryptjs");
    const hash = await bcrypt.hash(pwd, 10);

    // Re-check inside the transaction so two simultaneous setup requests cannot both create an owner.
    const user = await prisma.$transaction(async (tx) => {
      if ((await tx.user.count()) > 0) return null;
      return tx.user.create({
        data: { name: displayName, email, passwordHash: hash, role: "OWNER" },
      });
    });
    if (!user) return NextResponse.json({ error: "Already set up" }, { status: 400 });

    const token = createSessionToken(user.id, user.passwordHash);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE, token, sessionCookieOptions());
    return res;
  } catch (e: any) {
    console.error(e);
    if (e.code === "P2002") return NextResponse.json({ error: "Username already exists" }, { status: 409 });
    return NextResponse.json({ error: "Setup failed" }, { status: 500 });
  }
}

export async function GET() {
  const count = await prisma.user.count();
  return NextResponse.json({ needsSetup: count === 0 });
}
