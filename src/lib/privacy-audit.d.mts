export const AUDIT_GENESIS: "GENESIS";
/** At most `max` characters, never half an emoji (lone surrogates become U+FFFD). */
export function clipText(v: unknown, max: number): string;
export function canonicalAuditEntry(e: Record<string, unknown>): string;
export function auditEntryHash(e: Record<string, unknown>): string;
export function nextChainLink(last: { seq: number | null; hash: string | null } | null | undefined): { seq: number; prevHash: string };

export type AuditChainProblem = {
  kind: "missing" | "duplicate" | "altered" | "broken-link";
  seq: number;
  id: string;
  expectedSeq: number;
  createdAt: string | null;
};
export type AuditChainResult = {
  ok: boolean;
  checked: number;
  last: { seq: number; id: string; createdAt: string | null } | null;
  problem: AuditChainProblem | null;
};
export function createAuditChainVerifier(): {
  push(row: Record<string, unknown>): AuditChainProblem | null;
  result(): AuditChainResult;
};
export function verifyAuditChain(rows: Array<Record<string, unknown>>): AuditChainResult;

export function maskTail(v: unknown): string | null;
export function auditFieldChanges(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown>,
  opts?: { hidden?: string[]; masked?: string[]; opaque?: string[]; ignore?: string[] }
): { changedFields: string[]; before: Record<string, unknown>; after: Record<string, unknown> };
export function flattenSettings(obj: unknown, prefix?: string): Record<string, unknown>;

export function normaliseAddress(a: unknown): string;
export function auditAddress(h: { peer?: string | null; forwardedFor?: string | null; realIp?: string | null }): {
  ipAddress: string | null;
  reported: string | null;
};

export function createWindowLimiter(limit: number, windowMs: number): {
  take(now: number): { ok: boolean; droppedBefore: number };
};
