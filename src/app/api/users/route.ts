import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const ASSIGNABLE_ROLES = ["STAFF", "OWNER"];

/** List accounts (boss only). Never returns password hashes. */
export async function GET() {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        _count: { select: { workOrdersCreated: true } },
      },
    });
    return NextResponse.json(
      users.map((u) => ({
        id: u.id,
        name: u.name,
        username: u.email,
        role: u.role,
        createdAt: u.createdAt,
        ordersCreated: u._count.workOrdersCreated,
      }))
    );
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to load accounts" }, { status: 500 });
  }
}

/** Create a staff (or second boss) account (boss only). */
export async function POST(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const b = await request.json();
    const username = String(b.username || "").trim().toLowerCase();
    const name = String(b.name || "").trim() || username;
    const password = String(b.password || "");
    const role = ASSIGNABLE_ROLES.includes(b.role) ? b.role : "STAFF";

    if (!username) return NextResponse.json({ error: "Username is required" }, { status: 400 });
    if (password.length < 4) {
      return NextResponse.json({ error: "Password must be at least 4 characters" }, { status: 400 });
    }

    const bcrypt = await import("bcryptjs");
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { name, email: username, passwordHash, role },
      select: { id: true, name: true, email: true, role: true },
    });
    return NextResponse.json(
      { id: user.id, name: user.name, username: user.email, role: user.role },
      { status: 201 }
    );
  } catch (e: any) {
    console.error(e);
    if (e.code === "P2002") return NextResponse.json({ error: "Username already exists" }, { status: 409 });
    return NextResponse.json({ error: "Failed to create account" }, { status: 500 });
  }
}
