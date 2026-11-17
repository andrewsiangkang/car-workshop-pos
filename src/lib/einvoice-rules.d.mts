export type BuyerRequestLock = "none" | "no_invoice" | "submitted" | "consolidated" | "staff_saved" | "expired";
export type IndividualReason = "buyer_request" | "customer_tin";
type EInvoiceRec = { eInvoiceUuid?: string | null; eInvoiceStatus?: string | null; eInvoiceEnv?: string | null };
export type BuyerFieldError = "required" | "invalid" | "too_long";
export type BuyerValue = {
  name: string;
  tin: string;
  idType: string;
  idNo: string;
  email: string;
  phone: string;
  address: string;
  postcode: string;
  city: string;
  stateCode: string;
};

export function malaysiaMonth(date: Date | string | number): string;
export function monthBounds(month: string): { start: Date; end: Date; deadline: Date };
export function buyerRequestDeadline(invoicedAt: Date | string | null | undefined): Date | null;
export function buyerRequestLock(
  o: { hasInvoice: boolean; live: boolean; consolidated: boolean; staffSaved?: boolean; invoicedAt?: Date | string | null },
  now?: Date
): BuyerRequestLock;
export function reportedInConsolidation(...cons: Array<EInvoiceRec | null | undefined>): boolean;
export function hasOwnTin(tin: string | null | undefined): boolean;
export function consolidationTreatment(o: {
  reported: boolean;
  buyerRequested: boolean;
  customerTin?: string | null;
  monthEnded: boolean;
}): { line: boolean; individual: IndividualReason | null };
export function consolidationEntry(
  o: EInvoiceRec & {
    eInvoiceSubmittingAt?: Date | string | null;
    buyerRequestedAt?: Date | string | null;
    customer?: { tin?: string | null } | null;
    creditNotes?: Array<{
      number: string;
      eInvoiceStatus?: string | null;
      eInvoiceEnv?: string | null;
      eInvoiceSubmittingAt?: Date | string | null;
    }>;
  },
  env: "sandbox" | "production",
  monthEnded: boolean,
  now?: Date
): { line: boolean; individual: IndividualReason | null; blocked: null | { creditNote: string | null } };
export const BUYER_LIMITS: Readonly<{ name: number; address: number; city: number; email: number }>;
export const BUYER_ID_TYPES: readonly ["NRIC", "PASSPORT", "BRN", "ARMY"];
export function checkBuyerFields(
  raw: Record<string, unknown> | null | undefined
): { ok: true; value: BuyerValue } | { ok: false; errors: Record<string, BuyerFieldError> };
export function checkStaffBuyerContact(
  raw: Record<string, unknown> | null | undefined
):
  | { ok: true; value: { email: string; address: string; postcode: string; city: string; stateCode: string } }
  | { ok: false; errors: { address?: "incomplete" | "too_long"; email?: "invalid" } };
export function checkStaffBuyerIdentity(
  raw: Record<string, unknown> | null | undefined
):
  | { ok: true; value: { name: string; tin: string; idType: string; idNo: string } }
  | { ok: false; field: "name" | "tin" | "idType" | "idNo"; error: string };
export function creditNoteDocType(p: {
  amount: number;
  refundAmount?: number | null;
  roundingAdjustment?: number | null;
}): { ok: true; type: "02" | "04" } | { ok: false; reason: "partial_refund" };
export const BUYER_REQUEST_ALERT_DAYS: number;
export function buyerRequestWaiting(
  o: {
    buyerRequestedAt?: Date | string | null;
    invoiceNumber?: string | null;
    status?: string | null;
    reported: boolean;
    consolidated: boolean;
  },
  now?: Date,
  days?: number
): boolean;
export function waitingRequestWhere(p: {
  cutoff: Date;
  env: "sandbox" | "production";
  reportedConsolidatedIds: string[];
}): {
  buyerRequestedAt: { not: null; lt: Date };
  invoiceNumber: { not: null };
  status: { not: "CANCELLED" };
  AND: Array<{
    OR: Array<
      | { eInvoiceUuid: null }
      | { eInvoiceStatus: { in: string[] } }
      | { eInvoiceEnv: "sandbox" }
      | { consolidatedId: null }
      | { consolidatedId: { notIn: string[] } }
    >;
  }>;
};
export function checkPortalReference(raw: {
  uuid?: unknown;
  longId?: unknown;
  number?: unknown;
}): { ok: true; value: { uuid: string; longId: string | null; number: string } } | { ok: false; error: string };
export function portalConsolidatedDocument(
  raw: unknown,
  p: { status: string | null | undefined; totalAmount: number }
): boolean;
export function sameIdSet(a: unknown, b: string[]): boolean;
export function portalRecordMatches(
  sent: { orderIds?: unknown; creditNoteIds?: unknown; total?: unknown } | null | undefined,
  p: { lines: Array<{ orderId: string; creditNoteIds: string[] }>; totals: { total: number } }
): boolean;
export function consolidationLinesUnchanged(
  lines: Array<{ orderId: string; creditNoteIds: string[]; total: number; tax: number }>,
  orders: Array<{ id: string; totalAmount: number; taxAmount: number }>,
  creditNotes: Array<EInvoiceRec & { id: string; workOrderId: string; amount: number; taxAmount?: number | null }>,
  env: "sandbox" | "production"
): boolean;
export function chunkForAudit(items: string[], maxChars?: number): string[][];
