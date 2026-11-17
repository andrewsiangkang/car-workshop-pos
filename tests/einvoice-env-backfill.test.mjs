import test from "node:test";
import assert from "node:assert/strict";
import { backfillEnvSql, clearStaleSubmissionSql } from "../src/lib/einvoice-env-backfill.mjs";

// Runs the upgrade SQL against an in-memory SQLite database shaped like a v0.3.28 shop
// (node:sqlite ships with Node 22.5+; older Node skips this file).
let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {}

const SUBMIT = "MYINVOIS_INVOICE_SUBMITTED";

function upgrade(rows, audits) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE "AuditLog" ("id" TEXT, "action" TEXT, "entityId" TEXT, "details" TEXT);
    CREATE TABLE "WorkOrder" ("id" TEXT, "eInvoiceUuid" TEXT, "submissionUid" TEXT, "eInvoiceEnv" TEXT);`);
  const wo = db.prepare(`INSERT INTO "WorkOrder" VALUES (?, ?, ?, NULL)`);
  for (const r of rows) wo.run(r.id, r.uuid, r.sub ?? null);
  const au = db.prepare(`INSERT INTO "AuditLog" VALUES (?, ?, ?, ?)`);
  audits.forEach((a, i) => au.run(String(i), a.action, a.id, JSON.stringify(a.details)));
  db.exec(backfillEnvSql("WorkOrder", SUBMIT));
  db.exec(clearStaleSubmissionSql("WorkOrder", SUBMIT));
  const out = Object.fromEntries(db.prepare(`SELECT "id", "eInvoiceEnv", "submissionUid" FROM "WorkOrder"`).all().map((r) => [r.id, { env: r.eInvoiceEnv, sub: r.submissionUid }]));
  db.close();
  return out;
}

const submitted = (id, uuid, environment) => ({ action: SUBMIT, id, details: { invoiceNumber: id, uuid, environment } });
const typed = (id) => ({ action: "EINVOICE_REFERENCE_UPDATED", id, details: { hasLongId: true } });

test("upgrade backfill: only a submit audit for the UUID held now decides the environment", { skip: !DatabaseSync && "node:sqlite not available" }, () => {
  const r = upgrade(
    [
      { id: "A", uuid: "REALPORTALUUID123", sub: "SANDBOXSUB1" }, // sandbox test, then the real portal UUID typed in
      { id: "B", uuid: "SBUUIDB0001", sub: "SUBB" }, // plain sandbox submission
      { id: "C", uuid: "MANUALC0001" }, // typed in by hand only
      { id: "D", uuid: "SBUUIDD0001", sub: "SUBD" }, // sandbox, then the same sandbox UUID re-saved by hand
      { id: "E", uuid: "SBUUIDE0002", sub: "SUBE2" }, // old production audit, later sandbox resubmission
      { id: "F", uuid: "UUIDF000001", sub: "SUBF" }, // submission id, no audit rows at all
      { id: "G", uuid: "PRODG000001", sub: "SUBG" }, // production submission audited for this UUID
    ],
    [
      submitted("A", "SANDBOXUUID999", "sandbox"), typed("A"),
      submitted("B", "SBUUIDB0001", "sandbox"),
      typed("C"),
      submitted("D", "SBUUIDD0001", "sandbox"), typed("D"),
      submitted("E", "PRODE000001", "production"), submitted("E", "SBUUIDE0002", "sandbox"),
      submitted("G", "PRODG000001", "production"),
    ]
  );
  // The real portal e-Invoice is production and its stale sandbox submission id is dropped
  assert.deepEqual(r.A, { env: "production", sub: null });
  assert.deepEqual(r.B, { env: "sandbox", sub: "SUBB" });
  assert.deepEqual(r.C, { env: "production", sub: null });
  assert.deepEqual(r.D, { env: "sandbox", sub: "SUBD" });
  assert.deepEqual(r.E, { env: "sandbox", sub: "SUBE2" });
  assert.deepEqual(r.F, { env: "sandbox", sub: "SUBF" });
  assert.deepEqual(r.G, { env: "production", sub: "SUBG" });
});
