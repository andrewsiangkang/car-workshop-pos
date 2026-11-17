import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sessionCookieFor, COOKIE, MIN_PASSWORD_LENGTH } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { requestOrigin, setupCodeAccepted, forgetSetupCode } from "@/lib/accounts-local";
import { setupDecision } from "@/lib/accounts-core.mjs";
import { createWindowLimiter } from "@/lib/privacy-audit.mjs";

// Refused first-run setup attempts are recorded (security events), at most 20 per 10 minutes.
// 【中文】被拒绝的首次设置尝试会记入审计日志（安全事件），每 10 分钟最多 20 条。
const store = globalThis as typeof globalThis & { __workshopSetupRefusalLimiter?: ReturnType<typeof createWindowLimiter> };
const refusalLimiter = (store.__workshopSetupRefusalLimiter ??= createWindowLimiter(20, 10 * 60 * 1000));

const SETUP_REFUSED = {
  NOT_LOCAL:
    "First-time setup can only be done on the shop computer itself. Open the POS app on that computer to create the boss account.",
  LAN_ON:
    "Phone / tablet access is on, so this computer cannot be confirmed as the shop computer. Turn phone / tablet access off, then create the boss account.",
  NEED_CODE:
    "Enter the setup code shown in the server window on the shop computer (the window opened by start.bat). It proves you are at the shop computer.",
} as const;
const WRONG_SETUP_CODE = "That setup code is not right. Check the server window on the shop computer and try again.";

/**
 * Before the first account exists, anyone who can reach the server could claim the boss account.
 * Only the shop computer may do it: Host must be this computer (blocks LAN devices and
 * DNS-rebinding web pages) and so must the client address. On a dev / manual run those two
 * headers can be faked from the LAN, so the one-time code from the server window is needed too.
 * Rules: setupDecision() in accounts-core.mjs.
 */
// 【中文】首次设置（创建老板账号）只允许在这台电脑上进行，挡住局域网设备和 DNS 重绑定网页；
// 手动运行（start.bat / npm run dev）时还要输入服务器窗口显示的一次性设置码。
function checkSetupOrigin(request: Request, setupCode?: unknown) {
  const origin = requestOrigin(request);
  const lan = process.env.WORKSHOP_LAN_ACCESS;
  const first = setupDecision(origin, lan);
  if (first.ok || first.code !== "NEED_CODE") return { ...first, origin };
  // Also creates the code (and prints it in the server window) the first time it is needed.
  return { ...setupDecision(origin, lan, setupCodeAccepted(setupCode)), origin };
}

export async function POST(request: Request) {
  try {
    const count = await prisma.user.count();
    if (count > 0) {
      return NextResponse.json({ error: "Already set up" }, { status: 400 });
    }
    // Read first: the setup code travels in the body. A bad body then fails the checks below.
    const { username, password, name, setupCode } = (await request.json().catch(() => null)) ?? {};
    const here = checkSetupOrigin(request, setupCode);
    if (!here.ok) {
      const typedCode = here.code === "NEED_CODE" && typeof setupCode === "string" && setupCode.trim() !== "";
      const slot = refusalLimiter.take(Date.now());
      if (slot.ok) {
        await writeAuditLog({
          actor: { id: "", name: "Not signed in", email: "", role: "-" },
          request,
          action: "SETUP_REFUSED",
          entityType: "User",
          entityId: null,
          summary: typedCode ? "First-time setup refused: wrong setup code" : `First-time setup refused (${here.code})`,
          details: { reason: typedCode ? "WRONG_CODE" : here.code, from: here.origin, ...(slot.droppedBefore ? { notRecordedBefore: slot.droppedBefore } : {}) },
        });
      }
      return NextResponse.json(
        { error: typedCode ? WRONG_SETUP_CODE : SETUP_REFUSED[here.code], code: here.code },
        { status: 403 }
      );
    }

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
    forgetSetupCode();
    await writeAuditLog({
      actor: { id: user.id, name: user.name, email: user.email, role: String(user.role) },
      request,
      action: "USER_CREATED",
      entityType: "User",
      entityId: user.id,
      summary: "First-time setup: boss account created",
      // How this computer was confirmed: "desktop" (the app) or "loopback" (with the setup code).
      details: { role: user.role, origin: here.origin },
    });

    const { token, options } = sessionCookieFor(request, user);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE, token, options);
    return res;
  } catch (e) {
    console.error(e);
    if ((e as { code?: string } | null)?.code === "P2002") return NextResponse.json({ error: "Username already exists" }, { status: 409 });
    return NextResponse.json({ error: "Setup failed" }, { status: 500 });
  }
}

/** needsSetup for the login page; while setup is still open, also whether THIS device may do it. */
export async function GET(request: Request) {
  const count = await prisma.user.count();
  if (count > 0) return NextResponse.json({ needsSetup: false });
  const here = checkSetupOrigin(request);
  return NextResponse.json({
    needsSetup: true,
    setupHere: here.ok ? { ok: true } : { ok: false, code: here.code, error: SETUP_REFUSED[here.code] },
  });
}
