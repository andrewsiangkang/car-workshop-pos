import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import type { CurrentUser } from "@/lib/auth";
import { findSentDocument } from "@/lib/myinvois";
import { isLiveStatus } from "@/lib/einvoice-state.mjs";
import {
  UNCONFIRMED,
  claimData,
  claimWhere,
  isUnconfirmed,
  sentLookupWindow,
  submitGate,
  unconfirmedNext,
  unconfirmedUntil,
} from "@/lib/einvoice2-submit.mjs";

/**
 * Applies the "send at most once" rules of einvoice2-submit.mjs to the three kinds of LHDN
 * record (work order invoice, credit note, monthly consolidated e-Invoice): the atomic claim,
 * its release, the "unconfirmed" marker after an unanswered submission, and settling that
 * marker by asking LHDN for a document with the same number.
 */
// 【中文】把"只送一次"的规则用在三种单据上（发票、退款单、合并发票）：原子占位、解除占位、没回应时记为"未确认"、再按单号向 LHDN 查证。

export type GuardKind = "order" | "creditNote" | "consolidated";

export type GuardRec = {
  id: string;
  eInvoiceUuid: string | null;
  eInvoiceStatus: string | null;
  eInvoiceEnv?: string | null;
  eInvoiceSubmittingAt: Date | null;
};

type Fields = {
  eInvoiceUuid?: string | null;
  eInvoiceLongId?: string | null;
  eInvoiceStatus?: string | null;
  eInvoiceEnv?: string | null;
  submissionUid?: string | null;
  eInvoiceSubmittingAt?: Date | null;
  /** Credit notes only: "02" credit note / "04" refund note. */
  eInvoiceType?: string | null;
};

const ENTITY: Record<GuardKind, string> = { order: "WorkOrder", creditNote: "CreditNote", consolidated: "ConsolidatedInvoice" };

async function updateMany(kind: GuardKind, where: Record<string, unknown>, data: Fields): Promise<number> {
  const { eInvoiceType, ...common } = data;
  if (kind === "order") return (await prisma.workOrder.updateMany({ where: where as Prisma.WorkOrderWhereInput, data: common })).count;
  if (kind === "creditNote") {
    const cn = eInvoiceType === undefined ? common : { ...common, eInvoiceType };
    return (await prisma.creditNote.updateMany({ where: where as Prisma.CreditNoteWhereInput, data: cn })).count;
  }
  return (await prisma.consolidatedInvoice.updateMany({ where: where as Prisma.ConsolidatedInvoiceWhereInput, data: common })).count;
}

const myTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kuala_Lumpur", hour: "2-digit", minute: "2-digit" });
/** "14:05" in Malaysia time. */
export function clock(d: Date | null | undefined) {
  return d ? myTime.format(d) : "";
}

/** The record that already holds a UUID. */
export type UuidHolder =
  | { kind: "order"; id: string; number: string }
  | { kind: "creditNote"; id: string; number: string }
  | { kind: "consolidated"; id: string; number: string; month: string; setAside: boolean };

/**
 * A UUID belongs to exactly one LHDN document: is it already recorded on another invoice, credit
 * note or consolidated e-Invoice? `except` names the record being saved (its own UUID is fine).
 * Used by every hand-typed reference (invoice page and the monthly consolidated portal record).
 * Returns the record holding it (so the refusal can name it), or null.
 */
// 【中文】一个 UUID 只属于一份 LHDN 文件：检查它是否已登记在别的发票、退款单或合并发票上（正在保存的那份除外），并返回是哪一份。
export async function uuidRecordedElsewhere(
  uuid: string,
  except: { workOrderId?: string; consolidatedMonth?: string } = {}
): Promise<UuidHolder | null> {
  const order = await prisma.workOrder.findFirst({
    where: { eInvoiceUuid: uuid, ...(except.workOrderId ? { NOT: { id: except.workOrderId } } : {}) },
    select: { id: true, invoiceNumber: true, orderNumber: true },
  });
  if (order) return { kind: "order", id: order.id, number: order.invoiceNumber || order.orderNumber };
  const con = await prisma.consolidatedInvoice.findFirst({
    where: { eInvoiceUuid: uuid, ...(except.consolidatedMonth ? { NOT: { month: except.consolidatedMonth } } : {}) },
    select: { id: true, number: true, month: true, eInvoiceStatus: true },
  });
  if (con) {
    const setAside = String(con.eInvoiceStatus || "").toLowerCase() === "rejected";
    return { kind: "consolidated", id: con.id, number: con.number, month: con.month, setAside };
  }
  const cn = await prisma.creditNote.findFirst({ where: { eInvoiceUuid: uuid }, select: { id: true, number: true } });
  return cn ? { kind: "creditNote", id: cn.id, number: cn.number } : null;
}

/** The refusal for a UUID already recorded elsewhere, naming the record that holds it. */
// 【中文】UUID 已登记在别处时的拒绝讯息，说明是哪一份单据。
export function uuidHolderMessage(h: UuidHolder) {
  if (h.kind === "order") return `That UUID is already recorded on invoice ${h.number}.`;
  if (h.kind === "creditNote") return `That UUID is already recorded on credit note ${h.number}.`;
  return h.setAside
    ? `That UUID is already recorded on the consolidated e-Invoice for ${h.month} (${h.number}, set aside).`
    : `That UUID is already recorded on the consolidated e-Invoice for ${h.month} (${h.number}).`;
}

/** Shown when another submission of the same document is still running. */
export function inFlightMessage(until: Date) {
  return `This document is already being sent to LHDN (from another click or device). Wait until ${clock(until)}, then press Check Status.`;
}

/**
 * Claim the record for one submission to LHDN system `env` (atomic: count 1 wins). `extra`: other
 * fields that must still be as read (an invoice's consolidatedId). A record with no UUID also
 * keeps `env` (claimData), so a claim left behind by a crash says which system it was for.
 */
// 【中文】占位（原子操作）；记录还没有 UUID 时同时记下送往哪个 LHDN 系统。
export async function claimSubmission(
  kind: GuardKind,
  rec: GuardRec,
  now: Date,
  env: "sandbox" | "production",
  extra: Record<string, unknown> = {}
): Promise<boolean> {
  return (await updateMany(kind, claimWhere(rec, now, extra), claimData(rec, now, env))) === 1;
}

/**
 * Release our own claim (only if it is still ours). `rec` is the record as it was claimed: the
 * system the claim kept on a record with no UUID (claimData) is put back as it was.
 */
export async function releaseClaim(kind: GuardKind, id: string, claimAt: Date, rec?: { eInvoiceEnv?: string | null }) {
  const env = rec && rec.eInvoiceEnv !== undefined ? { eInvoiceEnv: rec.eInvoiceEnv } : {};
  await updateMany(kind, { id, eInvoiceSubmittingAt: claimAt }, { eInvoiceSubmittingAt: null, ...env });
}

/**
 * The submission got no answer: keep the claim time and mark the record "unconfirmed" (not "not
 * sent"). An earlier, ended UUID is cleared from the record (it is in the audit log), so the record
 * never counts as live because of it.
 */
export async function markUnconfirmed(
  kind: GuardKind,
  id: string,
  claimAt: Date,
  env: string,
  extra: Pick<Fields, "eInvoiceType"> = {}
) {
  await updateMany(kind, { id }, {
    eInvoiceUuid: null,
    eInvoiceLongId: null,
    submissionUid: null,
    eInvoiceStatus: UNCONFIRMED,
    eInvoiceEnv: env,
    eInvoiceSubmittingAt: claimAt,
    ...extra,
  });
}

/** Text for the user after a submission got no answer. */
export function unconfirmedMessage(claimAt: Date) {
  return (
    "LHDN did not answer in time. The document may still have arrived, so it was NOT marked as failed. " +
    `Press Check Status in a minute. Submitting again is only possible once LHDN confirms it does not have it (after ${clock(unconfirmedUntil(claimAt))}).`
  );
}

export type Settled =
  | { state: "recorded"; uuid: string; status: string; longId: string | null; submissionUid: string | null }
  | { state: "wait"; until: Date | null }
  | { state: "cleared" }
  | { state: "unsure"; message: string }
  | { state: "error"; status: number; message: string };

/** LHDN listed more documents around the attempt than can be read here: never cleared automatically. */
export function unsureMessage(number: string) {
  return (
    `LHDN lists too many documents around the time of the earlier submission of ${number} to check them all here. ` +
    "Nothing was sent. Look for this document number in the MyInvois portal and contact support before submitting it again."
  );
}

/**
 * Settle an unanswered (or crashed) submission: ask LHDN for a document with this number sent
 * around the attempt (sentLookupWindow). The decision is unconfirmedNext's: a document LHDN
 * counts is recorded; while LHDN may still be processing it, wait; after the wait an ended
 * document is recorded and nothing found clears the marker (a new submission is then allowed),
 * unless LHDN's list could not be read in full.
 */
// 【中文】处理没回应（或程序崩溃）的提交：按单号在提交前后一小段时间内向 LHDN 查。查到有效的 → 记录下来；等待期内 → 继续等；
// 等待期过后查到已失效的 → 记录；什么都没查到 → 清除标记，可以重新提交；清单没读完 → 不自动清除。
export async function settleUnconfirmed(p: {
  kind: GuardKind;
  rec: GuardRec;
  number: string;
  env: string;
  actor?: CurrentUser | null;
  request?: Request;
  now?: Date;
}): Promise<Settled> {
  const now = p.now || new Date();
  const since = p.rec.eInvoiceSubmittingAt;
  const win = sentLookupWindow(since, now);
  const found = await findSentDocument(p.number, win, { env: p.env === "production" ? "production" : "sandbox" });
  if (!found.ok) {
    return { state: "error", status: 502, message: "Could not check with LHDN whether the earlier submission arrived. Nothing was sent. Try again in a few minutes." };
  }
  const next = unconfirmedNext({
    found: !!found.doc,
    foundLive: !!found.doc && isLiveStatus(found.doc.status),
    complete: found.complete,
    since,
    now,
  });
  // Only the state that was read is changed (another request may have settled it meanwhile).
  const same = { id: p.rec.id, eInvoiceSubmittingAt: since, eInvoiceStatus: p.rec.eInvoiceStatus };
  if (next === "wait") return { state: "wait", until: unconfirmedUntil(since) };
  if (next === "unsure") return { state: "unsure", message: unsureMessage(p.number) };
  if (next === "record" && found.doc) {
    const d = found.doc;
    await updateMany(p.kind, same, {
      eInvoiceUuid: d.uuid,
      eInvoiceLongId: d.longId,
      eInvoiceStatus: d.status,
      eInvoiceEnv: p.env,
      submissionUid: d.submissionUid,
      eInvoiceSubmittingAt: null,
    });
  } else {
    await updateMany(p.kind, same, {
      eInvoiceSubmittingAt: null,
      eInvoiceStatus: isUnconfirmed(p.rec) ? null : p.rec.eInvoiceStatus,
    });
  }
  if (p.actor) {
    await writeAuditLog({
      actor: p.actor,
      request: p.request,
      action: "MYINVOIS_SUBMISSION_SETTLED",
      entityType: ENTITY[p.kind],
      entityId: p.rec.id,
      summary:
        next === "record"
          ? `Unanswered LHDN submission of ${p.number} found at LHDN`
          : `Unanswered LHDN submission of ${p.number} never arrived at LHDN`,
      details: {
        number: p.number,
        environment: p.env,
        attemptAt: since ? since.toISOString() : null,
        lookup: { from: win.from.toISOString(), to: win.to.toISOString(), source: win.source },
        found: found.doc ? { uuid: found.doc.uuid, status: found.doc.status } : null,
      },
    });
  }
  return found.doc && next === "record"
    ? { state: "recorded", uuid: found.doc.uuid, status: found.doc.status, longId: found.doc.longId, submissionUid: found.doc.submissionUid }
    : { state: "cleared" };
}

/**
 * Before sending: may this record be submitted now? Settles an earlier unanswered submission
 * first. Returns null to go ahead (re-read the record: it may have been cleared), or the refusal.
 */
// 【中文】送出前检查：可以送就返回 null；有人正在送、上次没回应还在等待期、或 LHDN 已经有这份单据，就返回拒绝的原因。
export async function checkBeforeSubmit(p: {
  kind: GuardKind;
  rec: GuardRec;
  number: string;
  env: string;
  actor?: CurrentUser | null;
  request?: Request;
}): Promise<{ status: number; error: string; code: string } | null> {
  const gate = submitGate(p.rec);
  if (gate.action === "go") return null;
  if (gate.action === "wait") return { status: 409, error: inFlightMessage(gate.until), code: "SUBMIT_IN_PROGRESS" };
  const s = await settleUnconfirmed(p);
  if (s.state === "cleared") return null;
  if (s.state === "error") return { status: s.status, error: s.message, code: "UNCONFIRMED_CHECK_FAILED" };
  if (s.state === "unsure") return { status: 409, error: s.message, code: "UNCONFIRMED_UNSURE" };
  if (s.state === "wait") {
    return {
      status: 409,
      error:
        "The last submission got no answer from LHDN and LHDN does not show the document yet. To avoid a duplicate e-Invoice, " +
        `wait until ${clock(s.until)}, then press Check Status or submit again.`,
      code: "UNCONFIRMED_WAIT",
    };
  }
  return {
    status: 409,
    error: `LHDN already has this document from the earlier submission (UUID ${s.uuid}, status ${s.status}). It is now saved here; nothing new was sent.`,
    code: "ALREADY_AT_LHDN",
  };
}
