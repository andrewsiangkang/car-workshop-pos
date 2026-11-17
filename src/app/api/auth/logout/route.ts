import { NextResponse } from "next/server";
import { COOKIE, sessionCookieOptions, getCurrentUser, revokeUserSessions } from "@/lib/auth";
import { logoutEndsAllSessions } from "@/lib/accounts-core.mjs";
import { writeAuditLog } from "@/lib/audit";

/**
 * Log out this device (its cookie is always cleared).
 * Body {"everywhere": true} — a deliberate "Log Out" — also ends this account's sessions on the
 * server, so a copied cookie stops working; with no session table that signs the account out on
 * EVERY device. The 5-minute idle logout sends no body: it must not end the same account's
 * session on another device in the middle of a work order. See sessionFingerprint() in auth.ts.
 */
// 【中文】登出本设备（总是清除本设备 cookie）。只有带 {"everywhere": true}（用户主动登出）时，才在服务器端让该账号所有登录失效；
// 闲置自动登出不带这个参数，不会把其他设备上同一账号正在进行的工作登出。
export async function POST(request: Request) {
  // No body or not JSON (the idle logout): this device only.
  const body = await request.json().catch(() => null);
  if (logoutEndsAllSessions(body)) {
    try {
      const user = await getCurrentUser();
      if (user) {
        await revokeUserSessions(user.id);
        // Security event: every login of this account was ended. 【中文】安全事件：该账号所有设备的登录都已结束。
        await writeAuditLog({
          actor: user,
          request,
          action: "LOGOUT_EVERYWHERE",
          entityType: "User",
          entityId: user.id,
          summary: "Logged out on every device",
          details: { username: user.email },
        });
      }
    } catch (e) {
      // Still clear the cookie below; the user asked to leave.
      console.error(e);
    }
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, "", { ...sessionCookieOptions(request), maxAge: 0 });
  return res;
}
