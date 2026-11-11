import { prisma } from "./prisma";
import crypto from "crypto";
import { computeTotals, money } from "./tax";

const PROD_API = "https://api.myinvois.hasil.gov.my";
const SANDBOX_API = "https://preprod-api.myinvois.hasil.gov.my";
const PROD_PORTAL = "https://myinvois.hasil.gov.my";
const SANDBOX_PORTAL = "https://preprod.myinvois.hasil.gov.my";

export async function getMyInvoisConfig() {
  const shop = await prisma.shopProfile.findFirst();
  if (!shop?.myInvoisClientId || !shop.myInvoisClientSecret) {
    throw new Error("MyInvois Client ID / Secret not configured in Settings");
  }
  // MYINVOIS_API_BASE is for automated testing against a local mock only.
  const base = process.env.MYINVOIS_API_BASE || (shop.myInvoisSandbox ? SANDBOX_API : PROD_API);
  const portal = shop.myInvoisSandbox ? SANDBOX_PORTAL : PROD_PORTAL;
  return { shop, base, portal };
}

// LHDN tokens last ~60 min and the API is rate-limited, so reuse a token instead of
// logging in again on every submit / status check.
let tokenCache: { key: string; token: string; exp: number } | null = null;

export function portalUrl(sandbox: boolean) {
  return sandbox ? SANDBOX_PORTAL : PROD_PORTAL;
}

export async function getAccessToken() {
  const { shop, base } = await getMyInvoisConfig();
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
  const res = await fetch(`${base}/connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error_description || data.error || "Auth failed");
  }
  return data as { access_token: string; expires_in?: number };
}

// ---------------------------------------------------------------------------
// Supplier (the shop)
// ---------------------------------------------------------------------------

export type Supplier = {
  name: string; tin: string; brn: string; sst: string; msic: string; msicDesc: string;
  phone: string; address: string; city: string; postcode: string; stateCode: string;
};

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
  if (!shop.phone) missing.push("phone");
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
      phone: shop.phone || "NA",
      address: shop.address || "NA",
      city: shop.city || "NA",
      postcode: shop.postcode || "",
      stateCode: shop.stateCode || "17",
    },
  };
}

// ---------------------------------------------------------------------------
// Generic UBL 2.1 JSON builder (invoice 01, credit note 02, consolidated 01)
// ---------------------------------------------------------------------------

/** One tax bucket of a line: amount it applies to, the SST charged and the rate (0 = not taxed). */
export type TaxPart = { base: number; tax: number; rate: number };

export type UblLine = {
  description: string;
  quantity: number;
  unitPrice: number;
  gross: number;     // quantity × unit price, before discount
  discount: number;  // discount on this line
  parts: TaxPart[];  // tax buckets; their bases add up to gross − discount
  classification: string; // LHDN item classification code
};

/**
 * Split an amount that has already been taxed (net + tax) into a taxed bucket and an
 * untaxed bucket. Needed when only labour was taxed (scope "LABOR") or for credit
 * notes / consolidated lines that cover part of an invoice.
 */
export function splitByTax(net: number, tax: number, rate: number): TaxPart[] {
  net = money(net); tax = money(tax);
  if (tax <= 0 || rate <= 0) return [{ base: net, tax: 0, rate: 0 }];
  const taxedBase = Math.min(net, money((tax * 100) / rate));
  const rest = money(net - taxedBase);
  return rest > 0
    ? [{ base: taxedBase, tax, rate }, { base: rest, tax: 0, rate: 0 }]
    : [{ base: taxedBase, tax, rate }];
}

// LHDN tax types: 02 = Service Tax, 06 = Not Applicable.
const SCHEME = [{ ID: [{ _: "OTH", schemeAgencyID: "6", schemeID: "UN/ECE 5153" }] }];
const cur = (n: number) => [{ _: money(n), currencyID: "MYR" }];
const subtotal = (p: TaxPart) => ({
  TaxableAmount: cur(p.base),
  TaxAmount: cur(p.tax),
  Percent: [{ _: p.rate > 0 ? p.rate : 0 }],
  TaxCategory: [{ ID: [{ _: p.rate > 0 ? "02" : "06" }], TaxScheme: SCHEME }],
});

const GENERAL_PUBLIC = { name: "General Public", tin: null as string | null, phone: null as string | null };

export function buildUblDocument(p: {
  typeCode: "01" | "02"; // 01 invoice, 02 credit note
  number: string;
  issueDate: string;
  issueTime: string;
  supplier: Supplier;
  customer: { name: string; tin?: string | null; phone?: string | null };
  lines: UblLine[];
  billingReference?: { number: string; uuid: string };
}) {
  const lines = p.lines.map((l, i) => {
    const net = money(l.gross - l.discount);
    const lineTax = money(l.parts.reduce((s, x) => s + x.tax, 0));
    return {
      ID: [{ _: String(i + 1) }],
      InvoicedQuantity: [{ _: l.quantity, unitCode: "C62" }],
      LineExtensionAmount: cur(net), // after discount, before tax
      ...(l.discount > 0
        ? { AllowanceCharge: [{ ChargeIndicator: [{ _: false }], AllowanceChargeReason: [{ _: "Discount" }], Amount: cur(l.discount) }] }
        : {}),
      TaxTotal: [{ TaxAmount: cur(lineTax), TaxSubtotal: l.parts.map(subtotal) }], // mandatory per line
      Item: [{
        CommodityClassification: [{ ItemClassificationCode: [{ _: l.classification, listID: "CLASS" }] }],
        Description: [{ _: l.description.slice(0, 300) }],
      }],
      Price: [{ PriceAmount: cur(l.unitPrice) }],
      ItemPriceExtension: [{ Amount: cur(l.gross) }],
    };
  });

  // Document tax buckets, grouped by rate.
  const buckets = new Map<number, TaxPart>();
  for (const l of p.lines) for (const x of l.parts) {
    const b = buckets.get(x.rate) || { base: 0, tax: 0, rate: x.rate };
    b.base = money(b.base + x.base); b.tax = money(b.tax + x.tax);
    buckets.set(x.rate, b);
  }
  const net = money(p.lines.reduce((s, l) => s + (l.gross - l.discount), 0));
  const tax = money([...buckets.values()].reduce((s, b) => s + b.tax, 0));
  const total = money(net + tax);
  const sup = p.supplier;
  const cus = p.customer;

  return {
    _D: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
    _A: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
    _B: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
    Invoice: [{
      ID: [{ _: p.number }],
      IssueDate: [{ _: p.issueDate }],
      IssueTime: [{ _: p.issueTime }],
      InvoiceTypeCode: [{ _: p.typeCode, listVersionID: "1.0" }],
      DocumentCurrencyCode: [{ _: "MYR" }],
      ...(p.billingReference
        ? { BillingReference: [{ InvoiceDocumentReference: [{ ID: [{ _: p.billingReference.number }], UUID: [{ _: p.billingReference.uuid }] }] }] }
        : {}),
      AccountingSupplierParty: [{
        Party: [{
          IndustryClassificationCode: [{ _: sup.msic, name: sup.msicDesc }],
          PartyIdentification: [
            { ID: [{ _: sup.tin, schemeID: "TIN" }] },
            { ID: [{ _: sup.brn, schemeID: "BRN" }] },
            { ID: [{ _: sup.sst, schemeID: "SST" }] },
          ],
          PartyName: [{ Name: [{ _: sup.name }] }],
          PostalAddress: [{
            CityName: [{ _: sup.city }],
            PostalZone: [{ _: sup.postcode }],
            CountrySubentityCode: [{ _: sup.stateCode }],
            AddressLine: [{ Line: [{ _: sup.address }] }],
            Country: [{ IdentificationCode: [{ _: "MYS", listID: "ISO3166-1", listAgencyID: "6" }] }],
          }],
          PartyLegalEntity: [{ RegistrationName: [{ _: sup.name }] }],
          Contact: [{ Telephone: [{ _: sup.phone }] }],
        }],
      }],
      AccountingCustomerParty: [{
        Party: [{
          PartyIdentification: [
            // EI00000000010 = LHDN general-public TIN (only valid when buyer has no TIN).
            { ID: [{ _: cus.tin || "EI00000000010", schemeID: "TIN" }] },
            // A second ID (BRN/NRIC/passport) is mandatory; "NA" is accepted for general public.
            { ID: [{ _: "NA", schemeID: "BRN" }] },
          ],
          PartyName: [{ Name: [{ _: cus.name || "General Public" }] }],
          PostalAddress: [{
            CityName: [{ _: "NA" }],
            CountrySubentityCode: [{ _: "17" }], // 17 = Not Applicable
            AddressLine: [{ Line: [{ _: "NA" }] }],
            Country: [{ IdentificationCode: [{ _: "MYS", listID: "ISO3166-1", listAgencyID: "6" }] }],
          }],
          PartyLegalEntity: [{ RegistrationName: [{ _: cus.name || "General Public" }] }],
          Contact: [{ Telephone: [{ _: cus.phone && cus.phone !== "N/A" ? cus.phone : "NA" }] }],
        }],
      }],
      TaxTotal: [{ TaxAmount: cur(tax), TaxSubtotal: [...buckets.values()].map(subtotal) }],
      // Discounts are applied on each line, so document totals add up exactly.
      LegalMonetaryTotal: [{
        LineExtensionAmount: cur(net),
        TaxExclusiveAmount: cur(net),
        TaxInclusiveAmount: cur(total),
        PayableAmount: cur(total),
      }],
      InvoiceLine: lines,
    }],
  };
}

/** Read the payable total back out of a built document (for safety checks). */
export function payableOf(doc: ReturnType<typeof buildUblDocument>) {
  return doc.Invoice[0].LegalMonetaryTotal[0].PayableAmount[0]._;
}

// 022 = "Others" (was 001 = breastfeeding equipment), 004 = Consolidated e-Invoice.
const CLASS_OTHERS = "022";
const CLASS_CONSOLIDATED = "004";

/** Normal e-Invoice for one work order. */
export function buildInvoiceJson(params: {
  invoiceNumber: string;
  issueDate: string;
  issueTime: string;
  supplier: Supplier;
  customer: { name: string; tin?: string | null; phone?: string | null };
  lines: { description: string; quantity: number; unitPrice: number; total: number; type: string }[];
  discount: number;
  taxRate: number;  // SST % fixed on the invoice (0 = not SST-registered)
  taxScope: string; // "ALL" | "LABOR"
}) {
  // Same calculation as the printed invoice, so totals match to the sen.
  const t = computeTotals(params.lines, params.discount, params.taxRate, params.taxScope);
  return buildUblDocument({
    typeCode: "01",
    number: params.invoiceNumber,
    issueDate: params.issueDate,
    issueTime: params.issueTime,
    supplier: params.supplier,
    customer: params.customer,
    lines: params.lines.map((l, i) => {
      const c = t.lines[i];
      return {
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        gross: l.total,
        discount: c.discountShare,
        parts: [{ base: c.net, tax: c.tax, rate: c.taxable ? t.taxRate : 0 }],
        classification: CLASS_OTHERS,
      };
    }),
  });
}

/** Credit note e-Invoice (type 02) referring to the original invoice / consolidated e-Invoice. */
export function buildCreditNoteJson(p: {
  number: string;
  issueDate: string;
  issueTime: string;
  supplier: Supplier;
  customer: { name: string; tin?: string | null; phone?: string | null };
  originalInvoiceNumber: string;
  reference: { number: string; uuid: string };
  reason: string;
  amount: number;    // incl. SST
  taxAmount: number;
  taxRate: number;
}) {
  const net = money(p.amount - p.taxAmount);
  return buildUblDocument({
    typeCode: "02",
    number: p.number,
    issueDate: p.issueDate,
    issueTime: p.issueTime,
    supplier: p.supplier,
    customer: p.customer,
    billingReference: p.reference,
    lines: [{
      description: `Credit for invoice ${p.originalInvoiceNumber}: ${p.reason}`,
      quantity: 1,
      unitPrice: net,
      gross: net,
      discount: 0,
      parts: splitByTax(net, p.taxAmount, p.taxRate),
      classification: CLASS_OTHERS,
    }],
  });
}

/**
 * Monthly consolidated e-Invoice: one line per invoice that was not e-Invoiced
 * individually (buyer did not ask for one). Buyer = General Public.
 */
export function buildConsolidatedJson(p: {
  number: string;
  issueDate: string;
  issueTime: string;
  supplier: Supplier;
  lines: { invoiceNumber: string; net: number; tax: number; rate: number }[];
}) {
  return buildUblDocument({
    typeCode: "01",
    number: p.number,
    issueDate: p.issueDate,
    issueTime: p.issueTime,
    supplier: p.supplier,
    customer: GENERAL_PUBLIC,
    lines: p.lines.map((l) => ({
      description: `Invoice ${l.invoiceNumber}`,
      quantity: 1,
      unitPrice: money(l.net),
      gross: money(l.net),
      discount: 0,
      parts: splitByTax(l.net, l.tax, l.rate),
      classification: CLASS_CONSOLIDATED,
    })),
  });
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
  | { ok: false; status: number; detail: unknown };

export async function submitDocument(doc: ReturnType<typeof buildUblDocument>, codeNumber: string): Promise<SubmitResult> {
  const { base } = await getMyInvoisConfig();
  const token = await getAccessToken();
  const { hash, b64 } = documentHashAndBase64(doc);
  const res = await fetch(`${base}/api/v1.0/documentsubmissions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ documents: [{ format: "JSON", document: b64, documentHash: hash, codeNumber }] }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, status: res.status, detail: data };
  const accepted = data.acceptedDocuments?.[0];
  if (!accepted?.uuid) {
    return { ok: false, status: 400, detail: data.rejectedDocuments?.[0] || data };
  }
  return { ok: true, submissionUID: data.submissionUID, uuid: accepted.uuid, raw: data };
}

export async function getSubmissionStatus(submissionUID: string) {
  const { base } = await getMyInvoisConfig();
  const token = await getAccessToken();
  const res = await fetch(`${base}/api/v1.0/documentsubmissions/${encodeURIComponent(submissionUID)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false as const, status: res.status, detail: data };
  const doc = data.documentSummary?.[0] || data.documents?.[0];
  return {
    ok: true as const,
    uuid: (doc?.uuid as string) || null,
    longId: (doc?.longId as string) || null,
    status: String(doc?.status || data.overallStatus || "pending").toLowerCase(),
    raw: data,
  };
}

/** Malaysia-time issue date/time in the format LHDN expects (sent as UTC). */
export function issueStamp() {
  const now = new Date();
  return { issueDate: now.toISOString().slice(0, 10), issueTime: now.toISOString().slice(11, 19) + "Z" };
}
