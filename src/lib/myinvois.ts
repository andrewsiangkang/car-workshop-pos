import { prisma } from "./prisma";
import crypto from "crypto";
import { isValidMyInvoisPhone, normalizeMyInvoisPhone } from "./myinvois-phone.mjs";
import { revealSecret } from "./secret-box";
import { creditNoteBuyer, invoiceBuyer } from "./doc-snapshot.mjs";
import { LHDN_TIMEOUT_MS, pickSentDocument } from "./einvoice2-submit.mjs";
import { envFromSandboxFlag, SANDBOX } from "./einvoice-state.mjs";
import type { Buyer, Supplier, UblDocument } from "./einvoice2-ubl.mjs";

// The UBL documents are built by a pure module (tested by node --test); re-exported here for the routes.
// 【中文】UBL 电子发票文件由纯函数模块生成（有测试核对金额），这里转出口给各个接口使用。
export {
  buildConsolidatedJson,
  buildCreditNoteJson,
  buildInvoiceJson,
  buildUblDocument,
  buyerPhoneProblem,
  buyerProblem,
  creditNoteItemLines,
  documentTotals,
  payableOf,
  planConsolidatedDocument,
  splitByTax,
} from "./einvoice2-ubl.mjs";
export type { Buyer, DocTypeCode, Supplier, TaxPart, UblDocument, UblLine } from "./einvoice2-ubl.mjs";
export { GENERAL_PUBLIC_TIN } from "./einvoice2-ids.mjs";

const PROD_API = "https://api.myinvois.hasil.gov.my";
const SANDBOX_API = "https://preprod-api.myinvois.hasil.gov.my";
const PROD_PORTAL = "https://myinvois.hasil.gov.my";
const SANDBOX_PORTAL = "https://preprod.myinvois.hasil.gov.my";

export async function getMyInvoisConfig() {
  const row = await prisma.shopProfile.findFirst();
  // The client secret is stored encrypted (secret-box); everything below sees the plain value.
  const shop = row && { ...row, myInvoisClientSecret: revealSecret(row.myInvoisClientSecret) };
  if (!shop?.myInvoisClientId || !shop.myInvoisClientSecret) {
    throw new Error("MyInvois Client ID / Secret not configured in Settings");
  }
  // MYINVOIS_API_BASE is for automated testing against a local mock only.
  const base = process.env.MYINVOIS_API_BASE || (shop.myInvoisSandbox ? SANDBOX_API : PROD_API);
  const portal = shop.myInvoisSandbox ? SANDBOX_PORTAL : PROD_PORTAL;
  return { shop, base, portal };
}

/**
 * API address of one LHDN system. A route decides the environment (and the production block)
 * once; the calls that send or look up a document use that decision instead of reading Settings
 * again, so a Settings change in between can never send a document to the other system.
 */
// 【中文】按路由已经决定的环境选 LHDN 地址，不再重新读设置，避免中途切换设置把单据送到另一个系统。
function apiBaseFor(env: "sandbox" | "production") {
  return process.env.MYINVOIS_API_BASE || (env === SANDBOX ? SANDBOX_API : PROD_API);
}

// LHDN tokens last ~60 min and the API is rate-limited, so reuse a token instead of
// logging in again on every submit / status check.
let tokenCache: { key: string; token: string; exp: number } | null = null;

export function portalUrl(sandbox: boolean) {
  return sandbox ? SANDBOX_PORTAL : PROD_PORTAL;
}

export async function getAccessToken(baseIn?: string) {
  const { shop, base: configBase } = await getMyInvoisConfig();
  const base = baseIn || configBase;
  const key = `${base}|${shop.myInvoisClientId}|${shop.myInvoisClientSecret}`;
  if (tokenCache && tokenCache.key === key && Date.now() < tokenCache.exp) return tokenCache.token;
  const token = await fetchAccessToken(shop, base);
  tokenCache = { key, token: token.access_token, exp: Date.now() + (Number(token.expires_in) || 3600) * 1000 - 120_000 };
  return tokenCache.token;
}

async function fetchAccessToken(
  shop: { myInvoisClientId: string | null; myInvoisClientSecret: string | null },
  base: string
) {
  const body = new URLSearchParams({
    client_id: shop.myInvoisClientId!,
    client_secret: shop.myInvoisClientSecret!,
    grant_type: "client_credentials",
    scope: "InvoicingAPI",
  });
  let res: Response;
  try {
    res = await fetch(`${base}/connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(LHDN_TIMEOUT_MS),
    });
  } catch {
    // Nothing has been sent yet, so this is a plain failure (safe to try again).
    throw new Error("Could not log in to LHDN MyInvois (no answer). Nothing was sent. Try again in a minute.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error_description || data.error || "Auth failed");
  }
  return data as { access_token: string; expires_in?: number };
}


// ---------------------------------------------------------------------------
// Supplier (the shop)
// ---------------------------------------------------------------------------

/** Build the supplier block from Settings, listing anything LHDN requires that is missing. */
export function supplierFromShop(shop: {
  name: string; tin: string | null; brn: string | null; sstNumber: string | null; msicCode: string | null;
  msicDesc: string | null; phone: string | null; address: string | null; city: string | null;
  postcode: string | null; stateCode: string | null;
}): { supplier: Supplier; missing: string[] } {
  const missing: string[] = [];
  if (!shop.tin) missing.push("TIN");
  if (!shop.address) missing.push("street address");
  if (!shop.city) missing.push("city");
  if (!/^\d{5}$/.test(shop.postcode || "")) missing.push("5-digit postcode");
  if (!shop.stateCode) missing.push("state");
  const normalizedPhone = normalizeMyInvoisPhone(shop.phone);
  // Validate what was typed (not the already-normalised value: "-" or "NIL" used to pass as "NA").
  // LHDN never accepts "NA" for the seller's phone.
  if (!String(shop.phone || "").trim()) missing.push("phone");
  else if (!isValidMyInvoisPhone(shop.phone, { allowNA: false })) {
    missing.push("a valid phone number, e.g. 03-1234 5678 or +60 12-345 6789");
  }
  const sst = (shop.sstNumber || "").trim();
  return {
    missing,
    supplier: {
      name: shop.name,
      tin: shop.tin || "",
      brn: shop.brn || "NA",
      sst: sst && sst.toUpperCase() !== "NA" ? sst : "NA",
      msic: shop.msicCode || "45201",
      msicDesc: shop.msicDesc || "Maintenance and repair of motor vehicles",
      phone: normalizedPhone,
      address: shop.address || "NA",
      city: shop.city || "NA",
      postcode: shop.postcode || "",
      stateCode: shop.stateCode || "17",
    },
  };
}

// ---------------------------------------------------------------------------
// Buyer (one rule for the print and LHDN, see doc-snapshot.mjs)
// ---------------------------------------------------------------------------

type OrderBuyerFields = {
  customer?: { name: string; tin: string | null; phone: string | null } | null;
  buyerRequestedAt?: Date | null;
  buyerName?: string | null; buyerTin?: string | null; buyerIdType?: string | null; buyerIdNo?: string | null;
  buyerEmail?: string | null; buyerPhone?: string | null; buyerAddress?: string | null;
  buyerPostcode?: string | null; buyerCity?: string | null; buyerStateCode?: string | null;
  /** Particulars frozen when the invoice was issued (v0.3.29). */
  docSnapshot?: string | null;
};

/**
 * Buyer for a work order's e-Invoice: the details the customer sent by QR (or staff typed) if
 * any, else the buyer frozen on the invoice, else the customer record (older invoices).
 * The printed invoice / receipt uses the very same rule (docdata.ts), so both name one buyer.
 */
// 【中文】电子发票的买方：顾客扫码 / 店员填的资料 → 开票时冻结的买方 → 旧发票才用现在的客户资料。打印的发票用同一个规则，两边一定一致。
export function buyerForOrder(o: OrderBuyerFields): Buyer {
  return invoiceBuyer({ order: o, customer: o.customer });
}

/**
 * Buyer for a credit note's e-Invoice: the buyer of the invoice it credits, or General Public
 * when it refers to the monthly consolidated e-Invoice (`via`, from creditNoteReference). The
 * printed credit note uses the same rule, so the print and LHDN always name one buyer.
 */
// 【中文】退款单电子发票的买方 = 原发票的买方；对合并电子发票开的就是 General Public。打印的退款单用同一个规则。
export function buyerForCreditNote(
  cn: { docSnapshot?: string | null },
  o: OrderBuyerFields,
  via?: "invoice" | "consolidated" | null
): Buyer {
  return creditNoteBuyer({ creditNote: cn, order: o, customer: o.customer, via });
}

export function documentHashAndBase64(jsonObj: unknown) {
  const json = JSON.stringify(jsonObj);
  const hash = crypto.createHash("sha256").update(json).digest("hex");
  const b64 = Buffer.from(json, "utf8").toString("base64");
  return { hash, b64, json };
}

// ---------------------------------------------------------------------------
// Submission + status (shared by invoices, credit notes and consolidated)
// ---------------------------------------------------------------------------

export type SubmitResult =
  | { ok: true; submissionUID: string; uuid: string | null; raw: unknown }
  /**
   * `unknown`: LHDN gave no usable answer (timeout, network error, an answer that could not be
   * read). The document may have arrived, so it must not be treated as "not sent".
   */
  | { ok: false; status: number; detail: unknown; unknown?: boolean };

/**
 * Send one document to LHDN. Waits at most 30 seconds. Errors before anything is sent (Settings,
 * login) are thrown; once the document has left, every failure is returned, marked `unknown`
 * when LHDN may have received it (see submitOutcome in einvoice2-submit.mjs).
 */
// 【中文】把一份单据送给 LHDN，最多等 30 秒。送出前的错误（设置、登录）直接抛出；送出后没有可用回应的标记为 unknown（可能已送到），不能当作"没送出"。
// opts.env：路由已检查过的环境。正式环境（还没有数字签名）一律不送；设置在这期间被改动也不送。
export async function submitDocument(doc: UblDocument, codeNumber: string, opts: { env: "sandbox" | "production" }): Promise<SubmitResult> {
  // Only the sandbox takes documents from this app (production needs XAdES signing, not built yet).
  if (opts.env !== SANDBOX) {
    throw new Error("Production MyInvois submission is disabled until XAdES digital signing is implemented. Nothing was sent.");
  }
  // Settings changed since the route checked them: send nothing (the record would name the wrong system).
  const { shop } = await getMyInvoisConfig();
  if (envFromSandboxFlag(shop.myInvoisSandbox) !== opts.env) {
    throw new Error("The LHDN environment in Settings changed while sending. Nothing was sent. Try again.");
  }
  const base = apiBaseFor(opts.env);
  const token = await getAccessToken(base);
  const { hash, b64 } = documentHashAndBase64(doc);
  let res: Response;
  try {
    res = await fetch(`${base}/api/v1.0/documentsubmissions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ documents: [{ format: "JSON", document: b64, documentHash: hash, codeNumber }] }),
      signal: AbortSignal.timeout(LHDN_TIMEOUT_MS),
    });
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return {
      ok: false,
      status: 0,
      unknown: true,
      detail: { message: timedOut ? `No answer from LHDN within ${LHDN_TIMEOUT_MS / 1000} seconds` : "Could not reach LHDN (network error)" },
    };
  }
  let data: Record<string, unknown>;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    // An accepted submission whose answer cannot be read may still have created the document.
    return { ok: false, status: res.status, detail: { message: `LHDN answered ${res.status} without readable details` }, unknown: res.ok };
  }
  if (!res.ok) return { ok: false, status: res.status, detail: data };
  const accepted = (data.acceptedDocuments as Array<{ uuid?: string }> | undefined)?.[0];
  if (accepted?.uuid) return { ok: true, submissionUID: String(data.submissionUID || ""), uuid: accepted.uuid, raw: data };
  const rejected = (data.rejectedDocuments as unknown[] | undefined)?.[0];
  // Accepted with neither an accepted nor a rejected document: we cannot tell, so ask LHDN later.
  return rejected ? { ok: false, status: 400, detail: rejected } : { ok: false, status: res.status, detail: data, unknown: true };
}

export type TinSearch =
  | { ok: true; tin: string }
  | { ok: false; status: number; message: string };

/**
 * Ask LHDN for a taxpayer's TIN from their ID (NRIC / passport / BRN / army).
 * Uses the same Client ID / Secret as submitting. LHDN limits this to about 60 calls a minute.
 */
export async function searchTin(idType: string, idValue: string, name?: string): Promise<TinSearch> {
  const { base } = await getMyInvoisConfig();
  const token = await getAccessToken();
  const q = new URLSearchParams({ idType, idValue });
  if (name) q.set("taxpayerName", name);
  let res: Response;
  try {
    res = await fetch(`${base}/api/v1.0/taxpayer/search/tin?${q.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(LHDN_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, status: 504, message: "LHDN did not answer. Try again in a minute." };
  }
  const data = await res.json().catch(() => ({}));
  if (res.ok && data?.tin) return { ok: true, tin: String(data.tin) };
  const message =
    res.status === 404 ? "No TIN found for this ID. The customer may not have a TIN yet, or the ID / name is different."
    : res.status === 429 ? "Too many lookups. Wait a minute and try again."
    : data?.error?.message || data?.message || `LHDN returned ${res.status}`;
  return { ok: false, status: res.status, message };
}

export type SentDocument = { uuid: string; submissionUid: string | null; longId: string | null; status: string };

/**
 * Find the document we sent with this number, submitted inside `win` (see sentLookupWindow:
 * a short window around the unanswered attempt). Used after a submission got no answer: it tells
 * whether LHDN has the document after all.
 * - "recent": LHDN's "recent documents" list (last 31 days only);
 * - "search": LHDN's "search documents" (older attempts; a range of at most 30 days, filtered by
 *   our document number).
 * `complete` is false when LHDN listed more pages than are read here (5 × 100 rows): a document
 * not found in a cut-short list may still exist, so the caller must not treat it as "not sent".
 * NOTE: checked against LHDN's published API description only (no LHDN connection while writing).
 */
// 【中文】按单号在提交前后的一小段时间内向 LHDN 查单据（提交没回应时用来确认 LHDN 到底有没有收到）。
// 31 天内用「最近单据」，更早的用「搜索单据」。清单太长没读完时 complete=false，调用方不能当作"没收到"。
export async function findSentDocument(
  internalId: string,
  win: { from: Date; to: Date; source: "recent" | "search" },
  opts: { env: "sandbox" | "production" }
): Promise<{ ok: true; doc: SentDocument | null; complete: boolean } | { ok: false; status: number; detail: unknown }> {
  // The LHDN system the caller settled on (never re-read from Settings mid-way).
  const base = apiBaseFor(opts.env);
  const token = await getAccessToken(base);
  // LHDN wants "2026-11-14T03:00:00Z" (no milliseconds).
  const stamp = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
  const MAX_PAGES = 5;
  const rows: Array<Record<string, unknown>> = [];
  let complete = false;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const q = new URLSearchParams({
      pageNo: String(page),
      pageSize: "100",
      submissionDateFrom: stamp(win.from),
      submissionDateTo: stamp(win.to),
    });
    if (win.source === "recent") q.set("InvoiceDirection", "Sent");
    else {
      q.set("invoiceDirection", "Sent");
      q.set("searchQuery", internalId);
    }
    const path = win.source === "recent" ? "documents/recent" : "documents/search";
    let res: Response;
    try {
      res = await fetch(`${base}/api/v1.0/${path}?${q.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(LHDN_TIMEOUT_MS),
      });
    } catch {
      return { ok: false, status: 504, detail: { message: "LHDN did not answer the search for the document" } };
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, status: res.status, detail: data };
    const result: Array<Record<string, unknown>> = Array.isArray(data?.result) ? data.result : [];
    rows.push(...result);
    const pages = Number(data?.metadata?.totalPages) || 1;
    if (page >= pages || !result.length) {
      complete = true;
      break;
    }
  }
  return { ok: true, doc: pickSentDocument(rows, internalId), complete };
}

export type DocStatus =
  | { ok: true; uuid: string | null; longId: string | null; internalId: string | null; status: string; reason: string | null; raw: unknown }
  | { ok: false; status: number; detail: unknown };

/**
 * Status of one document in a submission. When the record's UUID is known, the matching
 * document is picked (a submission can hold several). `internalId` is the document number
 * we sent, so callers can check LHDN's answer is about the right invoice.
 */
export async function getSubmissionStatus(submissionUID: string, expectedUuid?: string | null): Promise<DocStatus> {
  const { base } = await getMyInvoisConfig();
  const token = await getAccessToken();
  const res = await fetch(`${base}/api/v1.0/documentsubmissions/${encodeURIComponent(submissionUID)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false as const, status: res.status, detail: data };
  const docs: Array<Record<string, unknown>> = data.documentSummary || data.documents || [];
  const doc = (expectedUuid && docs.find((d) => d?.uuid === expectedUuid)) || docs[0];
  const status = String(doc?.status || data.overallStatus || "pending").toLowerCase();
  const uuid = (doc?.uuid as string) || null;
  // LHDN's reasons for "invalid" are only in the document details.
  const reason = status === "invalid" && uuid ? await invalidReason(uuid).catch(() => null) : null;
  return {
    ok: true as const,
    uuid,
    longId: (doc?.longId as string) || null,
    internalId: (doc?.internalId as string) || null,
    status,
    reason,
    raw: data,
  };
}

/** Flatten LHDN validation errors into one readable line. */
function validationReasonOf(details: Record<string, unknown>): string | null {
  const steps = ((details?.validationResults as Record<string, unknown>)?.validationSteps as Array<Record<string, unknown>>) || [];
  const out: string[] = [];
  const walk = (e: Record<string, unknown> | undefined) => {
    if (!e) return;
    const msg = (e.error || e.errorMS || e.message) as string | undefined;
    const where = (e.propertyPath || e.propertyName) as string | undefined;
    // Keep LHDN's error code (e.g. CF410) in front so the friendly error mapper can use it too.
    const code = typeof e.errorCode === "string" && e.errorCode ? `${e.errorCode}: ` : "";
    if (msg) out.push(where ? `${code}${msg} (${where})` : `${code}${msg}`);
    for (const inner of (e.innerError as Array<Record<string, unknown>>) || []) walk(inner);
  };
  for (const s of steps) if (String(s.status || "").toLowerCase() === "invalid") walk(s.error as Record<string, unknown>);
  return out.length ? [...new Set(out)].join("; ").slice(0, 1000) : null;
}

async function fetchDocumentDetails(uuid: string) {
  const { base } = await getMyInvoisConfig();
  const token = await getAccessToken();
  const res = await fetch(`${base}/api/v1.0/documents/${encodeURIComponent(uuid)}/details`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data: data as Record<string, unknown> };
}

async function invalidReason(uuid: string) {
  const { res, data } = await fetchDocumentDetails(uuid);
  return res.ok ? validationReasonOf(data) : null;
}

/**
 * Status of a document by its UUID (for references typed in by hand from the MyInvois
 * portal, which have no submission id).
 */
export async function getDocumentDetails(uuid: string): Promise<DocStatus> {
  const { res, data } = await fetchDocumentDetails(uuid);
  if (!res.ok) return { ok: false as const, status: res.status, detail: data };
  const status = String(data.status || "pending").toLowerCase();
  return {
    ok: true as const,
    uuid: (data.uuid as string) || uuid,
    longId: ((data.longId || data.longID) as string) || null,
    internalId: (data.internalId as string) || null,
    status,
    reason: status === "invalid" ? validationReasonOf(data) : null,
    raw: data,
  };
}

/** Malaysia-time issue date/time in the format LHDN expects (sent as UTC). */
export function issueStamp() {
  const now = new Date();
  return { issueDate: now.toISOString().slice(0, 10), issueTime: now.toISOString().slice(11, 19) + "Z" };
}
