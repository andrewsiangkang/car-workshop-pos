export type LhdnProblem = { code: string; message: string; path: string };
export type ErrorTopic =
  | "phone" | "email" | "address" | "msic" | "name" | "id" | "classification" | "date" | "totals" | "signature";
export type FriendlyErrorCore = {
  message: string;
  messageZh: string;
  hint?: string;
  raw?: string;
  topic?: ErrorTopic;
  party?: "supplier" | "buyer" | null;
};

export function lhdnProblems(detail: unknown): LhdnProblem[];
export function classifyProblem(p: LhdnProblem): { topic: ErrorTopic | null; party: "supplier" | "buyer" | null };
export function friendlyMyInvoisError(
  detail: unknown,
  opts?: { httpStatus?: number; fallback?: string; kind?: "submit" | "status" | "tin" | "generic" }
): FriendlyErrorCore;
export function formatFriendlyError(fe: { message: string; messageZh?: string; hint?: string }, bilingual?: boolean): string;
