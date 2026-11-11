import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSessionToken, sessionCookieOptions, COOKIE } from "@/lib/auth";

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

    if (!email || pwd.length < 4) {
      return NextResponse.json({ error: "Username required and password at least 4 characters" }, { status: 400 });
    }

    const bcrypt = await import("bcryptjs");
    const hash = await bcrypt.hash(pwd, 10);

    const user = await prisma.user.create({
      data: {
        name: displayName,
        email,
        passwordHash: hash,
        role: "OWNER",
      },
    });

    const token = createSessionToken(user.id);
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
