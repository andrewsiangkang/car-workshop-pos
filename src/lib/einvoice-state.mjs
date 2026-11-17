// Shared rules for the LHDN e-Invoice state kept on WorkOrder, CreditNote and
// ConsolidatedInvoice (eInvoiceUuid / eInvoiceStatus / eInvoiceEnv).
// Pure functions, no imports: used by API routes, pages and tests alike.
// 【中文】电子发票状态的共用规则（工单、贷项通知、合并发票都用）。测试环境（sandbox）的结果永远不算真的电子发票。

export const SANDBOX = "sandbox";
export const PRODUCTION = "production";

/** LHDN statuses after which a document no longer counts. */
const ENDED = new Set(["invalid", "cancelled", "rejected"]);

/**
 * True while LHDN still counts the document (submitted / pending / valid).
 * @param {string | null | undefined} status
 */
export function isLiveStatus(status) {
  return !ENDED.has(String(status || "").toLowerCase());
}

/**
 * The environment a submission goes to with the current Settings checkbox.
 * @param {boolean | null | undefined} sandbox
 * @returns {"sandbox" | "production"}
 */
export function envFromSandboxFlag(sandbox) {
  return sandbox === false ? PRODUCTION : SANDBOX;
}

/**
 * Environment stored on a record. Records saved before v0.3.29 have none and are
 * treated as production (the schema upgrade fills it in for anything with a UUID).
 * @param {{ eInvoiceEnv?: string | null } | null | undefined} rec
 * @returns {"sandbox" | "production"}
 */
export function recordEnv(rec) {
  return rec && rec.eInvoiceEnv === SANDBOX ? SANDBOX : PRODUCTION;
}

/**
 * A real e-Invoice that LHDN still counts: it has a UUID, its status has not ended,
 * and it was not made in the sandbox. Sandbox test results never count, so they never
 * take a sale out of the monthly consolidated e-Invoice.
 * @param {{ eInvoiceUuid?: string | null, eInvoiceStatus?: string | null, eInvoiceEnv?: string | null } | null | undefined} rec
 */
export function isLiveEInvoice(rec) {
  return !!rec && !!rec.eInvoiceUuid && recordEnv(rec) === PRODUCTION && isLiveStatus(rec.eInvoiceStatus);
}

/**
 * Has a still-counting submission in the given environment (stops double submission
 * in the same environment).
 * @param {{ eInvoiceUuid?: string | null, eInvoiceStatus?: string | null, eInvoiceEnv?: string | null } | null | undefined} rec
 * @param {"sandbox" | "production"} env
 */
export function isLiveIn(rec, env) {
  return !!rec && !!rec.eInvoiceUuid && recordEnv(rec) === env && isLiveStatus(rec.eInvoiceStatus);
}

/**
 * Counts as already reported for work done in `env`: a real e-Invoice always counts;
 * while testing in the sandbox, a sandbox submission counts too.
 * @param {{ eInvoiceUuid?: string | null, eInvoiceStatus?: string | null, eInvoiceEnv?: string | null } | null | undefined} rec
 * @param {"sandbox" | "production"} env
 */
export function isReportedFor(rec, env) {
  return isLiveEInvoice(rec) || (env === SANDBOX && isLiveIn(rec, SANDBOX));
}

/** LHDN statuses after which polling stops: LHDN has decided (valid) or the document has ended. */
const FINAL = new Set(["valid", ...ENDED]);

/**
 * LHDN has made up its mind about the document (valid / invalid / cancelled / rejected), so there
 * is no point asking again straight away. Shared by the invoice page and the Submit buttons.
 * @param {string | null | undefined} status
 */
// 【中文】LHDN 已有结论（有效 / 无效 / 作废 / 拒绝），不用再自动查询。
export function isFinalStatus(status) {
  return FINAL.has(String(status || "").toLowerCase());
}

/**
 * The credit note was netted into the monthly consolidated e-Invoice (it has no e-Invoice of its own).
 * @param {{ eInvoiceStatus?: string | null } | null | undefined} cn
 */
// 【中文】退款单已在每月合并电子发票里扣除（它自己没有电子发票）。
export function isNettedInConsolidation(cn) {
  return !!cn && String(cn.eInvoiceStatus || "").toLowerCase() === "consolidated";
}
