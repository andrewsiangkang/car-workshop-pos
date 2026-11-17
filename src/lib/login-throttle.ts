import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { buildReserveAttemptSql, reserveLoginWithRetry } from "@/lib/accounts-core.mjs";

/**
 * Throttle bucket of a username. Proven desktop-app logins get their own bucket ("desktop"): a
 * LAN device guessing the boss's password cannot lock the boss out of the desktop window, but
 * the desktop window (and any program on this PC) is still limited. A plain key is always
 * exactly 64 hex characters, so no username can produce the suffixed key.
 * 【中文】每个用户名一个限速桶；已确认的桌面程序登录用单独的桶（"desktop"），任何用户名都算不出这个桶的键。
 */
export type ThrottleScope = "desktop";
const keyFor = (email: string, scope?: ThrottleScope) =>
  crypto.createHash("sha256").update(email.trim().toLowerCase()).digest("hex") + (scope ? ":" + scope : "");

/**
 * Persistent per-username throttle with exponential backoff (30 s doubling, at most 15 minutes;
 * rules in accounts-core.mjs). Stores only a digest of the normalised username.
 * Call BEFORE checking the password: one SQL statement counts this attempt and sets the lock,
 * unless the username is locked right now, so parallel requests cannot get around it.
 * A correct password then calls clearLoginFailures().
 * 【中文】按用户名限速（指数退避，最多锁 15 分钟）。核对密码之前先调用：一条 SQL 原子地「先记一次」，被锁时直接拒绝。
 */
export async function reserveLoginAttempt(
  email: string,
  scope?: ThrottleScope
): Promise<{ ok: true } | { ok: false; waitSeconds: number }> {
  const key = keyFor(email, scope);
  const now = Date.now();
  // Bound table growth if someone submits many different account names.
  await prisma.$executeRawUnsafe(
    `DELETE FROM "LoginThrottle" WHERE "updatedAt" < ?`,
    new Date(now - 24 * 60 * 60 * 1000).toISOString()
  );
  // Reserve; if refused, read the lock time. A row that vanished in between (a correct login
  // cleared it) or a lock that just ended gets one more try, not a false "wait 15 minutes".
  return reserveLoginWithRetry({
    reserve: async (nowMs) => {
      const { sql, params } = buildReserveAttemptSql(key, nowMs);
      return (await prisma.$executeRawUnsafe(sql, ...params)) > 0;
    },
    readLockedUntil: async () => {
      // CAST: read the stored text as-is (rows from older versions used another date format).
      const rows = await prisma.$queryRawUnsafe<Array<{ lockedUntil: string | null }>>(
        `SELECT CAST("lockedUntil" AS TEXT) AS "lockedUntil" FROM "LoginThrottle" WHERE "key" = ?`,
        key
      );
      return rows[0]?.lockedUntil ?? null;
    },
  });
}

export async function clearLoginFailures(email: string, scope?: ThrottleScope): Promise<void> {
  await prisma.$executeRawUnsafe(`DELETE FROM "LoginThrottle" WHERE "key" = ?`, keyFor(email, scope));
}

/**
 * Failed attempts in a row for this username and the lock time, for the audit log (read after a
 * wrong password). Never throws: returns zero when it cannot be read.
 * 【中文】读取这个用户名连续失败的次数和锁定时间（写审计日志用）；读不到时返回 0。
 */
export async function readLoginFailures(
  email: string,
  scope?: ThrottleScope
): Promise<{ failures: number; lockedUntil: string | null }> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ failures: number | bigint; lockedUntil: string | null }>>(
      `SELECT "failures", CAST("lockedUntil" AS TEXT) AS "lockedUntil" FROM "LoginThrottle" WHERE "key" = ?`,
      keyFor(email, scope)
    );
    return { failures: Number(rows[0]?.failures ?? 0), lockedUntil: rows[0]?.lockedUntil ?? null };
  } catch {
    return { failures: 0, lockedUntil: null };
  }
}
