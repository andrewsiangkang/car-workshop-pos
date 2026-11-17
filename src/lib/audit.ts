import { prisma } from "@/lib/prisma";
import type { CurrentUser } from "@/lib/auth";
import { auditAddress, auditEntryHash, clipText, nextChainLink } from "@/lib/privacy-audit.mjs";
import { trustedPeerAddress } from "@/lib/privacy-peer";

type AuditInput = {
  actor: CurrentUser;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  details?: Record<string, unknown>;
  request?: Request;
};

const MAX_DETAILS = 4000;

/** Details as JSON text; a value that is too long is kept as a valid JSON preview, not cut mid-way. */
function detailsText(details: Record<string, unknown> | undefined): string | null {
  if (!details || Object.keys(details).length === 0) return null;
  const s = JSON.stringify(details);
  if (s.length <= MAX_DETAILS) return s;
  return JSON.stringify({ truncated: true, preview: s.slice(0, MAX_DETAILS - 100) });
}

// Audit writes from this server run one at a time, so two of them can never take the same seq
// (SQLite would otherwise fail one of two parallel read-then-write transactions).
// 【中文】本服务器的审计写入一条一条排队执行，两条记录不会拿到同一个序号。
const queue = globalThis as typeof globalThis & { __workshopAuditQueue?: Promise<unknown> };
function serialised<T>(job: () => Promise<T>): Promise<T> {
  const run = (queue.__workshopAuditQueue ?? Promise.resolve()).then(job, job);
  queue.__workshopAuditQueue = run.catch(() => undefined);
  return run;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Row = {
  actorUserId: string | null;
  actorName: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  details: string | null;
  ipAddress: string | null;
  createdAt: Date;
};

/**
 * Insert the entry and link it to the newest chained entry, in one transaction:
 * seq = previous seq + 1, prevHash = previous hash, hash = SHA-256 of the entry (privacy-audit.mjs).
 * The insert comes first, so the transaction holds SQLite's write lock before it reads the chain.
 * A busy database is retried a few times.
 * 【中文】在一个交易里先插入记录、再接到哈希链上（序号 = 上一条 + 1，prevHash = 上一条的哈希）；数据库忙时重试几次。
 */
async function appendChained(row: Row) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const created = await tx.auditLog.create({ data: row });
          const last = await tx.auditLog.findFirst({
            where: { seq: { not: null } },
            orderBy: { seq: "desc" },
            select: { seq: true, hash: true },
          });
          const link = nextChainLink(last);
          const hash = auditEntryHash({ ...row, ...link });
          return tx.auditLog.update({ where: { id: created.id }, data: { ...link, hash } });
        },
        { maxWait: 5_000, timeout: 10_000 }
      );
    } catch (error) {
      if (attempt >= 2) throw error;
      await sleep(80 * 2 ** attempt + Math.floor(Math.random() * 50));
    }
  }
}

/**
 * Persist a business event without storing passwords, tokens, secrets or full card/bank data.
 * Every entry is chained to the one before it (tamper evidence, see privacy-audit.mjs). The address
 * is the socket address seen by this server; an X-Forwarded-For sent by the client is only kept in
 * the details as "ipReported".
 * 【中文】写入审计日志（不存密码、令牌、密钥或完整的卡号 / 银行账号）。每条记录接在上一条后面形成哈希链；
 * 地址取服务器看到的真实连接地址，客户端自称的 X-Forwarded-For 只作为 ipReported 记在详情里。
 */
export async function writeAuditLog(input: AuditInput) {
  const request = input.request;
  const where = auditAddress({
    peer: trustedPeerAddress(request),
    forwardedFor: request?.headers.get("x-forwarded-for"),
    realIp: request?.headers.get("x-real-ip"),
  });
  const details = where.reported ? { ...(input.details || {}), ipReported: where.reported } : input.details;
  const row: Row = {
    // empty id = not a logged-in user (customer QR form, a failed login) → stored as null, not ""
    actorUserId: input.actor.id || null,
    // Cut by whole characters: half an emoji would make the database refuse the entry (clipText).
    // 【中文】按完整字符截短，半个表情符号会让数据库拒绝写入。
    actorName: clipText(input.actor.name || "", 120),
    actorRole: clipText(input.actor.role || "", 40),
    action: clipText(input.action.trim(), 60),
    entityType: clipText(input.entityType.trim(), 60),
    entityId: input.entityId ? clipText(input.entityId, 200) : null,
    summary: clipText(input.summary.trim(), 240),
    details: detailsText(details),
    ipAddress: where.ipAddress,
    // Set here (not by the database) because it is part of the hash. Millisecond precision.
    createdAt: new Date(),
  };
  try {
    return await serialised(() => appendChained(row));
  } catch (error) {
    // Never report a completed business mutation as failed just because its audit write failed.
    // Last resort: keep the event without a chain link (Verify shows it as outside the chain),
    // rather than losing it. The failure stays visible in the server log.
    console.error("Audit log chain write failed", error);
    try {
      return await prisma.auditLog.create({ data: row });
    } catch (again) {
      console.error("Audit log write failed", again);
      return null;
    }
  }
}
