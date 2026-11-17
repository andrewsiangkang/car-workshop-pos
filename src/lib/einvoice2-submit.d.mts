export const LHDN_TIMEOUT_MS: number;
export const CLAIM_STALE_MS: number;
export const UNCONFIRMED_WAIT_MS: number;
export const UNCONFIRMED: "unconfirmed";
export const LOOKUP_BEFORE_MS: number;
export const LOOKUP_AFTER_MS: number;
export const RECENT_LOOKBACK_MS: number;

type GateRec = { eInvoiceStatus?: string | null; eInvoiceSubmittingAt?: Date | string | null } | null | undefined;

export function isUnconfirmed(rec: { eInvoiceStatus?: string | null } | null | undefined): boolean;
export function submitGate(
  rec: GateRec,
  now?: Date
): { action: "go" } | { action: "wait"; until: Date } | { action: "lookup"; since: Date | null };
export function claimWhere<E extends Record<string, unknown> = Record<string, never>>(
  rec: { id: string; eInvoiceUuid?: string | null; eInvoiceStatus?: string | null },
  now?: Date,
  extra?: E
): E & {
  id: string;
  eInvoiceUuid: string | null;
  eInvoiceStatus: string | null;
  OR: Array<{ eInvoiceSubmittingAt: null } | { eInvoiceSubmittingAt: { lt: Date } }>;
};
export function claimData(
  rec: { eInvoiceUuid?: string | null },
  now: Date,
  env: "sandbox" | "production"
): { eInvoiceSubmittingAt: Date; eInvoiceEnv?: "sandbox" | "production" };
export function submitOutcome(r: { ok: boolean; status?: number; unknown?: boolean }): "accepted" | "rejected" | "unknown";
export function unconfirmedNext(p: {
  found: boolean;
  foundLive?: boolean;
  complete?: boolean;
  since: Date | string | null | undefined;
  now?: Date;
}): "record" | "wait" | "clear" | "unsure";
export function sentLookupWindow(
  since: Date | string | null | undefined,
  now?: Date
): { from: Date; to: Date; source: "recent" | "search" };
export function inFlightFor(
  rec:
    | { eInvoiceUuid?: string | null; eInvoiceStatus?: string | null; eInvoiceEnv?: string | null; eInvoiceSubmittingAt?: Date | string | null }
    | null
    | undefined,
  env: "sandbox" | "production",
  now?: Date
): boolean;
export function notInFlightWhere(
  env: "sandbox" | "production",
  now?: Date
): {
  OR: Array<
    | { eInvoiceSubmittingAt: null }
    | { eInvoiceStatus: "unconfirmed"; eInvoiceEnv: "sandbox" }
    | { eInvoiceUuid: null; eInvoiceEnv: "sandbox"; eInvoiceSubmittingAt: { lt: Date } }
  >;
};
export function unconfirmedUntil(since: Date | string | null | undefined): Date | null;
export function pickSentDocument(
  rows: Array<Record<string, unknown>>,
  internalId: string
): { uuid: string; submissionUid: string | null; longId: string | null; status: string } | null;
