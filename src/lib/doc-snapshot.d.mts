type Row = Record<string, unknown>;

export const DOC_SNAPSHOT_VERSION: 1;

export type SellerSnapshot = {
  name: string;
  address: string | null;
  postcode: string | null;
  city: string | null;
  stateCode: string | null;
  phone: string | null;
  email: string | null;
  tin: string | null;
  brn: string | null;
  sstNumber: string | null;
  msicCode: string | null;
  msicDesc: string | null;
  bankName: string | null;
  bankAccount: string | null;
  paymentQrUrl: string | null;
};

export type BuyerSource = "buyer_request" | "snapshot" | "customer" | "general_public";

/** Buyer as frozen in a snapshot (no NRIC / passport / e-mail). */
export type SnapshotBuyer = {
  name: string;
  phone: string | null;
  tin: string | null;
  address: string | null;
  postcode: string | null;
  city: string | null;
  stateCode: string | null;
  source: BuyerSource;
};

/** Buyer named on a document (printed and sent to LHDN). */
export type DocBuyer = SnapshotBuyer & {
  idType: string | null;
  idNo: string | null;
  email: string | null;
};

export type VehicleSnapshot = {
  plateNumber: string;
  make: string;
  model: string;
  year: number | null;
  mileage: number | null;
};

export type DocSnapshot = {
  v: number;
  kind: "invoice" | "credit_note";
  takenAt: string | null;
  seller: SellerSnapshot | null;
  buyer: SnapshotBuyer | null;
  vehicle: VehicleSnapshot | null;
};

export type NewDocSnapshot = {
  v: number;
  kind: "invoice" | "credit_note";
  takenAt: string;
  seller: SellerSnapshot;
  buyer: SnapshotBuyer;
  vehicle: VehicleSnapshot;
};

type Parties = {
  shop?: object | null;
  order?: object | null;
  customer?: object | null;
  vehicle?: object | null;
  at?: Date | string;
};

type EInvoiceRec = { eInvoiceUuid?: string | null; eInvoiceStatus?: string | null; eInvoiceEnv?: string | null };
type Env = "sandbox" | "production";

/** The LHDN e-Invoice a credit note refers to. */
export type CreditNoteReference = { via: "invoice" | "consolidated"; number: string; uuid: string };

export function sellerSnapshot(shop: object | null | undefined): SellerSnapshot;
export function customerBuyer(customer: object | null | undefined): DocBuyer;
export function documentBuyer(p: {
  order?: object | null;
  snapshots?: Array<{ buyer?: Row | null } | null | undefined>;
  customer?: object | null;
}): DocBuyer;
export function vehicleSnapshot(vehicle: object | null | undefined, mileageIn?: unknown): VehicleSnapshot;
export function buildInvoiceSnapshot(p: Parties): NewDocSnapshot;
export function creditNoteSeller(p: {
  shop?: object | null;
  invoice?: { seller?: { sstNumber?: string | null } | null } | null;
  taxAmount?: number | null;
}): SellerSnapshot;
export function buildCreditNoteSnapshot(p: Parties & { taxAmount?: number | null }): NewDocSnapshot;
export function parseDocSnapshot(raw: unknown): DocSnapshot | null;
export function invoiceBuyer(p: { order?: object | null; customer?: object | null }): DocBuyer;
export function creditNoteBuyer(p: {
  creditNote?: object | null;
  order?: object | null;
  customer?: object | null;
  via?: "invoice" | "consolidated" | null;
}): DocBuyer;
export function creditNoteReference(p: {
  creditNote?: { eInvoiceStatus?: string | null } | null;
  order?: (EInvoiceRec & { invoiceNumber?: string | null; consolidatedId?: string | null }) | null;
  consolidated?: (EInvoiceRec & { number?: string | null }) | null;
  env: Env;
}): CreditNoteReference | null;
export function printedCreditNoteReference(p: {
  creditNote?: (EInvoiceRec & { eInvoiceStatus?: string | null }) | null;
  order?: (EInvoiceRec & { invoiceNumber?: string | null; consolidatedId?: string | null }) | null;
  consolidated?: (EInvoiceRec & { number?: string | null }) | null;
  settingsEnv: Env;
}): CreditNoteReference | null;
export function buyerEditLock(
  order: (EInvoiceRec & { consolidatedId?: string | null; eInvoiceSubmittingAt?: Date | string | null }) | null | undefined,
  consolidated: EInvoiceRec | null | undefined,
  /** LHDN system Settings are on; omitted = any claim or unanswered submission locks. */
  env?: Env
): "submitted" | "consolidated" | null;
export function addressText(
  a: { address?: string | null; postcode?: string | null; city?: string | null; stateCode?: string | null } | null | undefined,
  stateName: (code: string) => string | undefined
): string | null;
