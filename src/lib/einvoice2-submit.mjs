// Sending a document to LHDN at most once (review Medium, myinvois.ts:434): a double click, a
// second device or a retry after a hang must never create two valid e-Invoices.
// - Before sending, the record is claimed atomically (eInvoiceSubmittingAt = now); a second
//   submit finds the claim and is refused. The claim is released when LHDN has answered.
// - Every LHDN call has a time limit. When LHDN does not answer (timeout, network error, gateway
//   error) the document may still have arrived, so the record is marked "unconfirmed" instead of
//   "not sent": a new submit first asks LHDN for a document with the same number, and is refused
//   while LHDN may still be processing it.
// Pure functions (only the pure e-Invoice state module is imported): used by the submit / status
// routes, the pages and tests.
// 【中文】同一张单据只送 LHDN 一次：送出前先原子"占位"（eInvoiceSubmittingAt），第二次提交会被拒绝；LHDN 回应后才解除占位。
// 每个 LHDN 请求都有时间上限。LHDN 没回应时（超时、断网、网关错误）单据可能其实已送到，所以记为"未确认"而不是"没送出"：
// 再提交前先向 LHDN 查同号单据，LHDN 可能还在处理时拒绝重送。

import { PRODUCTION, SANDBOX, isLiveStatus } from "./einvoice-state.mjs";

/** Time limit for one LHDN call (submission, login, TIN search). */
export const LHDN_TIMEOUT_MS = 30_000;
/** A claim older than this was left behind by a crash: LHDN is asked before anything is sent again. */
export const CLAIM_STALE_MS = 2 * 60_000;
/** After a submission got no answer, how long LHDN is given to show it before a resubmit is allowed. */
export const UNCONFIRMED_WAIT_MS = 10 * 60_000;
/** eInvoiceStatus of a record whose last submission got no answer from LHDN. */
export const UNCONFIRMED = "unconfirmed";

/** @param {unknown} d */
const ms = (d) => (d ? new Date(/** @type {any} */ (d)).getTime() : NaN);

/**
 * The last submission of this record got no answer from LHDN (it may have arrived).
 * @param {{ eInvoiceStatus?: string | null } | null | undefined} rec
 */
export function isUnconfirmed(rec) {
  return !!rec && String(rec.eInvoiceStatus || "").toLowerCase() === UNCONFIRMED;
}

/**
 * May a new submission of this record start now?
 * - "go": nothing in flight.
 * - "wait": another submission started less than 2 minutes ago and has not finished.
 * - "lookup": the last submission got no answer, or its claim was left behind (crash): ask LHDN
 *   for a document with this number before sending again (see unconfirmedNext).
 * @param {{ eInvoiceStatus?: string | null, eInvoiceSubmittingAt?: Date | string | null } | null | undefined} rec
 * @param {Date} [now]
 * @returns {{ action: "go" } | { action: "wait", until: Date } | { action: "lookup", since: Date | null }}
 */
// 【中文】现在能不能开始提交：没有进行中的 → 可以；2 分钟内有人正在送 → 等；上次没回应或占位被遗留（程序崩溃）→ 先向 LHDN 查。
export function submitGate(rec, now = new Date()) {
  const at = ms(rec && rec.eInvoiceSubmittingAt);
  const since = Number.isFinite(at) ? new Date(at) : null;
  if (isUnconfirmed(rec)) return { action: "lookup", since };
  if (since) {
    if (now.getTime() - at < CLAIM_STALE_MS) return { action: "wait", until: new Date(at + CLAIM_STALE_MS) };
    return { action: "lookup", since };
  }
  return { action: "go" };
}

/**
 * Prisma `where` for the atomic claim (updateMany; count 1 wins). The record must still be as it
 * was read when it was found not live (same UUID and status, so a submission that finished
 * meanwhile is not sent again), and nobody may hold a claim younger than 2 minutes.
 * `extra` adds fields that must also be unchanged, e.g. an invoice's consolidatedId: a monthly
 * consolidated e-Invoice that took the invoice in after it was read makes the claim fail.
 * @param {{ id: string, eInvoiceUuid?: string | null, eInvoiceStatus?: string | null }} rec
 * @param {Date} [now]
 * @param {Record<string, unknown>} [extra]
 */
// 【中文】原子占位的条件：记录还和读出时一样（UUID、状态都没变，避免别人刚送完又送一次），而且没有 2 分钟内的占位；只有一个请求能成功。
// extra：其他也必须没变的栏位，例如发票的 consolidatedId（读出后被合并发票收进去，占位就失败）。
export function claimWhere(rec, now = new Date(), extra = {}) {
  return {
    ...extra,
    id: rec.id,
    eInvoiceUuid: rec.eInvoiceUuid ?? null,
    eInvoiceStatus: rec.eInvoiceStatus ?? null,
    OR: [{ eInvoiceSubmittingAt: null }, { eInvoiceSubmittingAt: { lt: new Date(now.getTime() - CLAIM_STALE_MS) } }],
  };
}

/**
 * Data written by the atomic claim: the claim time, and the LHDN system the attempt goes to. The
 * system is kept in eInvoiceEnv only on a record with no UUID (claimWhere pins that), so an
 * earlier reference never changes systems; a claim left behind by a crash then still says which
 * system to check it in, and a SANDBOX one does not hold up real (production) work (inFlightFor).
 * @param {{ eInvoiceUuid?: string | null }} rec the record as read (the claim's `where` pins its UUID)
 * @param {Date} now
 * @param {"sandbox" | "production"} env
 */
// 【中文】占位时写入的资料：占位时间；记录还没有 UUID 时也记下送往哪个 LHDN 系统（程序崩溃留下占位时，才知道要在哪个系统检查；沙盒的不挡正式的）。
export function claimData(rec, now, env) {
  return rec.eInvoiceUuid ? { eInvoiceSubmittingAt: now } : { eInvoiceSubmittingAt: now, eInvoiceEnv: env };
}

/**
 * What a submission attempt means for the record:
 * - "accepted": LHDN gave a UUID;
 * - "rejected": LHDN answered and did not take the document (nothing was created), or nothing was sent;
 * - "unknown": no usable answer (timeout, network error, gateway / server error, an answer that
 *   could not be read): the document may have arrived.
 * @param {{ ok: boolean, status?: number, unknown?: boolean }} r
 * @returns {"accepted" | "rejected" | "unknown"}
 */
export function submitOutcome(r) {
  if (r.ok) return "accepted";
  if (r.unknown) return "unknown";
  const s = Number(r.status) || 0;
  // 503 = LHDN refused to take it now; other 5xx (500, 502, 504) may come after it was stored.
  if (s === 0 || (s >= 500 && s !== 503)) return "unknown";
  return "rejected";
}

/**
 * After asking LHDN for a document with this number (see sentLookupWindow):
 * - found one LHDN still counts (submitted / valid) → "record" it on the record;
 * - LHDN may still be processing the submission (inside the 10-minute wait) → "wait". A found
 *   document that has ended (invalid / cancelled) also waits: it can be an EARLIER attempt with the
 *   same number, while the unanswered one is not listed yet (it used to be recorded at once, which
 *   allowed a third submission while the unanswered one could still turn valid);
 * - after the wait, LHDN's list read in full: an ended document → "record" (whichever attempt it
 *   is, nothing LHDN counts exists, so a corrected submission is safe); nothing → "clear" the marker;
 * - after the wait, a list cut short (too many documents) → "unsure": never cleared automatically.
 * @param {{ found: boolean, foundLive?: boolean, complete?: boolean, since: Date | string | null | undefined, now?: Date }} p
 * @returns {"record" | "wait" | "clear" | "unsure"}
 */
// 【中文】向 LHDN 查过同号单据后：查到仍有效的 → 记下来；还在等待期 → 等（查到已失效的也先等，它可能是同号的前一次提交，这次的还没列出来）；
// 等待期过后：查到已失效的 → 记下来（LHDN 没有有效的，可以重送）；什么都没查到而且清单完整 → 清除标记；清单不完整 → 不确定，绝不自动清除。
export function unconfirmedNext(p) {
  if (p.found && p.foundLive !== false) return "record";
  const at = ms(p.since);
  const now = (p.now || new Date()).getTime();
  if (Number.isFinite(at) && now - at < UNCONFIRMED_WAIT_MS) return "wait";
  // A list cut short may hide a document LHDN still counts.
  if (p.complete === false) return "unsure";
  return p.found ? "record" : "clear";
}

/** Before the attempt: covers a difference between this PC's clock and LHDN's. */
export const LOOKUP_BEFORE_MS = 10 * 60_000;
/** After the attempt: LHDN stamps a submission when it receives it, within seconds of sending. */
export const LOOKUP_AFTER_MS = 60 * 60_000;
/** LHDN's "recent documents" list only goes back 31 days; older attempts use "search documents". */
export const RECENT_LOOKBACK_MS = 30 * 24 * 60 * 60_000;

/**
 * Time window (and which LHDN list) to look for the document of an unanswered attempt in: a short
 * window around the attempt, so the list stays small however late Check Status is pressed (a
 * window up to "now" grew past the 500 rows read and reached LHDN's 31-day limit).
 * @param {Date | string | null | undefined} since when the attempt started (its claim time)
 * @param {Date} [now]
 * @returns {{ from: Date, to: Date, source: "recent" | "search" }}
 */
// 【中文】查找没回应的提交时用的时间范围：只查提交前后的一小段（不管多久之后才按「检查状态」，清单都不会太长）；
// 超过 30 天的改用 LHDN 的「搜索单据」（「最近单据」只保留 31 天）。
export function sentLookupWindow(since, now = new Date()) {
  const at = ms(since);
  const base = Number.isFinite(at) ? at : now.getTime() - CLAIM_STALE_MS;
  const from = base - LOOKUP_BEFORE_MS;
  const to = Math.max(from + 60_000, Math.min(now.getTime(), base + LOOKUP_AFTER_MS));
  return { from: new Date(from), to: new Date(to), source: now.getTime() - from < RECENT_LOOKBACK_MS ? "recent" : "search" };
}

/**
 * The record's own submission may be at LHDN right now (in flight, unanswered, or a claim left by a
 * crash), as far as a document for LHDN system `env` is concerned. Such an invoice must not go
 * into a monthly consolidated e-Invoice, and its credit notes must not be netted there, until
 * Check Status has settled it: else the same sale can be reported twice. A SANDBOX test that has
 * ended without an answer (unanswered, or its claim left behind by a crash on a record with no
 * UUID, where the claim stored its system: claimData) does not hold up real (production) work.
 * A sandbox claim younger than 2 minutes still does: that request may yet write its result.
 * @param {{ eInvoiceUuid?: string | null, eInvoiceStatus?: string | null, eInvoiceEnv?: string | null, eInvoiceSubmittingAt?: Date | string | null } | null | undefined} rec
 * @param {"sandbox" | "production"} env
 * @param {Date} [now]
 */
// 【中文】这张单据自己的提交可能正在 LHDN（正在送、没回应、或程序崩溃留下的占位）。这样的发票不能并入合并发票（它的退款单也不能在合并发票里扣除），
// 要先「检查状态」确认，否则同一笔交易会申报两次。沙盒测试没回应的（或沙盒提交时程序崩溃留下的占位），不会挡住正式的工作；2 分钟内的沙盒占位仍然挡住。
export function inFlightFor(rec, env, now = new Date()) {
  const gate = submitGate(rec, now);
  if (!rec || gate.action === "go") return false;
  const sandboxLeftover = gate.action === "lookup" && rec.eInvoiceEnv === SANDBOX && (isUnconfirmed(rec) || !rec.eInvoiceUuid);
  return !(env === PRODUCTION && sandboxLeftover);
}

/**
 * Prisma `where` part matching the records NOT in flight for `env` (same rule as inFlightFor):
 * used to reserve invoices and credit notes for a consolidated e-Invoice atomically.
 * An unanswered record always keeps its claim time, so "no claim" covers it.
 * @param {"sandbox" | "production"} env
 * @param {Date} [now]
 */
// 【中文】Prisma 条件：不在提交中的记录（规则同 inFlightFor），合并发票预留发票和退款单时用，确保原子性。
export function notInFlightWhere(env, now = new Date()) {
  const free = [{ eInvoiceSubmittingAt: null }];
  if (env !== PRODUCTION) return { OR: free };
  return {
    OR: [
      ...free,
      { eInvoiceStatus: UNCONFIRMED, eInvoiceEnv: SANDBOX },
      { eInvoiceUuid: null, eInvoiceEnv: SANDBOX, eInvoiceSubmittingAt: { lt: new Date(now.getTime() - CLAIM_STALE_MS) } },
    ],
  };
}

/**
 * When the wait after an unanswered submission ends.
 * @param {Date | string | null | undefined} since
 */
export function unconfirmedUntil(since) {
  const at = ms(since);
  return Number.isFinite(at) ? new Date(at + UNCONFIRMED_WAIT_MS) : null;
}

/**
 * Pick the document LHDN has for our number among the "recent documents" rows: one LHDN still
 * counts (submitted / valid) first, else the newest. Rows for other numbers are ignored.
 * @param {Array<Record<string, unknown>>} rows
 * @param {string} internalId the document number we sent
 * @returns {{ uuid: string, submissionUid: string | null, longId: string | null, status: string } | null}
 */
export function pickSentDocument(rows, internalId) {
  const mine = (Array.isArray(rows) ? rows : []).filter(
    (r) => r && String(r.internalId || "") === internalId && typeof r.uuid === "string" && r.uuid
  );
  if (!mine.length) return null;
  const ended = (r) => !isLiveStatus(/** @type {string} */ (r.status));
  const when = (r) => ms(r.dateTimeReceived || r.dateTimeIssued) || 0;
  mine.sort((a, b) => Number(ended(a)) - Number(ended(b)) || when(b) - when(a));
  const r = mine[0];
  return {
    uuid: String(r.uuid),
    submissionUid: typeof r.submissionUID === "string" ? r.submissionUID : typeof r.submissionUid === "string" ? r.submissionUid : null,
    longId: typeof r.longId === "string" && r.longId ? r.longId : null,
    status: String(r.status || "submitted").toLowerCase(),
  };
}
