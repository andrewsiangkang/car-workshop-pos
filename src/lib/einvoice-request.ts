import crypto from "node:crypto";
import os from "node:os";
import { prisma } from "@/lib/prisma";
import { envFromSandboxFlag, isLiveEInvoice } from "@/lib/einvoice-state.mjs";
import { inFlightFor, submitGate } from "@/lib/einvoice2-submit.mjs";
import {
  BUYER_ID_TYPES,
  buyerRequestDeadline,
  buyerRequestLock,
  checkBuyerFields,
  malaysiaMonth,
  reportedInConsolidation,
  type BuyerFieldError,
  type BuyerRequestLock,
  type BuyerValue,
} from "@/lib/einvoice-rules.mjs";

/**
 * Customer e-Invoice request (v0.2.9).
 * A QR code on the invoice / receipt opens a public page on the shop's network where the
 * customer fills in their own ID / address (and TIN; a Malaysian individual may leave it blank).
 * Staff then submit the e-Invoice to LHDN.
 */

export const ID_TYPES = BUYER_ID_TYPES;
export type IdType = (typeof ID_TYPES)[number];
export type { BuyerRequestLock };

/** Audit action written when staff save the buyer on the invoice page (work-orders/[id] save_buyer). */
const STAFF_BUYER_SAVED = "EINVOICE_BUYER_UPDATED";

type LockFields = {
  invoiceNumber: string | null;
  status: string;
  eInvoiceUuid: string | null;
  eInvoiceStatus: string | null;
  eInvoiceEnv?: string | null;
  /** A submission's claim: being sent, unanswered, or left behind by a crash. */
  eInvoiceSubmittingAt?: Date | null;
  consolidatedId: string | null;
  invoicedAt?: Date | null;
};

/**
 * The invoice can no longer take buyer details once it is in an e-Invoice or a monthly
 * consolidated one, or once the consolidation deadline of its month (7th of next month,
 * Malaysia time) has passed. `extra` adds what needs the database (see buyerRequestLockFor):
 * `consolidated` is whether a real consolidated e-Invoice reported it. Without it, any link
 * to a consolidated record (even a sandbox test or a rejected one) is taken as reported, the
 * careful choice when the database is not asked.
 */
// 【中文】扫码申请是否关闭：已开电子发票、已并入合并发票、店员已填好资料、或已过该月合并发票截止日（次月 7 号）。
export function requestLockReason(
  o: LockFields,
  extra?: { staffSaved?: boolean; consolidated?: boolean; now?: Date; env?: "sandbox" | "production" }
): BuyerRequestLock {
  return buyerRequestLock(
    {
      hasInvoice: !!o.invoiceNumber && o.status !== "CANCELLED",
      // A sandbox test result is not a real e-Invoice, so it does not lock the request. A
      // submission being sent, unanswered or left behind by a crash may be at LHDN: closed until
      // Check Status settles it. Working in production, an unanswered SANDBOX test does not close
      // it (same rule as buyerEditLock and the consolidation). 【中文】正在送 / 没回应 / 崩溃留下占位时关闭；正式环境下沙盒测试没回应不算。
      live: isLiveEInvoice(o) || (extra?.env ? inFlightFor(o, extra.env) : submitGate(o).action !== "go"),
      consolidated: extra?.consolidated ?? !!o.consolidatedId,
      staffSaved: !!extra?.staffSaved,
      invoicedAt: o.invoicedAt ?? null,
    },
    extra?.now
  );
}

/**
 * Full check for the public QR page and route: also asks the database whether staff already
 * saved the buyer (their save is audited) and whether the invoice was really reported in a
 * consolidated e-Invoice: the one it is linked to, or its month's, must be a real (production)
 * one LHDN still counts. A sandbox test or a rejected one does not close the request.
 * Returns the lock and the deadline for the customer.
 */
// 【中文】公开扫码页面 / 接口用的完整检查：另外查店员是否已保存买家资料，以及所链接的 / 该月的合并发票是否是真正有效的（沙盒测试或被拒绝的不算）。
export async function buyerRequestLockFor(o: LockFields & { id: string }) {
  const conSelect = { eInvoiceUuid: true, eInvoiceStatus: true, eInvoiceEnv: true } as const;
  const [staffSaved, monthCon, linkedCon, shop] = await Promise.all([
    prisma.auditLog
      .count({ where: { entityType: "WorkOrder", entityId: o.id, action: STAFF_BUYER_SAVED } })
      .then((n) => n > 0),
    o.invoicedAt
      ? prisma.consolidatedInvoice.findUnique({ where: { month: malaysiaMonth(o.invoicedAt) }, select: conSelect })
      : Promise.resolve(null),
    o.consolidatedId
      ? prisma.consolidatedInvoice.findUnique({ where: { id: o.consolidatedId }, select: conSelect })
      : Promise.resolve(null),
    prisma.shopProfile.findFirst({ select: { myInvoisSandbox: true } }),
  ]);
  const env = envFromSandboxFlag(shop?.myInvoisSandbox);
  const lock = requestLockReason(o, { staffSaved, consolidated: reportedInConsolidation(linkedCon, monthCon), env });
  return { lock, deadline: buyerRequestDeadline(o.invoicedAt ?? null), env };
}

/** Random, unguessable code for the QR link. Created the first time an invoice is shown. */
export async function ensureEInvoiceToken(orderId: string, current: string | null | undefined) {
  if (current) return current;
  for (let i = 0; i < 3; i++) {
    const token = crypto.randomBytes(16).toString("base64url");
    try {
      await prisma.workOrder.update({ where: { id: orderId }, data: { eInvoiceToken: token } });
      return token;
    } catch {
      // extremely unlikely unique clash: try again
    }
  }
  return null;
}

/**
 * True when the desktop app runs with phone / tablet access off (Settings → Phone / Tablet)
 * and no WORKSHOP_PUBLIC_URL is set: the server only listens on 127.0.0.1.
 */
// 【中文】桌面版关闭了「手机 / 平板访问」且没设 WORKSHOP_PUBLIC_URL 时，顾客手机连不到，二维码不显示。
export function customerQrBlockedByLanSetting() {
  // Same rule as /api/network: an explicit WORKSHOP_LAN_ACCESS wins; otherwise a server that only
  // listens on this computer (source install) cannot be reached from a customer's phone.
  // 【中文】和 /api/network 同一规则：只在本机监听（源码版默认）时，顾客手机扫码也打不开，所以不印 QR。
  const lan = process.env.WORKSHOP_LAN_ACCESS;
  const listen = (process.env.WORKSHOP_LISTEN_HOST || "").trim().toLowerCase();
  const localOnly = lan !== undefined ? lan === "0" : ["127.0.0.1", "localhost", "::1"].includes(listen);
  return localOnly && !(process.env.WORKSHOP_PUBLIC_URL || "").trim();
}

function isLocalOrTailscale(host: string) {
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/i.test(host)) return true;
  const m = /^100\.(\d+)\./.exec(host);
  return !!m && Number(m[1]) >= 64 && Number(m[1]) <= 127; // Tailscale: customers cannot reach it
}

function lanIp() {
  const found: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list || []) {
      if (n.family !== "IPv4" || n.internal || n.address.startsWith("169.254.")) continue;
      if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(n.address)) continue; // Tailscale
      found.push(n.address);
    }
  }
  const rank = (ip: string) => (ip.startsWith("192.168.") ? 0 : ip.startsWith("10.") ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3);
  found.sort((a, b) => rank(a) - rank(b));
  return found[0] || null;
}

/**
 * Address the customer's phone can open. Set WORKSHOP_PUBLIC_URL to override (e.g. a fixed
 * shop-Wi-Fi address). Otherwise it is the address this page was opened with; when that is
 * localhost / Tailscale, the computer's shop Wi-Fi address is used instead.
 */
export function customerBaseUrl(hostHeader: string | null): string | null {
  const env = (process.env.WORKSHOP_PUBLIC_URL || "").trim().replace(/\/+$/, "");
  if (env) return env;
  // Desktop app with phone / tablet access switched off: no customer phone can reach us,
  // so there is no point printing a QR that cannot open.
  if (customerQrBlockedByLanSetting()) return null;
  const host = hostHeader || "localhost:3000";
  const m = /^(.*?)(?::(\d+))?$/.exec(host);
  const name = m?.[1] || "localhost";
  const port = m?.[2] || process.env.PORT || "3000";
  if (!isLocalOrTailscale(name)) return `http://${host}`;
  const ip = lanIp();
  return `http://${ip || name}:${port}`;
}

export type BuyerInput = BuyerValue;

/**
 * Validate what the customer typed. Returns the cleaned values or a list of problems (one per
 * field: "required" | "invalid" | "too_long"). Values over LHDN's limits are refused, not cut
 * short, and the PDPA consent tick (`consent: true`) is required.
 */
export function validateBuyer(
  raw: unknown
): { ok: true; value: BuyerInput } | { ok: false; errors: Record<string, BuyerFieldError> } {
  return checkBuyerFields(raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null);
}

// Light throttle on the public form: at most 8 sends per link per 10 minutes (in memory).
const hits = new Map<string, number[]>();
export function tooManyRequests(key: string) {
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < 10 * 60 * 1000);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 500) for (const [k, v] of hits) if (v.every((t) => now - t > 10 * 60 * 1000)) hits.delete(k);
  return recent.length > 8;
}
