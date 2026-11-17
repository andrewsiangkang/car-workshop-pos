export function nextSequenceNumber(
  base: string,
  used: Iterable<string | null | undefined>,
  retired?: Iterable<string | null | undefined>
): string;
export const DOC_NUMBER_SOURCES: Array<{ kind: string; table: string; column: string }>;
export function numbersToRetire(
  safety: Record<string, Iterable<string | null | undefined>>,
  restored: Record<string, Iterable<string | null | undefined>>
): Array<{ kind: string; number: string }>;
export type SafetyEInvoice = { kind: string; number: string | null; uuid: string | null; env?: string | null; status?: string | null };
export function lostEInvoices<T extends SafetyEInvoice>(safetyDocs: T[], restoredUuids: Iterable<string | null | undefined>): T[];
export function countByKind(list: Array<{ kind: string }>): Record<string, number>;
/** Where a restore's safety copy is kept (path parts below data/backups), or null for any other name. */
export function safetyCopyLocation(name: unknown): { kind: "auto" | "raw"; parts: string[] } | null;
