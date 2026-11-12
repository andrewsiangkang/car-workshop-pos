import crypto from "crypto";
import { prisma } from "@/lib/prisma";

const WINDOW_MS = 60 * 60 * 1000;
const keyFor = (email: string) => crypto.createHash("sha256").update(email.trim().toLowerCase()).digest("hex");

/** Persistent account-based throttle. Stores only a digest of the normalized account identifier. */
export async function loginLockedFor(email: string): Promise<number> {
  const key = keyFor(email);
  const rows = await prisma.$queryRawUnsafe<Array<{ lockedUntil: string | null; windowStartedAt: string }>>(
    `SELECT "lockedUntil", "windowStartedAt" FROM "LoginThrottle" WHERE "key" = ?`, key
  );
  if (!rows.length) return 0;
  const locked = rows[0].lockedUntil ? new Date(rows[0].lockedUntil).getTime() : 0;
  if (Date.now() - new Date(rows[0].windowStartedAt).getTime() > WINDOW_MS) {
    await prisma.$executeRawUnsafe(`DELETE FROM "LoginThrottle" WHERE "key" = ?`, key);
    return 0;
  }
  return locked > Date.now() ? Math.ceil((locked - Date.now()) / 1000) : 0;
}

export async function recordLoginFailure(email: string): Promise<void> {
  const key = keyFor(email);
  const now = new Date();
  // Bound table growth if someone submits many different account names.
  await prisma.$executeRawUnsafe(`DELETE FROM "LoginThrottle" WHERE "updatedAt" < ?`, new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString());
  const cutoff = new Date(now.getTime() - WINDOW_MS).toISOString();
  // One atomic upsert prevents concurrent failed requests from losing increments.
  await prisma.$executeRawUnsafe(
    `INSERT INTO "LoginThrottle" ("key", "failures", "windowStartedAt", "lockedUntil", "updatedAt")
     VALUES (?, 1, ?, NULL, ?)
     ON CONFLICT("key") DO UPDATE SET
       "failures" = CASE WHEN "windowStartedAt" < ? THEN 1 ELSE "failures" + 1 END,
       "windowStartedAt" = CASE WHEN "windowStartedAt" < ? THEN excluded."windowStartedAt" ELSE "windowStartedAt" END,
       "lockedUntil" = CASE
         WHEN (CASE WHEN "windowStartedAt" < ? THEN 1 ELSE "failures" + 1 END) >= 15 THEN datetime(excluded."updatedAt", '+15 minutes')
         WHEN (CASE WHEN "windowStartedAt" < ? THEN 1 ELSE "failures" + 1 END) >= 10 THEN datetime(excluded."updatedAt", '+5 minutes')
         WHEN (CASE WHEN "windowStartedAt" < ? THEN 1 ELSE "failures" + 1 END) >= 5 THEN datetime(excluded."updatedAt", '+1 minute')
         ELSE NULL END,
       "updatedAt" = excluded."updatedAt"`,
    key, now.toISOString(), now.toISOString(), cutoff, cutoff, cutoff, cutoff, cutoff
  );
}

export async function clearLoginFailures(email: string): Promise<void> {
  await prisma.$executeRawUnsafe(`DELETE FROM "LoginThrottle" WHERE "key" = ?`, keyFor(email));
}
