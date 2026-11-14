export type ReminderCustomer = {
  phone?: string | null;
  reminderConsentAt?: unknown;
  reminderOptOutAt?: unknown;
  anonymisedAt?: unknown;
};
export type ReminderRefusal = "ANONYMISED" | "OPTED_OUT" | "NO_CONSENT" | "NO_PHONE";
export function reminderEligibility(c: ReminderCustomer): { ok: true } | { ok: false; reason: ReminderRefusal };
export function whatsappNumber(phone: unknown): string;
export function isPlaceholderName(name: unknown, plate?: unknown): boolean;
export function reminderLanguage(customerLanguage: unknown, shopLocale: unknown): "en" | "zh" | "ms";
export type ReminderMessageInput = {
  language: "en" | "zh" | "ms";
  name?: string | null;
  plate: string;
  make?: string | null;
  model?: string | null;
  dueDate?: string | null;
  dueKm?: number | null;
  shopName?: string | null;
};
export function reminderMessage(p: ReminderMessageInput): string;
export function reminderLink(customer: ReminderCustomer, message: ReminderMessageInput): string;
