/**
 * Turn LHDN / MyInvois API errors into short messages staff can act on.
 * Keeps a truncated raw detail for debugging.
 * The rules live in myinvois-errors-core.mjs (pure, covered by tests/einvoice-errors.test.mjs):
 * the field is read from LHDN's property path / error code, so phone, address, email and
 * shop-detail errors are no longer labelled as TIN problems.
 */
// 【中文】LHDN 错误提示：规则在 myinvois-errors-core.mjs（有测试）。按 LHDN 的栏位路径判断，电话 / 地址 / Email / 店铺资料错误不再被说成 TIN 问题。

import {
  friendlyMyInvoisError as friendlyCore,
  formatFriendlyError as formatCore,
  type FriendlyErrorCore,
} from "@/lib/myinvois-errors-core.mjs";

export type FriendlyError = FriendlyErrorCore;

/**
 * Map submit / status / tin failures to human-readable text.
 * `kind` is a coarse source so callers can add context.
 */
export function friendlyMyInvoisError(
  detail: unknown,
  opts?: { httpStatus?: number; fallback?: string; kind?: "submit" | "status" | "tin" | "generic" }
): FriendlyError {
  return friendlyCore(detail, opts);
}

/** Single line for UI toast / inline message (English primary + optional zh). */
export function formatFriendlyError(fe: FriendlyError, bilingual = true): string {
  return formatCore(fe, bilingual);
}
