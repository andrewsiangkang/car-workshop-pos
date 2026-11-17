// Audit trail rules (pure, no database): the tamper-evident hash chain, before / after values for
// settings changes, the client address, and a small rate limit for floods of failed logins.
// 【中文】审计日志的纯规则：防篡改的哈希链、设置修改的前后值、客户端地址、失败登录的写入限流。
import crypto from "node:crypto";

/** prevHash of the first chained entry. Entries from before v0.3.30 (seq null) are outside the chain. */
export const AUDIT_GENESIS = "GENESIS";
const HASH_VERSION = "audit-v1";

/** @param {unknown} v */
const text = (v) => (v === undefined || v === null ? null : String(v));

/** @param {unknown} v */
function isoTime(v) {
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.toISOString() : null;
  if (typeof v === "number") return Number.isFinite(v) ? new Date(v).toISOString() : null;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? new Date(t).toISOString() : v;
  }
  return null;
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * Text cut to at most `max` characters without splitting an emoji or other character in two, and
 * with any half character left over replaced by U+FFFD (the "?" box). A half character (lone surrogate) makes
 * the database refuse the whole write, so the audit entry would be lost.
 * 【中文】把文字截到最多 max 个字符，不会把表情符号等切成两半；残留的半个字符换成 U+FFFD（否则数据库会拒绝写入，审计记录就丢了）。
 * @param {unknown} v
 * @param {number} max
 * @returns {string}
 */
export function clipText(v, max) {
  const chars = Array.from(String(v ?? ""));
  const s = chars.length > max ? chars.slice(0, Math.max(0, max)).join("") : chars.join("");
  return s.replace(LONE_SURROGATE, "\uFFFD");
}

/**
 * The exact text that is hashed for one audit entry: a JSON array in a fixed order, so the same
 * entry always gives the same text.
 * 【中文】一条审计记录参与哈希的固定格式（固定顺序的 JSON 数组）。
 * @param {Record<string, unknown>} e
 * @returns {string}
 */
export function canonicalAuditEntry(e) {
  return JSON.stringify([
    HASH_VERSION,
    Number(e.seq),
    text(e.prevHash),
    isoTime(e.createdAt),
    text(e.actorUserId),
    text(e.actorName),
    text(e.actorRole),
    text(e.action),
    text(e.entityType),
    text(e.entityId),
    text(e.summary),
    text(e.details),
    text(e.ipAddress),
  ]);
}

/**
 * SHA-256 (hex) of canonicalAuditEntry(e).
 * @param {Record<string, unknown>} e
 * @returns {string}
 */
export function auditEntryHash(e) {
  return crypto.createHash("sha256").update(canonicalAuditEntry(e), "utf8").digest("hex");
}

/**
 * seq and prevHash for the next entry, given the newest chained entry (or null for the first).
 * 【中文】下一条记录的序号和上一条的哈希；还没有链时从 1 和 "GENESIS" 开始。
 * @param {{ seq: number | null, hash: string | null } | null | undefined} last
 * @returns {{ seq: number, prevHash: string }}
 */
export function nextChainLink(last) {
  if (!last || !Number.isInteger(last.seq)) return { seq: 1, prevHash: AUDIT_GENESIS };
  return { seq: /** @type {number} */ (last.seq) + 1, prevHash: last.hash || "" };
}

/**
 * Checks chained entries one by one, in seq order (rows can be fed in batches).
 * The first problem found stops the check:
 * - "missing": a seq number is skipped (an entry was deleted);
 * - "duplicate": a seq number appears twice or goes backwards;
 * - "altered": the entry's content no longer matches its hash (edited, or its seq / time changed);
 * - "broken-link": the entry does not point at the hash of the entry before it.
 * 【中文】按序号逐条检查哈希链；发现第一个问题就停止：缺号（被删除）、重号、内容被改、链接断开。
 */
export function createAuditChainVerifier() {
  /** @type {{ id: string, seq: number, hash: string, createdAt: unknown } | null} */
  let prev = null;
  let checked = 0;
  /** @type {null | { kind: "missing" | "duplicate" | "altered" | "broken-link", seq: number, id: string, expectedSeq: number, createdAt: string | null }} */
  let problem = null;
  return {
    /** @param {Record<string, unknown>} row */
    push(row) {
      if (problem) return problem;
      const seq = Number(row.seq);
      const expectedSeq = prev ? prev.seq + 1 : 1;
      const base = { seq, id: String(row.id ?? ""), expectedSeq, createdAt: isoTime(row.createdAt) };
      if (!Number.isInteger(seq) || seq < expectedSeq) problem = { kind: "duplicate", ...base };
      else if (seq > expectedSeq) problem = { kind: "missing", ...base };
      else if (auditEntryHash(row) !== row.hash) problem = { kind: "altered", ...base };
      else if (text(row.prevHash) !== (prev ? prev.hash : AUDIT_GENESIS)) problem = { kind: "broken-link", ...base };
      if (!problem) {
        prev = { id: String(row.id ?? ""), seq, hash: String(row.hash), createdAt: row.createdAt };
        checked++;
      }
      return problem;
    },
    result() {
      const last = prev ? { seq: prev.seq, id: prev.id, createdAt: isoTime(prev.createdAt) } : null;
      return problem ? { ok: false, checked, last, problem } : { ok: true, checked, last, problem: null };
    },
  };
}

/**
 * Verifies a whole chain given as an array (sorted by seq).
 * @param {Array<Record<string, unknown>>} rows
 */
export function verifyAuditChain(rows) {
  const v = createAuditChainVerifier();
  for (const r of rows) if (v.push(r)) break;
  return v.result();
}

// ===== Before / after values =====

/** @param {unknown} v */
function plain(v) {
  if (v === undefined || v === null || v === "") return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number" || typeof v === "boolean") return v;
  const s = typeof v === "string" ? v : JSON.stringify(v);
  const cut = clipText(s, 120);
  return cut.length < s.length ? cut + "…" : cut;
}

/** Last 4 characters only, e.g. "••••6789". @param {unknown} v */
export function maskTail(v) {
  const s = v === undefined || v === null ? "" : String(v);
  if (!s) return null;
  return "••••" + clipText(Array.from(s).slice(-4).join(""), 4);
}

/**
 * Before / after values of the fields that changed, for the audit log.
 * - `hidden`: secrets — only recorded as changed, never their value (e.g. the MyInvois secret);
 * - `masked`: only the last 4 characters (bank account, MyInvois client ID);
 * - `opaque`: long settings text — recorded as changed only;
 * - `ignore`: not compared.
 * Long values are cut to 120 characters, so the entry stays readable.
 * 【中文】生成设置修改的「修改前 / 修改后」：密钥只记「已修改」，银行账号等只记最后 4 位，长文字截短。
 * @param {Record<string, unknown> | null | undefined} before
 * @param {Record<string, unknown>} after
 * @param {{ hidden?: string[], masked?: string[], opaque?: string[], ignore?: string[] }} [opts]
 * @returns {{ changedFields: string[], before: Record<string, unknown>, after: Record<string, unknown> }}
 */
export function auditFieldChanges(before, after, opts = {}) {
  const { hidden = [], masked = [], opaque = [], ignore = [] } = opts;
  /** @type {string[]} */
  const changedFields = [];
  /** @type {Record<string, unknown>} */
  const b = {};
  /** @type {Record<string, unknown>} */
  const a = {};
  for (const key of Object.keys(after)) {
    if (ignore.includes(key)) continue;
    const x = before ? before[key] : undefined;
    const y = after[key];
    const same = x instanceof Date || y instanceof Date
      ? plain(x) === plain(y)
      : JSON.stringify(x ?? null) === JSON.stringify(y ?? null) || ((x ?? "") === "" && (y ?? "") === "");
    if (same) continue;
    changedFields.push(key);
    if (hidden.includes(key)) {
      b[key] = x ? "(hidden)" : null;
      a[key] = y ? "(changed)" : null;
    } else if (masked.includes(key)) {
      b[key] = maskTail(x);
      a[key] = maskTail(y);
    } else if (opaque.includes(key)) {
      b[key] = x ? "(set)" : null;
      a[key] = y ? "(changed)" : null;
    } else {
      b[key] = plain(x);
      a[key] = plain(y);
    }
  }
  return { changedFields, before: b, after: a };
}

/**
 * Nested settings → flat "quotation.heading" keys, so auditFieldChanges can compare them.
 * @param {unknown} obj
 * @param {string} [prefix]
 * @returns {Record<string, unknown>}
 */
export function flattenSettings(obj, prefix = "") {
  /** @type {Record<string, unknown>} */
  const out = {};
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return out;
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) Object.assign(out, flattenSettings(v, key));
    else out[key] = v;
  }
  return out;
}

// ===== Client address =====

/** "::ffff:192.168.1.5" → "192.168.1.5". @param {unknown} a */
export function normaliseAddress(a) {
  const s = String(a ?? "").trim().toLowerCase();
  if (!s) return "";
  return s.startsWith("::ffff:") && s.includes(".") ? s.slice(7) : s;
}

/**
 * The address stored with an audit entry. `peer` is the socket address stamped by the server
 * itself (instrumentation.ts); X-Forwarded-For / X-Real-IP can be typed by any client, so they are
 * only kept in the details as "reported", and only when they differ from the socket address.
 * 【中文】审计记录的地址：用服务器自己从连接取得的地址；客户端可以伪造的 X-Forwarded-For 只作为「自称」记在详情里。
 * @param {{ peer?: string | null, forwardedFor?: string | null, realIp?: string | null }} h
 * @returns {{ ipAddress: string | null, reported: string | null }}
 */
export function auditAddress({ peer, forwardedFor, realIp }) {
  const socket = normaliseAddress(peer);
  const claims = [forwardedFor, realIp]
    .map((v) => String(v ?? "").trim())
    .filter(Boolean)
    .filter((v) => normaliseAddress(v) !== socket);
  const reported = claims.length ? Array.from(new Set(claims)).join(" | ").slice(0, 200) : null;
  return { ipAddress: socket ? socket.slice(0, 64) : null, reported };
}

// ===== Flood control =====

/**
 * At most `limit` entries per `windowMs`. take() returns { ok: false } when over the limit; the
 * first entry of the next window learns how many were not recorded (droppedBefore).
 * 【中文】限流：每个时间窗口最多记录 limit 条；下一个窗口的第一条会说明上个窗口有几条没记录。
 * @param {number} limit
 * @param {number} windowMs
 */
export function createWindowLimiter(limit, windowMs) {
  let start = -Infinity;
  let used = 0;
  let dropped = 0;
  return {
    /** @param {number} now */
    take(now) {
      if (now - start >= windowMs) {
        const droppedBefore = dropped;
        start = now;
        used = 1;
        dropped = 0;
        return { ok: true, droppedBefore };
      }
      if (used < limit) {
        used++;
        return { ok: true, droppedBefore: 0 };
      }
      dropped++;
      return { ok: false, droppedBefore: 0 };
    },
  };
}
