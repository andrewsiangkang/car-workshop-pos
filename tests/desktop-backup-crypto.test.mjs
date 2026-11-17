import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const bc = require("../electron/backup-crypto.js");

// Small scrypt cost so the tests run fast; real backup keys use DEFAULT_PARAMS.
const FAST = { logN: 10, r: 8, p: 1 };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-backup-crypto-"));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

// A file that looks like a SQLite database (header + random pages).
function fakeDb(file, bytes = 300_000) {
  fs.writeFileSync(file, Buffer.concat([Buffer.from("SQLite format 3\0", "binary"), crypto.randomBytes(bytes)]));
  return file;
}

test("createBackupKey refuses passwords shorter than 8 characters and never keeps the password", async () => {
  await assert.rejects(bc.createBackupKey("short", FAST), (e) => e.code === "TOO_SHORT");
  const k = await bc.createBackupKey("correct horse battery", FAST);
  assert.equal(k.v, 1);
  assert.match(k.key, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(k).includes("correct horse"));
});

test("encrypt → decrypt with the password gives the identical file", async () => {
  const src = fakeDb(path.join(dir, "a.db"));
  const enc = path.join(dir, "a.db.enc");
  const out = path.join(dir, "a.out.db");
  const key = await bc.createBackupKey("correct horse battery", FAST);
  await bc.encryptFile(src, enc, key);
  assert.ok(fs.existsSync(enc) && !fs.existsSync(enc + ".partial"));
  assert.equal(bc.isEncryptedBackupFile(enc), true);
  assert.equal(bc.isSqliteFile(enc), false, "the encrypted copy must not be readable as SQLite");
  assert.equal(fs.readFileSync(enc).includes(fs.readFileSync(src).subarray(16, 64)), false);
  await bc.decryptFile(enc, out, "correct horse battery");
  assert.deepEqual(fs.readFileSync(out), fs.readFileSync(src));
  assert.equal(bc.isSqliteFile(out), true);
});

test("a wrong password is reported as WRONG_PASSWORD and leaves no output file", async () => {
  const src = fakeDb(path.join(dir, "b.db"));
  const enc = path.join(dir, "b.db.enc");
  const out = path.join(dir, "b.out.db");
  await bc.encryptFile(src, enc, await bc.createBackupKey("the right password", FAST));
  await assert.rejects(bc.decryptFile(enc, out, "the wrong password"), (e) => e.code === "WRONG_PASSWORD");
  assert.equal(fs.existsSync(out), false);
});

test("an altered file is reported as DAMAGED and the partial output is removed", async () => {
  const src = fakeDb(path.join(dir, "c.db"));
  const enc = path.join(dir, "c.db.enc");
  const out = path.join(dir, "c.out.db");
  await bc.encryptFile(src, enc, await bc.createBackupKey("the right password", FAST));
  const buf = fs.readFileSync(enc);
  buf[buf.length - 100] ^= 0xff; // change one byte of the encrypted data
  fs.writeFileSync(enc, buf);
  await assert.rejects(bc.decryptFile(enc, out, "the right password"), (e) => e.code === "DAMAGED");
  assert.equal(fs.existsSync(out), false);
});

test("files that are not encrypted backups are refused as NOT_A_BACKUP", async () => {
  const plain = fakeDb(path.join(dir, "d.db"));
  await assert.rejects(bc.decryptFile(plain, path.join(dir, "d.out"), "whatever123"), (e) => e.code === "NOT_A_BACKUP");
  const tiny = path.join(dir, "tiny.enc");
  fs.writeFileSync(tiny, "WSPOSBK1");
  await assert.rejects(bc.decryptFile(tiny, path.join(dir, "t.out"), "whatever123"), (e) => e.code === "NOT_A_BACKUP");
  assert.equal(bc.isEncryptedBackupFile(plain), false);
  assert.equal(bc.isSqliteFile(path.join(dir, "missing.db")), false);
});

test("a file asking for a huge scrypt cost is refused at once; the app's own settings are accepted", async () => {
  // Real backups use DEFAULT_PARAMS (about 32 MB): they must still open.
  const src = fakeDb(path.join(dir, "e.db"), 1000);
  const enc = path.join(dir, "e.db.enc");
  await bc.encryptFile(src, enc, await bc.createBackupKey("the right password", bc.DEFAULT_PARAMS));
  await bc.decryptFile(enc, path.join(dir, "e.out.db"), "the right password");
  assert.deepEqual(fs.readFileSync(path.join(dir, "e.out.db")), fs.readFileSync(src));
  // Same file, header changed to N = 2^20, r = 32, p = 16 (4 GiB of memory): refused without running scrypt.
  for (const [logN, r, p] of [[20, 32, 16], [17, 8, 1], [15, 8, 3]]) {
    const buf = fs.readFileSync(enc);
    buf[8] = logN; buf[9] = r; buf[10] = p;
    const crafted = path.join(dir, `crafted-${logN}-${r}-${p}.enc`);
    fs.writeFileSync(crafted, buf);
    const t = Date.now();
    await assert.rejects(bc.decryptFile(crafted, path.join(dir, "crafted.out"), "the right password"), (e) => e.code === "NOT_A_BACKUP");
    assert.ok(Date.now() - t < 1000, "refused before deriving a key");
  }
  assert.equal(fs.existsSync(path.join(dir, "crafted.out")), false);
});

test("many files made with one password share one key derivation through keyCache", async () => {
  const key = await bc.createBackupKey("shared password!", FAST);
  const cache = new Map();
  for (const n of ["p1", "p2", "p3"]) {
    const src = path.join(dir, n + ".jpg");
    fs.writeFileSync(src, crypto.randomBytes(5000));
    await bc.encryptFile(src, src + ".enc", key);
    await bc.decryptFile(src + ".enc", src + ".out", "shared password!", cache);
    assert.deepEqual(fs.readFileSync(src + ".out"), fs.readFileSync(src));
  }
  assert.equal(cache.size, 1);
});
