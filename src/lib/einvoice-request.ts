import crypto from "node:crypto";
import os from "node:os";
import { prisma } from "@/lib/prisma";
import { MY_STATES } from "@/lib/my-states";

/**
 * Customer e-Invoice request (v0.2.9).
 * A QR code on the invoice / receipt opens a public page on the shop's network where the
 * customer fills in their own TIN / ID / address. Staff then submit the e-Invoice to LHDN.
 */

export const ID_TYPES = ["NRIC", "PASSPORT", "BRN", "ARMY"] as const;
export type IdType = (typeof ID_TYPES)[number];

const isLive = (s: string | null | undefined) => !["invalid", "cancelled"].includes((s || "").toLowerCase());

/** The invoice can no longer take buyer details once it is in an e-Invoice or a monthly consolidated one. */
export function requestLockReason(o: {
  invoiceNumber: string | null;
  status: string;
  eInvoiceUuid: string | null;
  eInvoiceStatus: string | null;
  consolidatedId: string | null;
}): "none" | "no_invoice" | "submitted" | "consolidated" {
  if (!o.invoiceNumber || o.status === "CANCELLED") return "no_invoice";
  if (o.eInvoiceUuid && isLive(o.eInvoiceStatus)) return "submitted";
  if (o.consolidatedId) return "consolidated";
  return "none";
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
export function customerBaseUrl(hostHeader: string | null) {
  const env = (process.env.WORKSHOP_PUBLIC_URL || "").trim().replace(/\/+$/, "");
  if (env) return env;
  const host = hostHeader || "localhost:3000";
  const m = /^(.*?)(?::(\d+))?$/.exec(host);
  const name = m?.[1] || "localhost";
  const port = m?.[2] || process.env.PORT || "3000";
  if (!isLocalOrTailscale(name)) return `http://${host}`;
  const ip = lanIp();
  return `http://${ip || name}:${port}`;
}

export type BuyerInput = {
  name: string;
  tin: string;
  idType: IdType;
  idNo: string;
  email: string;
  phone: string;
  address: string;
  postcode: string;
  city: string;
  stateCode: string;
};

const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Validate what the customer typed. Returns the cleaned values or a list of problems (one per field). */
export function validateBuyer(raw: any): { ok: true; value: BuyerInput } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const name = clean(raw?.name, 150);
  const tin = clean(raw?.tin, 20).toUpperCase().replace(/\s/g, "");
  const idType = clean(raw?.idType, 10).toUpperCase() as IdType;
  let idNo = clean(raw?.idNo, 25).toUpperCase().replace(/[\s-]/g, "");
  const email = clean(raw?.email, 120);
  const phone = clean(raw?.phone, 20).replace(/[^\d+]/g, "");
  const address = clean(raw?.address, 200);
  const postcode = clean(raw?.postcode, 5);
  const city = clean(raw?.city, 60);
  const stateCode = clean(raw?.stateCode, 2);

  if (name.length < 2) errors.name = "required";
  if (!/^[A-Z0-9]{6,20}$/.test(tin)) errors.tin = "invalid";
  if (!ID_TYPES.includes(idType)) errors.idType = "invalid";
  else if (idType === "NRIC" && !/^\d{12}$/.test(idNo)) errors.idNo = "invalid";
  else if (idType !== "NRIC" && !/^[A-Z0-9]{5,20}$/.test(idNo)) errors.idNo = "invalid";
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "invalid";
  if (phone && !/^\+?\d{8,15}$/.test(phone)) errors.phone = "invalid";
  if (address.length < 3) errors.address = "required";
  if (!/^\d{5}$/.test(postcode)) errors.postcode = "invalid";
  if (city.length < 2) errors.city = "required";
  if (!MY_STATES[stateCode] || stateCode === "17") errors.stateCode = "required";

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { name, tin, idType, idNo, email, phone, address, postcode, city, stateCode } };
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
