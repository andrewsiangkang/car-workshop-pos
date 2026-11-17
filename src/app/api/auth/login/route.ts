import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { sessionCookieFor, COOKIE } from "@/lib/auth";
import { reserveLoginAttempt, clearLoginFailures, readLoginFailures } from "@/lib/login-throttle";
import { requestOrigin } from "@/lib/accounts-local";
import { writeAuditLog } from "@/lib/audit";
import { lockWaitSeconds } from "@/lib/accounts-core.mjs";
import { clipText, createWindowLimiter } from "@/lib/privacy-audit.mjs";

// Hash of a random string, computed once, so unknown usernames cost the same
// time as wrong passwords (no username enumeration by timing).
let dummyHash: Promise<string> | null = null;
async function getDummyHash() {
  const bcrypt = await import("bcryptjs");
  if (!dummyHash) dummyHash = bcrypt.hash(String(Math.random()), 10);
  return dummyHash;
}

// Failed logins for usernames that do not exist are recorded at most 30 per 10 minutes, so a
// device typing random names cannot fill the audit trail. Known accounts are always recorded
// (their own login lock already limits how often that can happen).
// 【中文】不存在的用户名登录失败，每 10 分钟最多记录 30 条，防止有人乱试用户名把审计日志塞满；已有账号的失败一律记录。
const store = globalThis as typeof globalThis & { __workshopUnknownLoginLimiter?: ReturnType<typeof createWindowLimiter> };
const unknownLimiter = (store.__workshopUnknownLoginLimiter ??= createWindowLimiter(30, 10 * 60 * 1000));

/** The person trying to log in is not known yet. */
const NOT_SIGNED_IN = { id: "", name: "Not signed in", email: "", role: "-" };

/**
 * Audit a refused login: the username typed when it is an account (never the password, and never
 * a name that is no account, which is often a password typed in the wrong box), whether that account exists,
 * the failures in a row and, when this attempt locked the username, an ACCOUNT_LOCKED entry.
 * 【中文】记录登录失败：输入的用户名（绝不记录密码）、账号是否存在、连续失败次数；这次失败导致锁定时，另记一条 ACCOUNT_LOCKED。
 */
async function auditFailedLogin(
  request: Request,
  username: string,
  user: { id: string } | null,
  origin: string,
  scope: "desktop" | undefined
) {
  let notRecordedBefore = 0;
  if (!user) {
    const slot = unknownLimiter.take(Date.now());
    if (!slot.ok) return;
    notRecordedBefore = slot.droppedBefore;
  }
  const { failures, lockedUntil } = await readLoginFailures(username, scope);
  const lockedForSeconds = lockWaitSeconds(lockedUntil, Date.now());
  // Whole characters only (half an emoji would make the audit write fail). A name that is no
  // account is not written down, nor its length: it is often a password typed in the wrong box,
  // and the audit trail can never be edited. 【中文】不存在的用户名不记录，长度也不记（常常是把密码打错格）。
  const shown = user ? clipText(username, 100) : "(unknown username)";
  const base = { username: shown, accountExists: !!user, failuresInRow: failures, from: origin };
  await writeAuditLog({
    actor: NOT_SIGNED_IN,
    request,
    action: "LOGIN_FAILED",
    entityType: "User",
    entityId: user?.id ?? null,
    summary: `Failed login for "${shown}"`,
    details: notRecordedBefore ? { ...base, notRecordedBefore } : base,
  });
  if (lockedForSeconds > 0) {
    await writeAuditLog({
      actor: NOT_SIGNED_IN,
      request,
      action: "ACCOUNT_LOCKED",
      entityType: "User",
      entityId: user?.id ?? null,
      summary: `Username "${shown}" locked for ${Math.ceil(lockedForSeconds / 60)} minute(s) after ${failures} failed logins`,
      details: { ...base, lockedForSeconds, lockedUntil },
    });
  }
}

// 【中文】登录：按用户名限速（指数退避，最多 15 分钟）；已确认是这台电脑上的桌面程序（requestOrigin = desktop）时用单独的限速桶，
// 局域网设备猜密码锁不住桌面程序，但本机上的程序猜密码也同样受限速；停用的账号不能登录。
// 注意：打开「手机 / 平板访问」时，桌面程序要发送 X-Workshop-Desktop 证明头（electron/main.js）才会被确认，否则和其他设备共用同一个桶。
// 手机、平板等其他设备的登录 12 小时有效，店里电脑 7 天（见 sessionCookieFor）。
export async function POST(request: Request) {
  try {
    const { username, password } = await request.json();
    const email = String(username || "").trim().toLowerCase();
    const pwd = String(password || "");
    if (!email || !pwd) {
      return NextResponse.json({ error: "Username and password required" }, { status: 400 });
    }

    // Keyed by username only: client IP headers can be forged, so they are not trusted.
    // A request PROVEN to come from the desktop app on the shop computer uses its own bucket, so
    // a LAN device guessing the boss's password cannot keep the boss out of the desktop app, while
    // guessing from this PC (a browser, a script) is still slowed down like anywhere else.
    // Proven = phone / tablet access off (server only on 127.0.0.1), or the desktop app's
    // X-Workshop-Desktop header (accounts-local.ts). Without that header, while phone access
    // is on, the desktop window is only "loopback" and shares the bucket of every other device.
    const origin = requestOrigin(request);
    const fromShopComputer = origin === "desktop";
    const scope = fromShopComputer ? ("desktop" as const) : undefined;
    // Counts this attempt and checks the lock in one atomic step, before the password check.
    const gate = await reserveLoginAttempt(email, scope);
    if (!gate.ok) {
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${Math.ceil(gate.waitSeconds / 60)} minute(s).` },
        { status: 429, headers: { "Retry-After": String(gate.waitSeconds) } }
      );
    }

    const user = await prisma.user.findUnique({ where: { email } });
    const bcrypt = await import("bcryptjs");
    const ok = await bcrypt.compare(pwd, user?.passwordHash || (await getDummyHash()));
    if (!user || !ok) {
      // The attempt was already counted by reserveLoginAttempt(). Recorded after the answer is
      // sent, so the reply takes the same time whether or not the username exists.
      after(() => auditFailedLogin(request, email, user ? { id: user.id } : null, origin, scope).catch((e) => console.error(e)));
      return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
    }
    // Only told after the right password (same timing as a wrong one), so it does not reveal accounts.
    if (user.disabledAt) {
      await writeAuditLog({
        actor: NOT_SIGNED_IN,
        request,
        action: "LOGIN_REFUSED_DISABLED",
        entityType: "User",
        entityId: user.id,
        summary: `Login refused: account "${clipText(user.email, 100)}" is disabled`,
        details: { username: clipText(user.email, 100), from: origin },
      });
      return NextResponse.json(
        { error: "This account has been disabled. Ask the boss to enable it again." },
        { status: 403 }
      );
    }
    await clearLoginFailures(email);
    if (fromShopComputer) await clearLoginFailures(email, "desktop");

    const { token, options } = sessionCookieFor(request, user);
    const res = NextResponse.json({ ok: true, name: user.name });
    res.cookies.set(COOKIE, token, options);
    return res;
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
