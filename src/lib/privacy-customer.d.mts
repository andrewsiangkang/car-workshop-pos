export const RECORD_KEEPING_YEARS: 7;
export const MAX_RETENTION_YEARS: number;
export const ANONYMISED_NAME: "Anonymised customer";
export const NO_PHONE: "N/A";
export const REMINDER_LANGUAGES: string[];
export const CUSTOMER_LIMITS: { name: number; email: number; tin: number; address: number; city: number; notes: number };
export function yearsBefore(now: Date | number, years: number): Date;
export function parseRetentionYears(v: unknown): { ok: true; value: number | null } | { ok: false; error: string };
export function validateCustomerFields(
  input: Record<string, unknown>,
  opts: { stateCodes: string[]; all?: boolean; phoneRequired?: boolean }
): { ok: true; data: Record<string, string | null> } | { ok: false; field: string; error: string };
export function anonymisedCustomerData(now: Date): {
  name: string;
  phone: string;
  email: null;
  tin: null;
  notes: null;
  address: null;
  postcode: null;
  city: null;
  stateCode: null;
  language: null;
  reminderConsentAt: null;
  reminderOptOutAt: Date;
  anonymisedAt: Date;
};
export type OrderDates = {
  status?: string | null;
  invoiceNumber?: string | null;
  receiptNumber?: string | null;
  createdAt?: unknown;
  invoicedAt?: unknown;
  paidAt?: unknown;
  completedAt?: unknown;
  payments?: Array<{ paidAt?: unknown }>;
  creditNotes?: Array<{ createdAt?: unknown }>;
};
/** 1 January (Malaysia time) of the year 7 years before `now`, in epoch ms. */
export function recordKeepingStart(now: Date | number): number;
export function orderDocumentTimes(o: OrderDates): number[];
export function taxDocumentTimes(orders: OrderDates[]): number[];
export function recordKeepingCheck(orders: OrderDates[], now: Date | number): { count: number; latest: string | null };
export function lastActivityTime(customer: { createdAt?: unknown; workOrders?: OrderDates[] }): number;
export function isRetentionDue(
  customer: { anonymisedAt?: unknown; createdAt?: unknown; workOrders?: OrderDates[] },
  years: number,
  now: Date | number
): boolean;
export const OPEN_JOB_STATUSES: string[];
export function anonymiseRefusal(p: {
  customer: { anonymisedAt?: unknown };
  orders: OrderDates[];
  now: Date | number;
  confirmRecordKeeping?: boolean;
}): null | { code: "ALREADY" | "OPEN_JOB" | "RECORD_KEEPING"; count?: number; latest?: string | null };
