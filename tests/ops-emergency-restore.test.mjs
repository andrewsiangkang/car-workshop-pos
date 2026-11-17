import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

// Emergency restore (the server cannot start, so nobody can log in): electron/backup.js
// offlineRestore() and the integrity check helper electron/db-check.js.
// The native dialogs of electron/emergency-restore.js are replaced by `verify` / `confirm`.
const require = createRequire(import.meta.url);
const ROOT = path.join(import.meta.dirname, "..");

const fakeElectron = {
  ipcMain: { handle: () => {}, on: () => {}, removeListener: () => {} },
  dialog: { showMessageBox: async () => ({ response: 1 }), showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  shell: { openPath: async () => "" },
  app: { relaunch: () => {}, exit: () => {}, getPath: () => os.tmpdir() },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => "" },
};
const electronPath = require.resolve("electron");
require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: fakeElectron };
const backup = require("../electron/backup.js");
const bc = require("../electron/backup-crypto.js");
const { check } = require("../electron/db-check.js");

// A file with a full 100-byte SQLite header (the checked copy reads the change counter in it).
const db = (text) => Buffer.concat([Buffer.from("SQLite format 3\0", "binary"), Buffer.from(text.padEnd(100, "."))]);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ops-emergency-"));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let n = 0;
/** A data folder with a live database, and a backup folder (USB) with one backup and a photo. */
function shop(live = db("LIVE")) {
  const root = path.join(tmp, "shop-" + ++n);
  const dataDir = path.join(root, "data");
  const usb = path.join(root, "usb");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(usb, "uploads"), { recursive: true });
  fs.writeFileSync(path.join(dataDir, "workshop.db"), live);
  fs.writeFileSync(path.join(usb, "workshop-auto-20261101-090000.db"), db("BACKUP"));
  fs.writeFileSync(path.join(usb, "uploads", "abc-1.png"), "photo");
  return { dataDir, dbPath: path.join(dataDir, "workshop.db"), usb, backupFile: path.join(usb, "workshop-auto-20261101-090000.db") };
}
const goodCheck = async () => ({ ok: true, workOrders: 12, lastWorkOrderAt: "2026-11-01T01:00:00.000Z" });
const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));

test("a checked, confirmed backup replaces the database; the old data is kept as a safety copy; the audit log will record it", async () => {
  const s = shop();
  const seen = [];
  const r = await backup.offlineRestore({
    dataDir: s.dataDir,
    dbPath: s.dbPath,
    file: s.backupFile,
    encrypted: false,
    verify: async (tmpFile) => { seen.push(["verify", path.basename(tmpFile)]); return goodCheck(); },
    confirm: async (info) => { seen.push(["confirm", info.label, info.workOrders]); return true; },
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(seen, [["verify", "workshop.db.restoring"], ["confirm", "workshop-auto-20261101-090000.db", 12]]);
  assert.deepEqual(fs.readFileSync(s.dbPath), db("BACKUP"));
  const auto = path.join(s.dataDir, "backups", "auto");
  assert.match(r.safetyCopy, /^workshop-auto-\d{8}-\d{6}-pre-restore\.db$/);
  assert.deepEqual(fs.readFileSync(path.join(auto, r.safetyCopy)), db("LIVE"));
  assert.equal(r.damagedCopy, false);
  assert.equal(fs.readFileSync(path.join(s.dataDir, "uploads", "abc-1.png"), "utf8"), "photo", "missing photos are added");
  assert.ok(!fs.existsSync(s.dbPath + ".restoring"));
  // If the restored file does not start, main.js puts the safety copy back (pending marker).
  assert.equal(backup.readPendingRestore(s.dataDir).safetyCopyPath, path.join(auto, r.safetyCopy));
  const audit = readJson(path.join(s.dataDir, "restore-audit.json"));
  assert.equal(audit.status, "restored");
  assert.equal(audit.emergency, true);
  assert.equal(audit.actor.name, backup.EMERGENCY_ACTOR);
  assert.equal(audit.source, "workshop-auto-20261101-090000.db");
  assert.equal(audit.workOrders, 12);
});

test("nothing changes when the check fails or the boss cancels", async () => {
  const s = shop();
  let confirmed = 0;
  const base = { dataDir: s.dataDir, dbPath: s.dbPath, file: s.backupFile, encrypted: false };
  let r = await backup.offlineRestore({ ...base, verify: async () => ({ ok: false, error: "integrity_check: page 3 is never used" }), confirm: async () => { confirmed++; return true; } });
  assert.equal(r.error, "VERIFY_FAILED");
  assert.match(r.detail, /page 3/);
  assert.equal(confirmed, 0, "a file that failed the check is never offered");
  r = await backup.offlineRestore({ ...base, verify: goodCheck, confirm: async () => false });
  assert.equal(r.error, "cancelled");
  assert.deepEqual(fs.readFileSync(s.dbPath), db("LIVE"));
  assert.ok(!fs.existsSync(path.join(s.dataDir, "backups")), "no safety copy was needed");
  assert.ok(!fs.existsSync(path.join(s.dataDir, "restore-audit.json")));
  assert.ok(!fs.existsSync(path.join(s.dataDir, "restore-pending.json")));
  assert.ok(!fs.existsSync(s.dbPath + ".restoring"));
});

test("the live database, and files that are not backups, cannot be restored", async () => {
  const s = shop();
  const opts = { dataDir: s.dataDir, dbPath: s.dbPath, encrypted: false, verify: goodCheck, confirm: async () => true };
  assert.equal((await backup.offlineRestore({ ...opts, file: s.dbPath })).error, "LIVE_DB");
  const junk = path.join(s.usb, "notes.db");
  fs.writeFileSync(junk, "hello, not a database");
  assert.equal((await backup.offlineRestore({ ...opts, file: junk })).error, "NOT_A_BACKUP");
  assert.deepEqual(fs.readFileSync(s.dbPath), db("LIVE"));
});

test("an encrypted backup needs the right backup password", async () => {
  const s = shop();
  const key = await bc.createBackupKey("shop backup pw 2026", { logN: 10, r: 8, p: 1 });
  const enc = path.join(s.usb, "workshop-auto-20261102-090000.db.enc");
  await bc.encryptFile(s.backupFile, enc, key);
  const opts = { dataDir: s.dataDir, dbPath: s.dbPath, file: enc, encrypted: true, verify: goodCheck, confirm: async () => true };
  assert.equal((await backup.offlineRestore({ ...opts, password: "" })).error, "PASSWORD_REQUIRED");
  assert.equal((await backup.offlineRestore({ ...opts, password: "wrong password" })).error, "WRONG_PASSWORD");
  assert.deepEqual(fs.readFileSync(s.dbPath), db("LIVE"));
  const r = await backup.offlineRestore({ ...opts, password: "shop backup pw 2026" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(fs.readFileSync(s.dbPath), db("BACKUP"));
});

test("a damaged live database is kept as it is for support (never offered as a backup, no roll back to it)", async () => {
  const s = shop(Buffer.from("garbage that is not a database"));
  fs.writeFileSync(s.dbPath + "-journal", "half a write");
  const r = await backup.offlineRestore({ dataDir: s.dataDir, dbPath: s.dbPath, file: s.backupFile, encrypted: false, verify: goodCheck, confirm: async () => true });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.damagedCopy, true);
  const kept = path.join(s.dataDir, "backups", r.safetyCopy);
  assert.equal(fs.readFileSync(path.join(kept, "workshop.db"), "utf8"), "garbage that is not a database");
  assert.equal(fs.readFileSync(path.join(kept, "workshop.db-journal"), "utf8"), "half a write");
  assert.ok(!fs.existsSync(path.join(s.dataDir, "backups", "auto")) || fs.readdirSync(path.join(s.dataDir, "backups", "auto")).length === 0);
  assert.equal(backup.readPendingRestore(s.dataDir), null);
  assert.deepEqual(fs.readFileSync(s.dbPath), db("BACKUP"));
  assert.ok(!fs.existsSync(s.dbPath + "-journal"), "the old journal is never applied to the restored file");
});

test("when no safety copy can be saved, the restore stops and the database is unchanged", async () => {
  const s = shop();
  fs.writeFileSync(path.join(s.dataDir, "backups"), "a file where the backups folder should be");
  const r = await backup.offlineRestore({ dataDir: s.dataDir, dbPath: s.dbPath, file: s.backupFile, encrypted: false, verify: goodCheck, confirm: async () => true });
  assert.equal(r.ok, false);
  assert.equal(r.error, "SAFETY_COPY_FAILED");
  assert.deepEqual(fs.readFileSync(s.dbPath), db("LIVE"));
  assert.ok(!fs.existsSync(s.dbPath + ".restoring"));
  assert.ok(!fs.existsSync(path.join(s.dataDir, "restore-pending.json")));
});

// ---- db-check.js: the real integrity check, with the Prisma client the server ships ----
const hasClient = fs.existsSync(path.join(ROOT, "node_modules", ".prisma", "client", "index.js"));
const NO_CLIENT = hasClient ? false : "Prisma client not generated";

async function realDb(file, sql) {
  fs.writeFileSync(file, "");
  const { PrismaClient } = require("@prisma/client");
  const c = new PrismaClient({ datasourceUrl: "file:" + file.replace(/\\/g, "/") });
  try {
    for (const s of sql) await c.$executeRawUnsafe(s);
  } finally {
    await c.$disconnect();
  }
}

test("db-check accepts a healthy shop database and refuses damaged or foreign files", { skip: NO_CLIENT }, async () => {
  const good = path.join(tmp, "good copy.db");
  await realDb(good, [
    `CREATE TABLE "User" ("id" TEXT NOT NULL PRIMARY KEY)`,
    `CREATE TABLE "WorkOrder" ("id" TEXT NOT NULL PRIMARY KEY, "createdAt" DATETIME NOT NULL)`,
    `INSERT INTO "WorkOrder" VALUES ('w1', 1762000000000), ('w2', 1762100000000)`,
  ]);
  assert.deepEqual(await check(good, ROOT), { ok: true, workOrders: 2, lastWorkOrderAt: new Date(1762100000000).toISOString() });

  const foreign = path.join(tmp, "foreign.db");
  await realDb(foreign, [`CREATE TABLE "Notes" ("id" INTEGER PRIMARY KEY)`]);
  assert.deepEqual(await check(foreign, ROOT), { ok: false, error: "not a workshop database" });

  // Keep the first pages, then garbage: SQLite reports the file as malformed.
  const damaged = path.join(tmp, "damaged.db");
  const bytes = fs.readFileSync(good);
  fs.writeFileSync(damaged, Buffer.concat([bytes.subarray(0, 4096), Buffer.alloc(8192, 0x5a)]));
  const r = await check(damaged, ROOT);
  assert.equal(r.ok, false);

  const noEngine = await check(good, path.join(tmp, "no-server-here"));
  assert.equal(noEngine.ok, false);
  assert.match(noEngine.error, /^ENGINE_MISSING/);

  // As the desktop app runs it: a separate process that prints one JSON line.
  const p = spawnSync(process.execPath, [path.join(ROOT, "electron", "db-check.js"), good, ROOT], { encoding: "utf8" });
  assert.equal(p.status, 0);
  assert.equal(JSON.parse(p.stdout.trim().split("\n").pop()).ok, true);
  const q = spawnSync(process.execPath, [path.join(ROOT, "electron", "db-check.js"), foreign, ROOT], { encoding: "utf8" });
  assert.equal(q.status, 1);
  assert.equal(JSON.parse(q.stdout.trim().split("\n").pop()).ok, false);
});
