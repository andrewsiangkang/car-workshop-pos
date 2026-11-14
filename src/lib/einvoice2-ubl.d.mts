import type { BuyerSource } from "./doc-snapshot.mjs";

export const LHDN_MAX_DOC_BYTES: number;
export const SAFE_DOC_BYTES: number;
export const CLASS_OTHERS: "022";
export const CLASS_CONSOLIDATED: "004";
export const DOC_TYPE: Readonly<{ INVOICE: "01"; CREDIT_NOTE: "02"; REFUND_NOTE: "04" }>;

/** LHDN document type: 01 invoice, 02 credit note, 04 refund note. */
export type DocTypeCode = "01" | "02" | "04";

export type Supplier = {
  name: string; tin: string; brn: string; sst: string; msic: string; msicDesc: string;
  phone: string; address: string; city: string; postcode: string; stateCode: string;
};

/**
 * The buyer on an e-Invoice. Only name / TIN / phone are needed for a normal walk-in; the rest
 * is filled when the customer sent their own details through the QR code (or staff typed them).
 */
export type Buyer = {
  name: string;
  tin?: string | null;
  phone?: string | null;
  idType?: string | null; // NRIC / PASSPORT / BRN / ARMY
  idNo?: string | null;
  email?: string | null;
  address?: string | null;
  postcode?: string | null;
  city?: string | null;
  stateCode?: string | null;
  /** Where the buyer came from (for the audit log; never sent to LHDN). */
  source?: BuyerSource;
};

/** One tax bucket of a line: amount it applies to, the SST charged and the rate (0 = not taxed). */
export type TaxPart = { base: number; tax: number; rate: number };

export type UblLine = {
  description: string;
  quantity: number;
  unitPrice: number;
  gross: number; // quantity × unit price, before discount
  discount: number; // discount on this line
  parts: TaxPart[]; // tax buckets; their bases add up to gross − discount
  classification: string; // LHDN item classification code
};

type Amount = Array<{ _: number; currencyID: string }>;

/** A built UBL 2.1 JSON document (only the parts read back here are typed). */
export type UblDocument = {
  _D: string;
  _A: string;
  _B: string;
  Invoice: Array<
    Record<string, unknown> & {
      LegalMonetaryTotal: Array<{ LineExtensionAmount: Amount; TaxExclusiveAmount: Amount; TaxInclusiveAmount: Amount; PayableAmount: Amount }>;
      TaxTotal: Array<{ TaxAmount: Amount }>;
      InvoiceLine: Array<Record<string, unknown> & { LineExtensionAmount: Amount; TaxTotal: Array<{ TaxAmount: Amount }> }>;
    }
  >;
};

type CreditedLine = { description: string; quantity: number; unitPrice: number; total: number; net: number; taxAmount: number };
type ConsolidatedEntry = { invoiceNumber: string; net: number; tax: number; rate: number };
type ConsolidatedParams = {
  number: string;
  issueDate: string;
  issueTime: string;
  supplier: Supplier;
  lines: ConsolidatedEntry[];
  layout?: "per_invoice" | "ranges";
  sequence?: string[];
  covered?: string[];
};

export function splitByTax(net: number, tax: number, rate: number): TaxPart[];
export function buyerPhoneProblem(b: Buyer): string | null;
export function buyerProblem(b: Buyer): string | null;
export function buildUblDocument(p: {
  typeCode: DocTypeCode;
  number: string;
  issueDate: string;
  issueTime: string;
  supplier: Supplier;
  customer: Buyer;
  lines: UblLine[];
  billingReference?: { number: string; uuid: string };
}): UblDocument;
export function payableOf(doc: UblDocument): number;
export function documentTotals(doc: UblDocument): {
  net: number;
  tax: number;
  payable: number;
  lineNet: number;
  lineTax: number;
  lineCount: number;
};
export function docBytes(doc: unknown): number;
export function buildInvoiceJson(params: {
  invoiceNumber: string;
  issueDate: string;
  issueTime: string;
  supplier: Supplier;
  customer: Buyer;
  lines: { description: string; quantity: number; unitPrice: number; total: number; type: string }[];
  discount: number;
  taxRate: number;
  taxScope: string;
  /** SST stored on the invoice when it was issued (invoices from v0.3.29 or earlier may use the older rounding). */
  issuedTax?: number | null;
}): UblDocument;
export function creditNoteItemLines(p: { amount: number; taxAmount: number; taxRate: number; lines?: CreditedLine[] }): UblLine[] | null;
export function buildCreditNoteJson(p: {
  typeCode?: "02" | "04";
  number: string;
  issueDate: string;
  issueTime: string;
  supplier: Supplier;
  customer: Buyer;
  originalInvoiceNumber: string;
  reference: { number: string; uuid: string };
  reason: string;
  amount: number;
  taxAmount: number;
  taxRate: number;
  lines?: CreditedLine[];
}): UblDocument;
export function consolidatedRanges(
  lines: ConsolidatedEntry[],
  sequence?: string[],
  covered?: string[]
): Array<{ first: string; last: string; count: number; rate: number; net: number; tax: number; parts: TaxPart[] }>;
export function buildConsolidatedJson(p: ConsolidatedParams): UblDocument;
export function planConsolidatedDocument(
  p: ConsolidatedParams
):
  | { ok: true; doc: UblDocument; layout: "per_invoice" | "ranges"; bytes: number }
  | { ok: false; layout: "ranges"; bytes: number; error: string };
