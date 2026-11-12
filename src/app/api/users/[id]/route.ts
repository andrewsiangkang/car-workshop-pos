import { NextResponse } from "next/server";
import {
  MIN_PASSWORD_LENGTH,
  requireOwner,
  getCurrentUser,
  createSessionToken,
  sessionCookieOptions,
  COOKIE,
} from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

const ASSIGNABLE_ROLES = ["STAFF", "OWNER"];

/** Reset password / rename / change role (boss only). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const { id } = await params;
    const me = await getCurrentUser();
    const b = await request.json();
    const data: Record<string, unknown> = {};

    if (b.name != null) {
      const name = String(b.name).trim();
      if (!name) return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
      data.name = name;
    }

    if (b.password != null && String(b.password) !== "") {
      const pwd = String(b.password);
      if (pwd.length < MIN_PASSWORD_LENGTH) {
        return NextResponse.json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` }, { status: 400 });
      }
      const bcrypt = await import("bcryptjs");
      data.passwordHash = await bcrypt.hash(pwd, 10);
    }

    if (b.role != null) {
      if (!ASSIGNABLE_ROLES.includes(b.role)) {
        return NextResponse.json({ error: "Invalid role" }, { status: 400 });
      }
      if (me && me.id === id && b.role !== "OWNER") {
        return NextResponse.json({ error: "You cannot remove your own boss access" }, { status: 400 });
      }
      data.role = b.role;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const user = await prisma.user.update({
      where: { id },
      data,
      select: { id: true, name: true, email: true, role: true, passwordHash: true },
    });
    if (me) await writeAuditLog({ actor: me, request, action: "USER_UPDATED", entityType: "User", entityId: user.id, summary: `User account updated`, details: { changedFields: Object.keys(data).filter((field) => field !== "passwordHash"), passwordReset: Boolean(data.passwordHash), role: user.role } });
    const res = NextResponse.json({ id: user.id, name: user.name, username: user.email, role: user.role });
    // A password change invalidates all sessions of that user. If the boss changed
    // their own password, give this browser a fresh cookie so they stay logged in.
    if (data.passwordHash && me && me.id === id) {
      res.cookies.set(COOKIE, createSessionToken(user.id, user.passwordHash), sessionCookieOptions());
    }
    return res;
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to update account" }, { status: 500 });
  }
}

/** Delete an account (boss only). Accounts that already created work orders cannot be deleted. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const { id } = await params;
    const me = await getCurrentUser();
    if (me && me.id === id) {
      return NextResponse.json({ error: "You cannot delete your own account" }, { status: 400 });
    }

    const target = await prisma.user.findUnique({
      where: { id },
      select: { _count: { select: { workOrdersCreated: true, workOrdersAssigned: true } } },
    });
    if (!target) return NextResponse.json({ error: "Account not found" }, { status: 404 });
    if (target._count.workOrdersCreated > 0 || target._count.workOrdersAssigned > 0) {
      return NextResponse.json(
        {
          error:
            "This account already has work orders on record, so it can't be deleted. Reset its password instead if you want to lock the person out.",
        },
        { status: 409 }
      );
    }

    await prisma.user.delete({ where: { id } });
    if (me) await writeAuditLog({ actor: me, request, action: "USER_DELETED", entityType: "User", entityId: id, summary: `User account deleted` });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to delete account" }, { status: 500 });
  }
}
