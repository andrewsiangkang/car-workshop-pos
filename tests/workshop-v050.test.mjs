import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
let DatabaseSync;
try { ({ DatabaseSync } = await import("node:sqlite")); } catch {}
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

test("v0.5.0 Prisma schema contains the professional workshop modules", () => {
  const schema = read("prisma/schema.prisma");
  for (const model of ["Appointment", "ServiceBay", "VehicleCheckIn", "CheckInPhoto", "InspectionTemplate", "InspectionTemplateItem", "VehicleInspection", "InspectionFinding", "InspectionPhoto", "CustomerApproval", "ApprovalLine", "TechnicianTimeLog", "PartReservation", "PartIssue", "QCInspection", "QCInspectionItem", "WorkOrderStageHistory", "SyncOutbox", "SyncConflict"]) {
    assert.match(schema, new RegExp(`model ${model}\\s*\\{`), `${model} model missing`);
  }
  assert.match(schema, /workflowStage\s+String\s+@default\("WAITING"\)/);
});

test("v0.5.0 additive DDL upgrades an old database without changing existing work orders", { skip: !DatabaseSync && "node:sqlite unavailable" }, () => {
  const db = new DatabaseSync(":memory:");
  db.exec(read("tests/fixtures/ops-schema-base.sql"));
  db.exec(`INSERT INTO "User" ("id","name","email","passwordHash","role","updatedAt") VALUES ('u1','Boss','boss','x','OWNER',0)`);
  db.exec(`INSERT INTO "Customer" ("id","name","phone","updatedAt") VALUES ('c1','Ali','0123',0)`);
  db.exec(`INSERT INTO "Vehicle" ("id","plateNumber","make","model","customerId","updatedAt") VALUES ('v1','WXY1234','Perodua','Myvi','c1',0)`);
  db.exec(`INSERT INTO "WorkOrder" ("id","orderNumber","customerId","vehicleId","createdById","updatedAt") VALUES ('w1','WO1','c1','v1','u1',0)`);
  db.exec(`ALTER TABLE "WorkOrder" ADD COLUMN "workflowStage" TEXT NOT NULL DEFAULT 'LEGACY'`);
  const source = read("src/lib/schema-upgrade.ts");
  const start = source.indexOf('// v0.5.0 — additive professional workshop operations schema');
  const end = source.indexOf('// v0.3.30 — numbers issued before a backup restore', start);
  assert.ok(start >= 0 && end > start, "v0.5.0 DDL block missing");
  const block = source.slice(start, end);
  const statements = [...block.matchAll(/`(CREATE (?:TABLE|INDEX) .*?)`/gs)].map((m) => m[1]);
  assert.ok(statements.length >= 40, `expected v0.5.0 DDL, got ${statements.length}`);
  for (const sql of statements) db.exec(sql);
  assert.equal(db.prepare(`SELECT "workflowStage" FROM "WorkOrder" WHERE "id"='w1'`).get().workflowStage, "LEGACY");
  for (const table of ["Appointment", "VehicleCheckIn", "VehicleInspection", "CustomerApproval", "TechnicianTimeLog", "PartReservation", "PartIssue", "QCInspection", "WorkOrderStageHistory", "SyncOutbox", "SyncConflict"]) {
    assert.ok(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table), `${table} table missing`);
  }
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM "WorkOrder"`).get().n, 1);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.close();
});

test("v0.5.0 exposes protected appointment, inspection, timer, parts and QC endpoints", () => {
  for (const p of ["src/app/api/appointments/route.ts", "src/app/api/check-ins/route.ts", "src/app/api/inspections/route.ts", "src/app/api/technician-time-logs/route.ts", "src/app/api/work-orders/[id]/parts/route.ts", "src/app/api/work-orders/[id]/qc/route.ts", "src/app/api/work-orders/[id]/stage/route.ts", "src/app/api/workshop-photos/route.ts"]) {
    const source = read(p); assert.match(source, /requireAuth\(\)/, `${p} missing auth guard`);
  }
});

test("parts are reserved separately and only issue/return creates stock movements", () => {
  const source = read("src/app/api/work-orders/[id]/parts/route.ts");
  assert.match(source, /action === "reserve"/);
  assert.match(source, /action === "issue" \|\| action === "return"/);
  assert.match(source, /stockMovement\.create/);
  assert.match(source, /idempotencyKey/);
});

test("QC pass is required before moving a work order to READY", () => {
  const source = read("src/app/api/work-orders/[id]/stage/route.ts");
  assert.match(source, /toStage === "READY"/);
  assert.match(source, /status: "PASS"/);
});


test("v0.5.0 check-in cannot attach a work order for a different vehicle or customer", () => {
  const source = read("src/app/api/check-ins/route.ts");
  assert.match(source, /workOrderId, vehicleId: vehicle\.id, customerId: vehicle\.customerId/);
  assert.match(source, /Work order must belong to the checked-in customer and vehicle/);
});

test("v0.5.0 parts issue and return are auditable and cannot inflate stock", () => {
  const source = read("src/app/api/work-orders/[id]/parts/route.ts");
  assert.match(source, /client-generated idempotency key/);
  assert.match(source, /An active reservation is required before issuing parts/);
  assert.match(source, /Return quantity exceeds issued quantity/);
  assert.match(source, /movementType === "RETURN"/);
});

test("v0.5.0 public approvals require unique decisions and atomically claim one-time links", () => {
  const source = read("src/app/api/public/approvals/[id]/route.ts");
  assert.match(source, /new Set\(decisionIds\)\.size !== row\.lines\.length/);
  assert.match(source, /approvalStatus: "PROCESSING"/);
  assert.match(source, /claimed\.count !== 1/);
});

test("v0.5.0 uploaded workshop images are checked against their actual file signatures", () => {
  const source = read("src/app/api/workshop-photos/route.ts");
  assert.match(source, /signatureMatches/);
  assert.match(source, /file content does not match its image type/);
});


test("submitted digital inspections and finalized QC records are immutable", () => {
  const inspection = read("src/app/api/inspections/[id]/route.ts");
  const qc = read("src/app/api/work-orders/[id]/qc/route.ts");
  assert.match(inspection, /Submitted inspections are read-only/);
  assert.match(qc, /Finalized QC records are read-only/);
});

test("customer approval cannot be requested for an empty work order", () => {
  const source = read("src/app/api/approvals/route.ts");
  assert.match(source, /order\.items\.length === 0/);
});


test("parts UI sends the reserved inventory item and a fresh idempotency key", () => {
  const source = read("src/components/work-orders/WorkOrderPartsPanel.tsx");
  assert.match(source, /reservation\?\.inventoryItem\.id \|\| itemId/);
  assert.match(source, /crypto\.randomUUID\(\)/);
  assert.match(source, /act\("issue", row, row\.quantity\)/);
  assert.match(source, /act\("return", row, outstanding\)/);
});


test("v0.5.3 payroll supports statutory contribution snapshots and A5 landscape payslips", () => {
  const schema = read("prisma/schema.prisma");
  const upgrade = read("src/lib/schema-upgrade.ts");
  const adjustment = read("src/app/(dashboard)/payroll/EntryAdjustment.tsx");
  const api = read("src/app/api/payroll/route.ts");
  const payslip = read("src/app/(dashboard)/payroll/PayslipActions.tsx");
  for (const field of ["epfEmployee", "socsoEmployee", "eisEmployee", "pcb", "epfEmployer", "socsoEmployer", "eisEmployer"]) {
    assert.match(schema, new RegExp(field));
    assert.match(upgrade, new RegExp(field));
    assert.match(adjustment, new RegExp(field));
    assert.match(payslip, new RegExp(field));
  }
  assert.match(api, /netPay = money/);
  assert.match(payslip, /@page\{size:A5 landscape;margin:7mm\}/);
  assert.match(payslip, /Print \/ Save as PDF/);
});
