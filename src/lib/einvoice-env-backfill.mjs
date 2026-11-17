// One-time SQL that fills eInvoiceEnv when a v0.3.28 (or older) database is upgraded
// (schema-upgrade.ts runs it in the same transaction as the ADD COLUMN). Pure: builds SQL text
// only, so tests can run it against a scratch SQLite database.
// 【中文】旧数据库升级时一次性补填 eInvoiceEnv 的 SQL（只生成 SQL 文本，测试可以直接在临时 SQLite 上执行）。

/**
 * Audit rows of `auditAction` for this record whose submission produced the UUID it holds NOW.
 * Up to v0.3.28 Save Manually could replace a sandbox-submitted UUID with a real portal UUID,
 * so an older submit audit row for another UUID says nothing about the current one.
 * @param {string} table
 * @param {string} auditAction
 * @param {string} [extra]
 */
function submitAuditFor(table, auditAction, extra = "") {
  return `SELECT 1 FROM "AuditLog" a WHERE a."entityId" = "${table}"."id" AND a."action" = '${auditAction}'${extra}
      AND a."details" LIKE '%"uuid":"' || "${table}"."eInvoiceUuid" || '"%'`;
}

/**
 * Hand-typed reference (Save Manually) on this record. Only ever written for WorkOrder.
 * @param {string} table
 */
function referenceAuditFor(table) {
  return `SELECT 1 FROM "AuditLog" a WHERE a."entityId" = "${table}"."id" AND a."action" = 'EINVOICE_REFERENCE_UPDATED'`;
}

/**
 * Fill eInvoiceEnv for records that already have an LHDN UUID:
 * 1. a submit audit row for the UUID the record holds now says which environment;
 * 2. else a hand-typed reference (EINVOICE_REFERENCE_UPDATED) is a real portal e-Invoice, even
 *    if an older sandbox submission id is still on the record;
 * 3. else a submission id means this app's API submission, sandbox-only since v0.3.12;
 * 4. else the UUID was typed in from the MyInvois portal: a real e-Invoice.
 * @param {string} table
 * @param {string} auditAction
 */
// 【中文】只认“提交审计里的 UUID = 现在记录上的 UUID”；先沙盒测试、后手动填入真实 UUID 的发票算正式（production）。
export function backfillEnvSql(table, auditAction) {
  return `UPDATE "${table}" SET "eInvoiceEnv" = CASE
    WHEN EXISTS (${submitAuditFor(table, auditAction, ` AND a."details" LIKE '%"environment":"production"%'`)}) THEN 'production'
    WHEN EXISTS (${submitAuditFor(table, auditAction, ` AND a."details" LIKE '%"environment":"sandbox"%'`)}) THEN 'sandbox'
    WHEN EXISTS (${referenceAuditFor(table)}) THEN 'production'
    WHEN "submissionUid" IS NOT NULL THEN 'sandbox'
    ELSE 'production' END
  WHERE "eInvoiceUuid" IS NOT NULL AND "eInvoiceEnv" IS NULL`;
}

/**
 * Up to v0.3.28 Save Manually replaced the UUID but kept the old sandbox submission id. For a
 * record the hand-typed reference rule resolved to production, drop that stale id so Check
 * Status looks the real UUID up instead of the old sandbox submission. Run after backfillEnvSql.
 * @param {string} table
 * @param {string} auditAction
 */
// 【中文】手动填入真实 UUID 后仍留着的旧沙盒提交号要清掉，否则「Check Status」会去查旧的沙盒提交。
export function clearStaleSubmissionSql(table, auditAction) {
  return `UPDATE "${table}" SET "submissionUid" = NULL
  WHERE "eInvoiceEnv" = 'production' AND "submissionUid" IS NOT NULL
    AND EXISTS (${referenceAuditFor(table)})
    AND NOT EXISTS (${submitAuditFor(table, auditAction)})`;
}
