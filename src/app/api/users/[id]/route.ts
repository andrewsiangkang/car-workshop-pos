import { NextResponse } from "next/server";
import type { Prisma, Role } from "@prisma/client";
import {
  MIN_PASSWORD_LENGTH,
  requireOwner,
  getCurrentUser,
  sessionCookieFor,
  COOKIE,
} from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { accountChangeError } from "@/lib/accounts-core.mjs";

export const dynamic = "force-dynamic";

const ASSIGNABLE_ROLES = ["STAFF", "OWNER"];

class UserError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/**
 * Reset password / rename / change role / disable or enable (boss only).
 * Body: { name?, password?, role?: "STAFF" | "OWNER", disabled?: boolean }.
 * Any change to an account ends that person's sessions (the login cookie is bound to the row's
 * updatedAt — see auth.ts); a disabled account cannot log in at all until enabled again.
 */
// 【中文】老板修改账号：重置密码、改名、改角色、停用 / 启用。不能停用自己、不能取消自己的老板权限、至少保留一个能登录的老板账号。
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const { id } = await params;
    const me = await getCurrentUser();
    if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const b = await request.json();
    const data: Prisma.UserUpdateInput = {};

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

    let nextRole: Role | undefined;
    if (b.role != null) {
      if (!ASSIGNABLE_ROLES.includes(b.role)) {
        return NextResponse.json({ error: "Invalid role" }, { status: 400 });
      }
      nextRole = b.role as Role;
    }

    let nextDisabled: boolean | undefined;
    if (b.disabled != null) {
      if (typeof b.disabled !== "boolean") return NextResponse.json({ error: "Invalid request" }, { status: 400 });
      nextDisabled = b.disabled;
    }

    if (Object.keys(data).length === 0 && nextRole === undefined && nextDisabled === undefined) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const select = { id: true, name: true, email: true, role: true, disabledAt: true, passwordHash: true, updatedAt: true } as const;
    // Check and write in one transaction, so two bosses cannot both remove the last active Boss.
    const { before, user } = await prisma.$transaction(async (tx) => {
      const before = await tx.user.findUnique({ where: { id }, select });
      if (!before) throw new UserError("Account not found", 404);
      const otherActiveOwners = await tx.user.count({ where: { role: "OWNER", disabledAt: null, id: { not: id } } });
      const problem = accountChangeError({
        isSelf: me.id === id,
        currentRole: String(before.role),
        currentlyDisabled: !!before.disabledAt,
        nextRole,
        nextDisabled,
        otherActiveOwners,
      });
      if (problem) throw new UserError(problem);
      const upd: Prisma.UserUpdateInput = { ...data };
      if (nextRole !== undefined && nextRole !== before.role) upd.role = nextRole;
      if (nextDisabled !== undefined && nextDisabled !== !!before.disabledAt) upd.disabledAt = nextDisabled ? new Date() : null;
      // Nothing really changes (e.g. same role chosen again): leave the row, and its sessions, alone.
      if (Object.keys(upd).length === 0) return { before, user: before };
      return { before, user: await tx.user.update({ where: { id }, data: upd, select }) };
    });

    // Audit: one entry per kind of change, with before / after values.
    const audit = (action: string, summary: string, details: Record<string, unknown>) =>
      writeAuditLog({ actor: me, request, action, entityType: "User", entityId: user.id, summary, details });
    if (user.role !== before.role) {
      await audit("USER_ROLE_CHANGED", `Account role changed from ${before.role} to ${user.role}`, {
        username: user.email,
        before: { role: before.role },
        after: { role: user.role },
      });
    }
    if (!!user.disabledAt !== !!before.disabledAt) {
      await audit(user.disabledAt ? "USER_DISABLED" : "USER_ENABLED", user.disabledAt ? "Account disabled" : "Account enabled", {
        username: user.email,
        role: user.role,
        before: { disabledAt: before.disabledAt },
        after: { disabledAt: user.disabledAt },
      });
    }
    if (data.name !== undefined || data.passwordHash !== undefined) {
      await audit("USER_UPDATED", "User account updated", {
        changedFields: Object.keys(data).filter((field) => field !== "passwordHash"),
        passwordReset: Boolean(data.passwordHash),
        role: user.role,
        ...(data.name !== undefined && data.name !== before.name ? { before: { name: before.name }, after: { name: user.name } } : {}),
      });
    }

    const res = NextResponse.json({
      id: user.id,
      name: user.name,
      username: user.email,
      role: user.role,
      disabledAt: user.disabledAt,
    });
    // Any change to an account ends all of its sessions. If the boss changed their own
    // account, give this browser a fresh cookie so they stay logged in here.
    if (me.id === id && user !== before) {
      const fresh = sessionCookieFor(request, user);
      res.cookies.set(COOKIE, fresh.token, fresh.options);
    }
    return res;
  } catch (e) {
    if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: e.status });
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
            "This account already has work orders on record, so it can't be deleted. Disable it instead to lock the person out; the records are kept.",
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
