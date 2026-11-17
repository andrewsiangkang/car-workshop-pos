import { NextResponse } from "next/server";
import { getCurrentUser, isOwner } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMyInvoisConfig, getSubmissionStatus, getDocumentDetails, type DocStatus } from "@/lib/myinvois";
import { writeAuditLog } from "@/lib/audit";
import { PRODUCTION, envFromSandboxFlag, isLiveEInvoice, recordEnv } from "@/lib/einvoice-state.mjs";
import { portalConsolidatedDocument } from "@/lib/einvoice-rules.mjs";
import { friendlyMyInvoisError, formatFriendlyError } from "@/lib/myinvois-errors";
import { isUnconfirmed, submitGate } from "@/lib/einvoice2-submit.mjs";
import { clock, inFlightMessage, settleUnconfirmed, type GuardKind } from "@/lib/einvoice2-guard";

export const dynamic = "force-dynamic";

type Rec = {
  id: string;
  number: string | null;
  eInvoiceUuid: string | null;
  eInvoiceLongId: string | null;
  eInvoiceStatus: string | null;
  eInvoiceEnv: string | null;
  submissionUid: string | null;
  eInvoiceSubmittingAt: Date | null;
};

const SEL = {
  id: true, eInvoiceUuid: true, eInvoiceLongId: true, eInvoiceStatus: true, eInvoiceEnv: true, submissionUid: true,
  eInvoiceSubmittingAt: true,
} as const;

/**
 * Ask LHDN for the status of a record's OWN e-Invoice and store the answer on that record.
 * Body: { orderId | creditNoteId | consolidatedId, submissionUID? }
 * - The submission checked is the one stored on the record. A different submissionUID is
 *   refused (it used to be trusted, so any UUID could be attached to any invoice).
 * - LHDN's answer must be for this record: same UUID and same document number.
 * - References typed in by hand (no submission id) are checked by UUID.
 * - A submission LHDN did not answer ("unconfirmed"), or a claim left behind by a crash, is
 *   looked up by its document number: found → recorded; not found → wait while LHDN may still be
 *   processing it, then cleared so it can be submitted again.
 * - Invoices: any logged-in user (staff submit invoices and the page polls). Credit notes
 *   and the monthly consolidated e-Invoice: boss only, like submitting them.
 */
// 【中文】查询 LHDN 状态：只查该记录自己保存的提交编号，并核对 LHDN 回复的 UUID 和单号属于这张单；贷项通知和合并发票只限老板。
export async function POST(request: Request) {
  const actor = await getCurrentUser();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    const kind = body.orderId ? "order" : body.creditNoteId ? "creditNote" : body.consolidatedId ? "consolidated" : null;
    if (!kind) return NextResponse.json({ error: "A record id is required" }, { status: 400 });
    if (kind !== "order" && !isOwner(actor)) {
      return NextResponse.json({ error: "Only the boss can do this" }, { status: 403 });
    }
    const id = String(body.orderId || body.creditNoteId || body.consolidatedId);

    let rec: Rec | null = null;
    if (kind === "order") {
      const o = await prisma.workOrder.findUnique({ where: { id }, select: { ...SEL, invoiceNumber: true } });
      rec = o && { ...o, number: o.invoiceNumber };
    } else if (kind === "creditNote") {
      const c = await prisma.creditNote.findUnique({ where: { id }, select: { ...SEL, number: true } });
      rec = c;
    } else {
      const c = await prisma.consolidatedInvoice.findUnique({ where: { id }, select: { ...SEL, number: true } });
      rec = c;
    }
    if (!rec) return NextResponse.json({ error: "Record not found" }, { status: 404 });
    const gate = submitGate(rec);
    if (gate.action === "wait") return NextResponse.json({ error: inFlightMessage(gate.until), code: "SUBMIT_IN_PROGRESS" }, { status: 409 });
    // Unanswered, or a claim left behind by a crash (even on a record with an earlier, ended
    // submission): only the lookup by number settles it, so the invoice is not stuck.
    // Awaited here, so a failure (e.g. no API credentials for this system) is answered as JSON below.
    if (gate.action === "lookup") return await settle(kind, rec, actor, request);
    if (!rec.submissionUid && !rec.eInvoiceUuid) {
      return NextResponse.json({ error: "This record has not been sent to LHDN yet." }, { status: 400 });
    }
    if (body.submissionUID && rec.submissionUid && String(body.submissionUID) !== rec.submissionUid) {
      return NextResponse.json({ error: "That LHDN submission does not belong to this record." }, { status: 409 });
    }

    // LHDN sandbox and production are separate systems: only ask the one the record came from.
    const { shop } = await getMyInvoisConfig();
    const env = envFromSandboxFlag(shop.myInvoisSandbox);
    const recEnv = recordEnv(rec);
    if (recEnv !== env) {
      return NextResponse.json(
        { error: `This e-Invoice was recorded in the LHDN ${recEnv} system, but Settings are on ${env}. Switch Settings to ${recEnv} to check it.` },
        { status: 409 }
      );
    }

    // A monthly consolidated e-Invoice typed in from the MyInvois portal (no submission id). While
    // it counts as reported, the month cannot be recorded again, so a reference LHDN does not
    // know, or one that belongs to another document, would keep the month "reported" for ever.
    // 【中文】从 MyInvois 网站登记的合并发票：LHDN 查不到这个 UUID，或它属于另一份单据时，这条记录没有申报任何东西，要放开该月以便重新登记。
    const portalConsolidated = kind === "consolidated" && !rec.submissionUid && recEnv === PRODUCTION && isLiveEInvoice(rec);

    const r = rec.submissionUid
      ? await getSubmissionStatus(rec.submissionUid, rec.eInvoiceUuid)
      : await getDocumentDetails(rec.eInvoiceUuid!);
    // Only a reference LHDN never confirmed is set aside on a "not found": one LHDN already showed
    // (valid, with its Long ID) is not dropped because of a single odd answer.
    // 【中文】只有从未被 LHDN 确认过（pending）的记录，查不到时才搁置；已确认有效的不会因一次查不到就被放开。
    if (!r.ok && portalConsolidated && r.status === 404 && String(rec.eInvoiceStatus || "").toLowerCase() === "pending") {
      return await setAsidePortalConsolidated(rec, actor, request, `LHDN has no document with UUID ${rec.eInvoiceUuid}.`);
    }
    if (!r.ok) {
      const fe = friendlyMyInvoisError(r.detail, { httpStatus: r.status, kind: "status", fallback: "Status check failed" });
      return NextResponse.json({ error: formatFriendlyError(fe), detail: r.detail }, { status: r.status });
    }

    // LHDN's answer must be about this record.
    if (rec.eInvoiceUuid && r.uuid && r.uuid !== rec.eInvoiceUuid) {
      return NextResponse.json({ error: `LHDN returned a different document (UUID ${r.uuid}). Nothing was changed.` }, { status: 409 });
    }
    if (r.internalId && rec.number && r.internalId !== rec.number && portalConsolidated) {
      // The boss's own consolidated e-Invoice typed in with another number: the number is corrected.
      // Any other document: this record reports nothing, and the reference (another document's) goes.
      // 【中文】是本店这个月的合并发票、只是单号输入不同 → 改正单号；是别的单据 → 搁置并清掉这个不属于它的 UUID。
      const corrected = await correctPortalConsolidatedNumber(rec, r, actor, request);
      if (corrected) return corrected;
      return await setAsidePortalConsolidated(
        rec, actor, request, `LHDN document ${r.uuid || rec.eInvoiceUuid} is for ${r.internalId}, not ${rec.number}.`, { clearReference: true }
      );
    }
    if (r.internalId && rec.number && r.internalId !== rec.number) {
      return NextResponse.json(
        { error: `LHDN document ${r.uuid || ""} is for ${r.internalId}, not ${rec.number}. Nothing was changed.` },
        { status: 409 }
      );
    }

    if (r.uuid) {
      const data = { eInvoiceUuid: r.uuid, eInvoiceLongId: r.longId || undefined, eInvoiceStatus: r.status };
      if (kind === "order") await prisma.workOrder.update({ where: { id }, data });
      else if (kind === "creditNote") await prisma.creditNote.update({ where: { id }, data });
      else await prisma.consolidatedInvoice.update({ where: { id }, data });
      await writeAuditLog({
        actor, request, action: "MYINVOIS_STATUS_UPDATED",
        entityType: kind === "order" ? "WorkOrder" : kind === "creditNote" ? "CreditNote" : "ConsolidatedInvoice",
        entityId: id,
        summary: `MyInvois status for ${rec.number || id}: ${rec.eInvoiceStatus || "none"} → ${r.status}`,
        details: {
          environment: recEnv,
          previous: { uuid: rec.eInvoiceUuid, longId: rec.eInvoiceLongId, status: rec.eInvoiceStatus },
          next: { uuid: r.uuid, longId: r.longId, status: r.status },
          ...(r.reason ? { reason: r.reason } : {}),
        },
      });
    }
    // LHDN's own reason for an invalid document, plus what to fix in this app (phone, address, TIN…).
    const fe = r.reason ? friendlyMyInvoisError(r.reason, { kind: "status" }) : null;
    const advice = fe?.topic ? formatFriendlyError(fe) : null;
    return NextResponse.json({ ok: true, status: r.status, uuid: r.uuid, longId: r.longId, reason: r.reason, advice, environment: recEnv });
  } catch (e: unknown) {
    console.error(e);
    return NextResponse.json({ error: (e as Error)?.message || "Failed" }, { status: 500 });
  }
}

/**
 * A portal-recorded consolidated e-Invoice whose document number differs from LHDN's: when LHDN's
 * document is still this shop's consolidated e-Invoice of the month (live, General Public, the
 * record's total to the sen: portalConsolidatedDocument) and its number is none of the shop's own
 * invoice or credit note numbers, the number is corrected to LHDN's and the status saved.
 * Returns null when the document is another one (the caller sets the record aside).
 */
// 【中文】网站登记的合并发票单号和 LHDN 的不同：LHDN 的单据仍有效、买方是 General Public、总额一致，而且不是本店某张发票或退款单的号码，就把单号改成 LHDN 的；否则返回 null（由调用方搁置）。
async function correctPortalConsolidatedNumber(
  rec: Rec,
  r: Extract<DocStatus, { ok: true }>,
  actor: Awaited<ReturnType<typeof getCurrentUser>>,
  request: Request
) {
  const lhdnNumber = String(r.internalId || "").trim();
  if (!lhdnNumber || lhdnNumber.length > 50) return null;
  const con = await prisma.consolidatedInvoice.findUnique({ where: { id: rec.id }, select: { totalAmount: true, month: true } });
  if (!con || !portalConsolidatedDocument(r.raw, { status: r.status, totalAmount: con.totalAmount })) return null;
  // One sale's own e-Invoice to General Public with the same total is still another document.
  const own =
    (await prisma.workOrder.findFirst({ where: { invoiceNumber: lhdnNumber }, select: { id: true } })) ||
    (await prisma.creditNote.findFirst({ where: { number: lhdnNumber }, select: { id: true } }));
  if (own) return null;
  let n;
  try {
    n = await prisma.consolidatedInvoice.updateMany({
      where: { id: rec.id, eInvoiceUuid: rec.eInvoiceUuid, eInvoiceStatus: rec.eInvoiceStatus, submissionUid: null },
      data: { number: lhdnNumber, eInvoiceStatus: r.status, eInvoiceLongId: r.longId || undefined },
    });
  } catch (e) {
    // The number is unique: another month's record already uses it.
    if ((e as { code?: string })?.code === "P2002") {
      return NextResponse.json(
        { error: `LHDN shows this consolidated e-Invoice as ${lhdnNumber}, but another month's record already uses that number. Nothing was changed.` },
        { status: 409 }
      );
    }
    throw e;
  }
  if (n.count === 0) return NextResponse.json({ error: "This record changed meanwhile. Reload the page." }, { status: 409 });
  if (actor) {
    await writeAuditLog({
      actor, request, action: "MYINVOIS_STATUS_UPDATED", entityType: "ConsolidatedInvoice", entityId: rec.id,
      summary: `Consolidated e-Invoice for ${con.month}: document number corrected from ${rec.number} to ${lhdnNumber} (as LHDN shows it)`,
      details: {
        environment: PRODUCTION,
        previous: { uuid: rec.eInvoiceUuid, longId: rec.eInvoiceLongId, status: rec.eInvoiceStatus, number: rec.number },
        next: { uuid: rec.eInvoiceUuid, longId: r.longId, status: r.status, number: lhdnNumber },
      },
    });
  }
  return NextResponse.json({
    ok: true,
    status: r.status,
    uuid: rec.eInvoiceUuid,
    longId: r.longId,
    environment: PRODUCTION,
    message: `LHDN shows this consolidated e-Invoice with document number ${lhdnNumber}. The number recorded here (${rec.number}) was corrected.`,
  });
}

/**
 * A consolidated e-Invoice recorded from the MyInvois portal whose reference LHDN does not
 * confirm (no such UUID, or the document is another one): it reports nothing, so it is set aside
 * ("rejected", audited) and the month's invoices are free to be recorded again with the reference
 * shown in the portal. Only the state that was read is changed. With `clearReference` (LHDN says
 * the UUID is another document's) the UUID and Long ID are removed too (they stay in the audit
 * entry), so they can be recorded on the document they belong to.
 */
// 【中文】网站登记的合并发票 LHDN 不认（没有这个 UUID，或是另一份单据）：标为 rejected（写审计），该月发票可以用网站上正确的资料重新登记。
// UUID 属于另一份单据时同时清掉 UUID 和 Long ID（审计里有记录），让它可以登记在真正的单据上。
async function setAsidePortalConsolidated(
  rec: Rec,
  actor: Awaited<ReturnType<typeof getCurrentUser>>,
  request: Request,
  why: string,
  opts: { clearReference?: boolean } = {}
) {
  const n = await prisma.consolidatedInvoice.updateMany({
    where: { id: rec.id, eInvoiceUuid: rec.eInvoiceUuid, eInvoiceStatus: rec.eInvoiceStatus, submissionUid: null },
    data: opts.clearReference ? { eInvoiceStatus: "rejected", eInvoiceUuid: null, eInvoiceLongId: null } : { eInvoiceStatus: "rejected" },
  });
  if (n.count === 0) return NextResponse.json({ error: "This record changed meanwhile. Reload the page." }, { status: 409 });
  if (actor) {
    await writeAuditLog({
      actor, request, action: "MYINVOIS_STATUS_UPDATED", entityType: "ConsolidatedInvoice", entityId: rec.id,
      summary: `Consolidated e-Invoice ${rec.number || rec.id} set aside: LHDN does not confirm its reference`,
      details: {
        environment: PRODUCTION,
        reason: why,
        previous: { uuid: rec.eInvoiceUuid, longId: rec.eInvoiceLongId, status: rec.eInvoiceStatus, number: rec.number },
        next: opts.clearReference ? { status: "rejected", uuid: null, longId: null } : { status: "rejected" },
      },
    });
  }
  return NextResponse.json({
    ok: true,
    status: "rejected",
    message: `${why} This record was set aside: record the consolidated e-Invoice again with the UUID and document number shown in the MyInvois portal.`,
  });
}

/**
 * Check Status for a submission LHDN did not answer: look for the document by its number.
 */
// 【中文】「检查状态」处理没回应的提交：按单号向 LHDN 查这份单据。
async function settle(kind: "order" | "creditNote" | "consolidated", rec: Rec, actor: Awaited<ReturnType<typeof getCurrentUser>>, request: Request) {
  // Which LHDN system the attempt went to: kept with an unanswered attempt (markUnconfirmed) and,
  // on a record with no UUID, with the claim itself (claimData). Read before the Settings
  // credentials, so a sandbox leftover says "switch to sandbox" even without production credentials.
  // 【中文】这次提交送往哪个 LHDN 系统：没回应的提交会记下；没有 UUID 的记录在占位时也会记下。先看这个，再读取设置里的凭证。
  const attemptEnv = isUnconfirmed(rec) ? recordEnv(rec) : !rec.eInvoiceUuid && rec.eInvoiceEnv ? recordEnv(rec) : null;
  const shop = await prisma.shopProfile.findFirst({ select: { myInvoisSandbox: true } });
  const env = envFromSandboxFlag(shop?.myInvoisSandbox);
  if (attemptEnv && attemptEnv !== env) {
    return NextResponse.json(
      { error: `This document was sent to the LHDN ${attemptEnv} system, but Settings are on ${env}. Switch Settings to ${attemptEnv} to check it.` },
      { status: 409 }
    );
  }
  await getMyInvoisConfig();
  if (!rec.number) return NextResponse.json({ error: "This record has no document number." }, { status: 400 });
  const s = await settleUnconfirmed({ kind: kind as GuardKind, rec, number: rec.number, env, actor, request });
  if (s.state === "error") return NextResponse.json({ error: s.message }, { status: s.status });
  if (s.state === "unsure") return NextResponse.json({ error: s.message, code: "UNCONFIRMED_UNSURE" }, { status: 409 });
  if (s.state === "wait") {
    return NextResponse.json({
      ok: true,
      status: "unconfirmed",
      message: `LHDN does not show this document yet. Check again after ${clock(s.until)}. Do not submit it again before then.`,
    });
  }
  if (s.state === "cleared") {
    return NextResponse.json({
      ok: true,
      status: "not_received",
      message: "LHDN never received the earlier submission. You can submit it again.",
    });
  }
  return NextResponse.json({ ok: true, status: s.status, uuid: s.uuid, longId: s.longId, environment: env, message: "Found at LHDN and saved." });
}
