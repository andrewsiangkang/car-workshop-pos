import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
let DatabaseSync;
try { ({ DatabaseSync } = await import("node:sqlite")); } catch {}
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

test("v0.5.1 payroll schema stores owner-defined employee rules and immutable payroll snapshots", () => {
  const schema = read("prisma/schema.prisma");
  assert.match(schema, /model PayrollCommissionRule\s*\{/);
  assert.match(schema, /model PayrollRun\s*\{/);
  assert.match(schema, /model PayrollEntry\s*\{/);
  assert.match(schema, /commissionRate\s+Float/);
  assert.match(schema, /workOrderId\s+String\?\s+@unique/);
  assert.match(schema, /employeeName\s+String/);
});

test("v0.5.1 payroll additive DDL creates the new tables without touching old records", { skip: !DatabaseSync && "node:sqlite unavailable" }, () => {
  const db = new DatabaseSync(":memory:");
  db.exec(read("tests/fixtures/ops-schema-base.sql"));
  const source = read("src/lib/schema-upgrade.ts");
  const start = source.indexOf("// v0.5.1 — boss-controlled commission payroll");
  const end = source.indexOf("// v0.5.0 — additive professional workshop operations schema", start);
  assert.ok(start >= 0 && end > start, "payroll DDL block missing");
  const block = source.slice(start, end);
  const statements = [...block.matchAll(/`(CREATE (?:TABLE|(?:UNIQUE )?INDEX) .*?)`/gs)].map((m) => m[1]);
  assert.equal(statements.length, 7);
  for (const sql of statements) db.exec(sql);
  for (const table of ["PayrollCommissionRule", "PayrollRun", "PayrollEntry"]) {
    assert.ok(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table), `${table} missing`);
  }
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.close();
});

test("payroll endpoints are owner-only and enforce configured rules, draft approval and paid status", () => {
  const api = read("src/app/api/payroll/route.ts");
  assert.match(api, /requireOwner\(\)/);
  assert.match(api, /action === "save-rule"/);
  assert.match(api, /action === "generate"/);
  assert.match(api, /action === "approve" \|\| body\.action === "mark-paid"/);
  assert.match(api, /Only a draft payroll can be approved/);
  assert.match(api, /Approve payroll before marking it paid/);
  assert.match(api, /collectionRatio/);
  assert.match(api, /lockedIds/);
});

test("payroll is exposed only to owners in the dashboard and supports allowance/deduction adjustment", () => {
  const sidebar = read("src/components/layout/Sidebar.tsx");
  assert.match(sidebar, /href: "\/payroll".*ownerOnly: true/);
  const page = read("src/app/(dashboard)/payroll/page.tsx");
  assert.match(page, /requirePageOwner\(\)/);
  const api = read("src/app/api/payroll/route.ts");
  assert.match(api, /action === "adjust-entry"/);
  assert.match(api, /Only draft payroll entries can be adjusted/);
});
