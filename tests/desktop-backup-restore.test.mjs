import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { checkInternalToken } from "../src/lib/internal-auth.mjs";

// Behavioural tests of electron/backup.js with a stand-in for Electron and for the
// embedded server's /api/internal/backup route (VACUUM INTO is emulated by a file copy).
const require = createRequire(import.meta.url);
const SECRET = "test-secret-0123456789abcdef0123456789";

// ---- fake Electron ----
const handlers = new Map();
const calls = { relaunch: 0, exit: 0, dialogs: [] };
let dialogResponse = 0;
let pickPath = null;
let serverUp = true; // the embedded server is running (stopServer → false, relaunch → true)
const fakeElectron = {
  ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
  dialog: {
    showMessageBox: async (_w, opts) => { calls.dialogs.push(opts); return { response: dialogResponse }; },
    showOpenDialog: async () => ({ canceled: !pickPath, filePaths: pickPath ? [pickPath] : [] }),
  },
  shell: { openPath: async () => "" },
  app: { relaunch: () => { calls.relaunch++; serverUp = true; }, exit: () => calls.exit++, isQuitting: false },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(s, "utf8").reverse(),
    decryptString: (b) => Buffer.from(b).reverse().toString("utf8"),
  },
};
const electronPath = require.resolve("electron");
require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: fakeElectron };
const backup = require("../electron/backup.js");
const bc = require("../electron/backup-crypto.js");

// ---- fake embedded server ----
// snapshotStatus: answer for the snapshot call (200 = make it; 401 = middleware without a login; 500 = error)
const srv = { snapshotStatus: 200, failVerify: false, audits: [], badTokens: 0, snapshots: 0 };
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const send = (status, obj) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (!checkInternalToken(req.headers["x-workshop-internal"], SECRET)) { srv.badTokens++; return send(403, { error: "forbidden" }); }
    const b = JSON.parse(body);
    if (b.action === "snapshot") {
      if (srv.snapshotStatus === 401) return send(401, { error: "Unauthorized" });
      if (srv.snapshotStatus !== 200) return send(500, { error: "disk full" });
      srv.snapshots++;
      fs.copyFileSync(dbPath, b.dest);
      return send(200, { ok: true });
    }
    if (b.action === "verify") {
      const head = fs.readFileSync(b.file).subarray(0, 16).toString("binary");
      if (srv.failVerify || head !== "SQLite format 3\0") return send(422, { ok: false, error: "integrity_check: corrupt" });
      return send(200, { ok: true, workOrders: 3, lastWorkOrderAt: null });
    }
    if (b.action === "whoami") return send(200, { ok: true, user: { id: "u1", name: "Boss", role: "OWNER" } });
    if (b.action === "audit") { srv.audits.push(b.auditAction); return send(200, { ok: true }); }
    send(400, { error: "unknown" });
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-backup-"));
const dbPath = path.join(dataDir, "workshop.db");
const extraDir = path.join(dataDir, "..", path.basename(dataDir) + "-usb");
const autoDir = path.join(dataDir, "backups", "auto");
let serverStops = 0;
// A file with a full 100-byte SQLite header (the checked copy reads the change counter in it).
const db = (text) => Buffer.concat([Buffer.from("SQLite format 3\0", "binary"), Buffer.from(text.padEnd(100, "."))]);
fs.writeFileSync(dbPath, db("LIVE-1"));

backup.init({
  dataDir,
  dbPath,
  getWin: () => null,
  isAllowedSender: () => true,
  getPort: () => (serverUp ? port : 0),
  getAuthSecret: () => SECRET,
  getSessionCookie: async () => "cookie",
  stopServer: async () => { serverStops++; serverUp = false; },
  log: () => {},
  copyRetry: { attempts: 2, waitMs: 5 },
});
const ev = { senderFrame: { url: "http://127.0.0.1/" } };
const call = (name, ...args) => handlers.get(name)(ev, ...args);
const count = () => ({ stops: serverStops, relaunch: calls.relaunch, exit: calls.exit, dialogs: calls.dialogs.length });

test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(extraDir, { recursive: true, force: true });
});

test("a manual backup is a server snapshot with the live data", async () => {
  const r = await call("backup:run-now");
  assert.equal(r.result.ok, true, JSON.stringify(r.result));
  assert.equal(r.result.method, "snapshot");
  assert.deepEqual(fs.readFileSync(path.join(autoDir, r.result.file)), db("LIVE-1"));
  assert.equal(srv.badTokens, 0, "the desktop token is accepted by the server check");
});

test("the extra folder gets nothing without a backup password, an encrypted copy with one", async () => {
  fs.writeFileSync(path.join(dataDir, "backup-config.json"), JSON.stringify({ extraDir }));
  let r = await call("backup:run-now");
  assert.equal(r.status.extraOk, false);
  assert.equal(r.status.extraError, "NO_PASSWORD");
  assert.ok(!fs.existsSync(extraDir) || fs.readdirSync(extraDir).length === 0);

  r = await call("backup:set-password", "short");
  assert.equal(r.error, "TOO_SHORT");
  r = await call("backup:set-password", "shop backup pw 2026");
  assert.equal(r.ok, true);
  assert.equal(r.hasPassword, true);
  assert.ok(srv.audits.includes("BACKUP_PASSWORD_SET"));
  const enc = fs.readdirSync(extraDir).filter((f) => f.endsWith(".db.enc"));
  assert.equal(enc.length, 1);
  assert.equal(fs.readdirSync(extraDir).filter((f) => f.endsWith(".db")).length, 0, "no plain copy");
  const out = path.join(dataDir, "check.db");
  await bc.decryptFile(path.join(extraDir, enc[0]), out, "shop backup pw 2026");
  assert.deepEqual(fs.readFileSync(out), db("LIVE-1"));
  fs.rmSync(out);
  // the password itself is not stored anywhere in the data folder
  for (const f of fs.readdirSync(dataDir)) {
    const p = path.join(dataDir, f);
    if (fs.statSync(p).isFile()) assert.ok(!fs.readFileSync(p).includes("shop backup pw 2026"), f);
  }
});

test("logged out (snapshot call answered 401): the backup is a checked copy, never a blind one", async () => {
  srv.snapshotStatus = 401;
  try {
    const r = await call("backup:run-now");
    assert.equal(r.result.ok, true, JSON.stringify(r.result));
    assert.equal(r.result.method, "copy");
    assert.match(r.status.lastMethodNote, /checked copy.*401/);
    assert.deepEqual(fs.readFileSync(path.join(autoDir, r.result.file)), db("LIVE-1"));
  } finally {
    srv.snapshotStatus = 200;
  }
});

test("logged out while a write is in progress (journal): no backup is saved and the error says so", async () => {
  const before = fs.readdirSync(autoDir).sort();
  srv.snapshotStatus = 401;
  fs.writeFileSync(dbPath + "-journal", "pages saved by a write in progress");
  try {
    const r = await call("backup:run-now");
    assert.equal(r.result.ok, false);
    assert.equal(r.status.lastOk, false);
    assert.match(r.status.lastError, /was being changed during the backup/);
    assert.deepEqual(fs.readdirSync(autoDir).sort(), before, "no backup file and no .partial left behind");
  } finally {
    srv.snapshotStatus = 200;
    fs.rmSync(dbPath + "-journal", { force: true });
  }
});

test("a server error on the snapshot fails the backup (no fallback copy while the server runs)", async () => {
  const before = fs.readdirSync(autoDir).sort();
  srv.snapshotStatus = 500;
  try {
    const r = await call("backup:run-now");
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /snapshot failed/);
    assert.deepEqual(fs.readdirSync(autoDir).sort(), before);
  } finally {
    srv.snapshotStatus = 200;
  }
});

test("restore is aborted when the safety copy fails: live database untouched, failure recorded, app restarted", async () => {
  const name = fs.readdirSync(autoDir).find((f) => f.endsWith(".db"));
  fs.writeFileSync(dbPath, db("LIVE-2"));
  // A write that was cut off when the server stopped leaves a non-empty journal: the database
  // file alone is not consistent, so no safety copy can be made from it.
  fs.writeFileSync(dbPath + "-journal", "hot journal");
  const c = count();
  dialogResponse = 0;
  let r;
  try {
    r = await call("backup:restore", name);
  } finally {
    fs.rmSync(dbPath + "-journal", { force: true });
  }
  assert.equal(r.ok, false);
  assert.equal(r.error, "SAFETY_COPY_FAILED");
  assert.deepEqual(fs.readFileSync(dbPath), db("LIVE-2"));
  assert.equal(serverStops, c.stops + 1, "the server is stopped before the safety copy");
  assert.equal(calls.relaunch, c.relaunch + 1, "once stopped, the app always starts again");
  assert.equal(calls.exit, c.exit + 1);
  assert.equal(calls.dialogs.at(-1).type, "error", "the boss is told before the restart");
  assert.ok(!fs.existsSync(dbPath + ".restoring"));
  assert.ok(!fs.existsSync(path.join(dataDir, "restore-pending.json")));
  const marker = JSON.parse(fs.readFileSync(path.join(dataDir, "restore-audit.json"), "utf8"));
  assert.equal(marker.status, "failed");
  assert.equal(marker.safetyCopy, null);
  fs.rmSync(path.join(dataDir, "restore-audit.json"));
});

test("restore is refused when the server's check of the file fails", async () => {
  const name = fs.readdirSync(autoDir).find((f) => f.endsWith(".db"));
  const c = count();
  srv.failVerify = true;
  const r = await call("backup:restore", name);
  srv.failVerify = false;
  assert.equal(r.error, "VERIFY_FAILED");
  assert.deepEqual(fs.readFileSync(dbPath), db("LIVE-2"));
  assert.deepEqual(count(), c, "nothing stopped, nothing restarted");
});

test("cancelling the confirmation changes nothing", async () => {
  const name = fs.readdirSync(autoDir).find((f) => f.endsWith(".db"));
  const c = count();
  dialogResponse = 1;
  const r = await call("backup:restore", name);
  dialogResponse = 0;
  assert.equal(r.error, "cancelled");
  assert.deepEqual(fs.readFileSync(dbPath), db("LIVE-2"));
  assert.equal(serverStops, c.stops);
  assert.equal(calls.exit, c.exit);
});

test("a successful restore: server stopped, safety copy, leftover journal set aside, file swapped, app restarted", async () => {
  const name = fs.readdirSync(autoDir).find((f) => f.endsWith(".db") && !f.includes("pre-restore"));
  const snapshotsBefore = srv.snapshots;
  // An empty journal left behind (no saved pages): harmless for the copy, but must not stay
  // next to the restored file.
  fs.writeFileSync(dbPath + "-journal", "");
  const c = count();
  const r = await call("backup:restore", name);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(fs.readFileSync(dbPath), db("LIVE-1"));
  assert.ok(!fs.existsSync(dbPath + "-journal"), "the old database's journal must not be applied to the restored file");
  const safety = fs.readdirSync(autoDir).filter((f) => f.includes("-pre-restore"));
  assert.equal(safety.length, 1);
  assert.deepEqual(fs.readFileSync(path.join(autoDir, safety[0])), db("LIVE-2"));
  assert.equal(srv.snapshots, snapshotsBefore, "the safety copy is made after the server stopped, not by it");
  const status = JSON.parse(fs.readFileSync(path.join(dataDir, "backup-status.json"), "utf8"));
  assert.equal(status.lastMethod, "copy");
  assert.equal(status.lastMethodNote, "server stopped");
  assert.equal(serverStops, c.stops + 1);
  assert.equal(calls.relaunch, c.relaunch + 1);
  assert.equal(calls.exit, c.exit + 1);
  assert.ok(srv.audits.includes("BACKUP_RESTORE_STARTED"));
  const marker = JSON.parse(fs.readFileSync(path.join(dataDir, "restore-audit.json"), "utf8"));
  assert.equal(marker.status, "restored");
  assert.equal(marker.source, name);
  assert.equal(marker.safetyCopy, safety[0]);
  assert.equal(marker.actor.name, "Boss");
  assert.equal(backup.readPendingRestore(dataDir).safetyCopyPath, path.join(autoDir, safety[0]));
});

test("if the server cannot open the restored file, the safety copy is put back", async () => {
  const pending = backup.readPendingRestore(dataDir);
  await backup.rollbackRestore(dataDir, dbPath, pending);
  assert.deepEqual(fs.readFileSync(dbPath), db("LIVE-2"));
  assert.equal(backup.readPendingRestore(dataDir), null);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, "restore-audit.json"), "utf8")).status, "rolled-back");
});

test("restore from an encrypted .db.enc file asks for the password and refuses a wrong one", async () => {
  const enc = path.join(extraDir, fs.readdirSync(extraDir).find((f) => f.endsWith(".db.enc")));
  pickPath = enc;
  const picked = await call("backup:pick-restore-file");
  assert.equal(picked.ok, true);
  assert.equal(picked.encrypted, true);
  let r = await call("backup:restore-file", { id: picked.id, password: "" });
  assert.equal(r.error, "PASSWORD_REQUIRED");
  r = await call("backup:restore-file", { id: picked.id, password: "not the password" });
  assert.equal(r.error, "WRONG_PASSWORD");
  assert.deepEqual(fs.readFileSync(dbPath), db("LIVE-2"));
  r = await call("backup:restore-file", { id: picked.id, password: "shop backup pw 2026" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(fs.readFileSync(dbPath), db("LIVE-1"));
});

test("the live database and non-backup files cannot be chosen for a restore", async () => {
  pickPath = dbPath;
  assert.equal((await call("backup:pick-restore-file")).error, "LIVE_DB");
  const junk = path.join(dataDir, "notes.txt");
  fs.writeFileSync(junk, "hello");
  pickPath = junk;
  assert.equal((await call("backup:pick-restore-file")).error, "NOT_A_BACKUP");
  pickPath = null;
  assert.equal((await call("backup:restore-file", { id: crypto.randomBytes(16).toString("hex") })).error, "invalid file");
});

test("when the server is not running, the backup falls back to a file copy and says so", async () => {
  serverUp = false;
  try {
    const r = await call("backup:run-now");
    assert.equal(r.result.ok, true, JSON.stringify(r.result));
    assert.equal(r.result.method, "copy");
    assert.equal(r.status.lastMethod, "copy");
    assert.equal(r.status.lastMethodNote, "server stopped");
  } finally {
    serverUp = true;
  }
});

test("old unencrypted copies are deleted only when an encrypted copy really is in the current folder", async () => {
  const statusFile = path.join(dataDir, "backup-status.json");
  const usb2 = path.join(dataDir, "..", path.basename(dataDir) + "-usb2");
  fs.mkdirSync(usb2, { recursive: true });
  try {
    const plain = ["workshop-auto-20261101-090000.db", "workshop-auto-20261110-090000.db"];
    for (const n of plain) fs.writeFileSync(path.join(usb2, n), "old plain copy");
    // Folder changed to a stick holding only plain copies; status still says extraOk (stale)
    fs.writeFileSync(path.join(dataDir, "backup-config.json"), JSON.stringify({ extraDir: usb2 }));
    const st = JSON.parse(fs.readFileSync(statusFile, "utf8"));
    fs.writeFileSync(statusFile, JSON.stringify({ ...st, extraOk: true }));
    const before = calls.dialogs.length;
    let r = await call("backup:delete-plain-extra");
    assert.equal(r.error, "NO_ENCRYPTED_COPY");
    assert.equal(calls.dialogs.length, before, "no delete confirmation offered");
    assert.deepEqual(fs.readdirSync(usb2).sort(), plain);
    // v0.3.28 status (no extraLastFile at all) is refused too
    const v0328 = { ...st };
    delete v0328.extraLastFile;
    fs.writeFileSync(statusFile, JSON.stringify({ ...v0328, extraOk: true }));
    r = await call("backup:delete-plain-extra");
    assert.equal(r.error, "NO_ENCRYPTED_COPY");
    assert.deepEqual(fs.readdirSync(usb2).sort(), plain);

    // After a real encrypted copy into this folder the old plain copies can go
    r = await call("backup:run-now");
    assert.equal(r.status.extraOk, true, JSON.stringify(r.status));
    dialogResponse = 0;
    r = await call("backup:delete-plain-extra");
    assert.equal(r.error, undefined);
    const left = fs.readdirSync(usb2).filter((f) => /\.db(\.enc)?$/.test(f));
    assert.ok(left.length >= 1 && left.every((f) => f.endsWith(".db.enc")), left.join(","));
  } finally {
    fs.rmSync(usb2, { recursive: true, force: true });
  }
});

test("half-written .partial copies left by an interrupted backup are cleaned up by the next backup", async () => {
  fs.writeFileSync(path.join(dataDir, "backup-config.json"), JSON.stringify({ extraDir }));
  fs.mkdirSync(extraDir, { recursive: true });
  const stale = [
    path.join(autoDir, "workshop-auto-20261101-180000.db.partial"),
    path.join(extraDir, "workshop-auto-20261101-180000.db.enc.partial"),
  ];
  const other = path.join(extraDir, "notes.partial"); // not ours: left alone
  for (const f of [...stale, other]) fs.writeFileSync(f, "half");
  fs.writeFileSync(dbPath, db("LIVE-PARTIAL")); // changed, so a real backup runs
  const r = await call("backup:run-now");
  assert.equal(r.result.ok, true, JSON.stringify(r.result));
  for (const f of stale) assert.equal(fs.existsSync(f), false, f);
  assert.equal(fs.existsSync(other), true);
  assert.ok(fs.readdirSync(extraDir).some((f) => /^workshop-auto-[\w-]+\.db\.enc$/.test(f)), "the new encrypted copy is kept");
});
