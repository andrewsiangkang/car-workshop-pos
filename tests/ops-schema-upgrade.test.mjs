import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// Guard for src/lib/schema-upgrade.ts, the hand-kept copy of schema.prisma that upgrades old shop
// databases at start. It runs the real upgrade code (transpiled with TypeScript, on a real Prisma
// client) and compares every table, column and index with a database made from schema.prisma by
// the Prisma CLI:
// - an old database (tests/fixtures/ops-schema-base.sql) must end up exactly like a new one;
// - running the upgrade a second time changes nothing (and makes no new backup);
// - a new database made from schema.prisma needs no upgrade;
// - duplicate document numbers skip only the unique index and write upgrade-warnings.txt;
// - a failed upgrade is not cached: ensureSchema() / schemaReady() try again.
// Skipped when node_modules (Prisma CLI, generated client, TypeScript) is not installed.
// 【中文】数据库自动升级的保护测试：旧数据库升级后必须和 schema.prisma 建出的新数据库完全一致；升级两次不变；失败会重试。
const ROOT = path.join(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const PRISMA_CLI = path.join(ROOT, "node_modules", "prisma", "build", "index.js");
const GENERATED = path.join(ROOT, "node_modules", ".prisma", "client", "index.js");
const ready = fs.existsSync(PRISMA_CLI) && fs.existsSync(GENERATED) && fs.existsSync(path.join(ROOT, "node_modules", "typescript"));
const SKIP = ready ? false : "node_modules not installed (prisma CLI, prisma generate, typescript)";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ops-schema-"));
const dataDir = path.join(tmp, "data");
const clients = [];
const url = (file) => "file:" + file.replace(/\\/g, "/");

function client(file) {
  const { PrismaClient } = require("@prisma/client");
  const c = new PrismaClient({ datasourceUrl: url(file) });
  clients.push(c);
  return c;
}

/** A database made from schema.prisma by the Prisma CLI (what a new install gets). */
function pushSchema(file) {
  const r = spawnSync(process.execPath, [PRISMA_CLI, "db", "push", "--skip-generate", "--schema", path.join(ROOT, "prisma", "schema.prisma")], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: url(file), PRISMA_HIDE_UPDATE_MESSAGE: "1", CHECKPOINT_DISABLE: "1" },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, "prisma db push failed: " + r.stderr + r.stdout);
}

/** An old shop database: the frozen base layout, plus a little data. */
async function oldDatabase(file, extraSql = []) {
  fs.writeFileSync(file, "");
  const db = client(file);
  const ddl = fs.readFileSync(path.join(import.meta.dirname, "fixtures", "ops-schema-base.sql"), "utf8")
    .replace(/^--.*$/gm, "")
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const s of ddl) await db.$executeRawUnsafe(s);
  for (const s of [
    `INSERT INTO "User" ("id","name","email","passwordHash","role","updatedAt") VALUES ('u1','Boss','boss','x','OWNER',0)`,
    `INSERT INTO "Customer" ("id","name","phone","updatedAt") VALUES ('c1','Ali','0123456789',0)`,
    `INSERT INTO "Vehicle" ("id","plateNumber","make","model","customerId","updatedAt") VALUES ('v1','WXY1234','Perodua','Myvi','c1',0)`,
    `INSERT INTO "WorkOrder" ("id","orderNumber","invoiceNumber","customerId","vehicleId","createdById","updatedAt","eInvoiceUuid") VALUES ('w1','WO1','INV1','c1','v1','u1',0,'UUID-1')`,
    `INSERT INTO "WorkOrder" ("id","orderNumber","invoiceNumber","customerId","vehicleId","createdById","updatedAt") VALUES ('w2','WO2','INV2','c1','v1','u1',0)`,
    ...extraSql,
  ]) await db.$executeRawUnsafe(s);
  return db;
}

let seq = 0;
/** A fresh copy of the real upgrade module (its "done" state starts empty each time). */
async function loadUpgrade() {
  const ts = require("typescript");
  const src = fs.readFileSync(path.join(ROOT, "src", "lib", "schema-upgrade.ts"), "utf8");
  let js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const stub = path.join(tmp, "prisma-stub.mjs");
  // The app's client is replaced by whatever the test puts in globalThis.__opsPrisma.
  fs.writeFileSync(stub, `export const prisma = new Proxy({}, { get(_t, k) { const c = globalThis.__opsPrisma; const v = c[k]; return typeof v === "function" ? v.bind(c) : v; } });\n`);
  js = js
    .replace(/from\s+["']@\/lib\/prisma["']/, () => "from " + JSON.stringify(pathToFileURL(stub).href))
    .replace(/from\s+["']@\/lib\/einvoice-env-backfill\.mjs["']/, () => "from " + JSON.stringify(pathToFileURL(path.join(ROOT, "src", "lib", "einvoice-env-backfill.mjs")).href));
  assert.doesNotMatch(js, /from\s+["']@\//, "every app import of schema-upgrade.ts is replaced for the test");
  const file = path.join(tmp, `schema-upgrade-${++seq}.mjs`);
  fs.writeFileSync(file, js);
  return import(pathToFileURL(file).href);
}

/** Tables → columns and indexes, as SQLite reports them. */
async function dump(db) {
  const out = {};
  const tables = await db.$queryRawUnsafe(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%' ORDER BY name`);
  for (const { name } of tables) {
    const cols = {};
    for (const c of await db.$queryRawUnsafe(`PRAGMA table_info("${name}")`)) {
      cols[c.name] = {
        type: String(c.type).toUpperCase(),
        notnull: Number(c.notnull),
        pk: Number(c.pk),
        dflt: c.dflt_value == null ? null : String(c.dflt_value).replace(/^\((.*)\)$/, "$1"),
      };
    }
    const idx = {};
    for (const i of await db.$queryRawUnsafe(`PRAGMA index_list("${name}")`)) {
      if (String(i.name).startsWith("sqlite_autoindex")) continue;
      const info = await db.$queryRawUnsafe(`PRAGMA index_info("${i.name}")`);
      idx[i.name] = { unique: Number(i.unique), columns: info.sort((a, b) => Number(a.seqno) - Number(b.seqno)).map((x) => x.name) };
    }
    out[name] = { cols, idx };
  }
  return out;
}

/**
 * Same column? Type, NOT NULL, primary key and default must match. One harmless difference is
 * allowed: a DEFAULT in the upgrade where schema.prisma has none (e.g. LoginThrottle.updatedAt,
 * an @updatedAt field): Prisma always writes such a field itself, so the default is never used.
 * A MISSING default is not allowed: Prisma leaves literal defaults to the database.
 */
function sameColumn(w, g) {
  const dfltOk = g.dflt === w.dflt || (w.dflt === null && g.dflt !== null);
  return g.type === w.type && g.notnull === w.notnull && g.pk === w.pk && dfltOk;
}

/** Plain-language differences between what schema.prisma makes and what the upgrade made. */
function differences(want, got) {
  const diffs = [];
  for (const t of Object.keys(want)) {
    if (!got[t]) { diffs.push(`table ${t} is not created by the upgrade (add it to TABLES)`); continue; }
    for (const [c, w] of Object.entries(want[t].cols)) {
      const g = got[t].cols[c];
      if (!g) diffs.push(`column ${t}.${c} is not created by the upgrade (add it to COLUMNS)`);
      else if (!sameColumn(w, g)) diffs.push(`column ${t}.${c} differs: schema ${JSON.stringify(w)}, upgrade ${JSON.stringify(g)}`);
    }
    for (const c of Object.keys(got[t].cols)) if (!want[t].cols[c]) diffs.push(`column ${t}.${c} is created by the upgrade but not in schema.prisma`);
    for (const [i, w] of Object.entries(want[t].idx)) {
      const g = got[t].idx[i];
      if (!g) diffs.push(`index ${i} on ${t} is not created by the upgrade (add it to INDEXES / UNIQUE_INDEXES / TABLES)`);
      else if (JSON.stringify(g) !== JSON.stringify(w)) diffs.push(`index ${i} differs: schema ${JSON.stringify(w)}, upgrade ${JSON.stringify(g)}`);
    }
    for (const i of Object.keys(got[t].idx)) if (!want[t].idx[i]) diffs.push(`index ${i} on ${t} is created by the upgrade but not in schema.prisma`);
  }
  for (const t of Object.keys(got)) if (!want[t]) diffs.push(`table ${t} is created by the upgrade but not in schema.prisma`);
  return diffs;
}

const backupsMade = () => {
  try { return fs.readdirSync(path.join(dataDir, "backups", "pre-upgrade")).length; } catch { return 0; }
};

test("DDL column parser recognizes compact one-line and multiline CREATE TABLE statements", { skip: SKIP }, async () => {
  const { ddlColumns } = await loadUpgrade();
  const compact = `CREATE TABLE "PayrollEntry" ("id" TEXT NOT NULL PRIMARY KEY, "epfEmployee" REAL NOT NULL DEFAULT 0, "zakat" REAL NOT NULL DEFAULT 0, CONSTRAINT "PayrollEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id"))`;
  const multiline = `CREATE TABLE "Example" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "amount" REAL NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT false
  )`;
  assert.deepEqual([...ddlColumns(compact)].sort(), ["epfEmployee", "id", "zakat"]);
  assert.deepEqual([...ddlColumns(multiline)].sort(), ["amount", "enabled", "id"]);
});

let fresh = null; // dump of the database made from schema.prisma

test.before(async () => {
  if (SKIP) return;
  process.env.WORKSHOP_DATA_DIR = dataDir;
  const file = path.join(tmp, "fresh.db");
  pushSchema(file);
  fresh = await dump(client(file));
});

test.after(async () => {
  for (const c of clients) await c.$disconnect().catch(() => {});
  delete globalThis.__opsPrisma;
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("an old shop database is upgraded to exactly what schema.prisma describes", { skip: SKIP }, async () => {
  const db = await oldDatabase(path.join(tmp, "old.db"));
  const { runSchemaUpgrade } = await loadUpgrade();
  await runSchemaUpgrade(db);
  assert.deepEqual(differences(fresh, await dump(db)), []);
  assert.equal(backupsMade(), 1, "a backup copy is made before the upgrade changes anything");
  assert.equal(fs.existsSync(path.join(dataDir, "upgrade-error.txt")), false);
  assert.equal(fs.existsSync(path.join(dataDir, "upgrade-warnings.txt")), false);
  // The one-time data fill ran: an old UUID without a submission is a real portal e-Invoice.
  const [w1] = await db.$queryRawUnsafe(`SELECT "eInvoiceEnv" FROM "WorkOrder" WHERE "id" = 'w1'`);
  assert.equal(w1.eInvoiceEnv, "production");

  // Running it again (next start) changes nothing and makes no new backup.
  const before = await dump(db);
  const again = await loadUpgrade();
  await again.runSchemaUpgrade(db);
  assert.deepEqual(await dump(db), before);
  assert.equal(backupsMade(), 1);
});

test("a database made from schema.prisma needs no upgrade", { skip: SKIP }, async () => {
  const file = path.join(tmp, "fresh2.db");
  pushSchema(file);
  const db = client(file);
  const n = backupsMade();
  const { runSchemaUpgrade } = await loadUpgrade();
  await runSchemaUpgrade(db);
  assert.equal(backupsMade(), n, "nothing to do, so no backup copy");
  assert.deepEqual(await dump(db), fresh);
});

test("duplicate invoice numbers skip only that unique index and leave a calm warning", { skip: SKIP }, async () => {
  const db = await oldDatabase(path.join(tmp, "dup.db"), [
    `INSERT INTO "WorkOrder" ("id","orderNumber","invoiceNumber","customerId","vehicleId","createdById","updatedAt") VALUES ('w3','WO3','INV2','c1','v1','u1',0)`,
  ]);
  const { runSchemaUpgrade } = await loadUpgrade();
  await runSchemaUpgrade(db);
  const got = await dump(db);
  assert.deepEqual(differences(fresh, got), ["index WorkOrder_invoiceNumber_key on WorkOrder is not created by the upgrade (add it to INDEXES / UNIQUE_INDEXES / TABLES)"]);
  assert.equal(fs.existsSync(path.join(dataDir, "upgrade-error.txt")), false, "not reported as a failed upgrade");
  const warn = fs.readFileSync(path.join(dataDir, "upgrade-warnings.txt"), "utf8");
  assert.match(warn, /WorkOrder\.invoiceNumber has duplicate numbers \(INV2\)/);
  // Once the duplicate is sorted out, the next start adds the index and removes the warning.
  await db.$executeRawUnsafe(`UPDATE "WorkOrder" SET "invoiceNumber" = 'INV3' WHERE "id" = 'w3'`);
  await (await loadUpgrade()).runSchemaUpgrade(db);
  assert.deepEqual(differences(fresh, await dump(db)), []);
  assert.equal(fs.existsSync(path.join(dataDir, "upgrade-warnings.txt")), false);
});

test("a failed upgrade is not cached: it is reported, retried, and retried at request time at most every 10 minutes", { skip: SKIP }, async () => {
  const db = await oldDatabase(path.join(tmp, "retry.db"));
  let calls = 0;
  let broken = true;
  globalThis.__opsPrisma = new Proxy(db, {
    get(target, k) {
      const v = target[k];
      if (k === "$queryRawUnsafe") {
        return (...args) => {
          calls++;
          if (broken) return Promise.reject(new Error("database is locked"));
          return v.apply(target, args);
        };
      }
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  const m = await loadUpgrade();
  const errFile = path.join(dataDir, "upgrade-error.txt");
  await assert.rejects(m.ensureSchema(), /database is locked/);
  assert.match(fs.readFileSync(errFile, "utf8"), /database is locked/);
  assert.equal(calls, 1);

  // Request-time caller right after the failure: answers "not ready" without hammering the database.
  assert.equal(await m.schemaReady(), false);
  assert.equal(calls, 1);

  // Ten minutes later the request-time caller tries again, and it works now.
  broken = false;
  const realNow = Date.now;
  Date.now = () => realNow() + 11 * 60 * 1000;
  try {
    assert.equal(await m.schemaReady(), true);
  } finally {
    Date.now = realNow;
  }
  assert.ok(calls > 1);
  assert.equal(fs.existsSync(errFile), false, "the error file goes away once the upgrade worked");
  assert.deepEqual(differences(fresh, await dump(db)), []);
  // Done: further calls are free.
  const n = calls;
  assert.equal(await m.schemaReady(), true);
  assert.equal(calls, n);
});

test("a retried upgrade that keeps failing leaves no backup copies behind (the database was not changed)", { skip: SKIP }, async () => {
  const db = await oldDatabase(path.join(tmp, "fail.db"));
  const before = await dump(db);
  const n = backupsMade();
  globalThis.__opsPrisma = new Proxy(db, {
    get(target, k) {
      if (k === "$transaction") return () => Promise.reject(new Error("disk I/O error"));
      const v = target[k];
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  const m = await loadUpgrade();
  await assert.rejects(m.ensureSchema(), /disk I\/O error/);
  assert.equal(backupsMade(), n, "the copy made for the failed try is removed");
  const realNow = Date.now;
  try {
    for (let i = 1; i <= 5; i++) {
      const t = realNow() + i * 11 * 60 * 1000;
      Date.now = () => t;
      assert.equal(await m.schemaReady(), false);
    }
  } finally {
    Date.now = realNow;
  }
  assert.equal(backupsMade(), n, "retries do not fill the disk with copies");
  assert.deepEqual(await dump(db), before, "nothing was changed");
  assert.match(fs.readFileSync(path.join(dataDir, "upgrade-error.txt"), "utf8"), /disk I\/O error/);
  fs.rmSync(path.join(dataDir, "upgrade-error.txt"), { force: true });
});
