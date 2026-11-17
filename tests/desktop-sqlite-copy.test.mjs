import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";

// electron/sqlite-copy.js: the plain copy used when the server cannot make a VACUUM INTO
// snapshot must never keep a copy that a write overlapped.
const require = createRequire(import.meta.url);
const { copyConsistent, readState } = require("../electron/sqlite-copy.js");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-sqlite-copy-"));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
const FAST = { attempts: 3, waitMs: 1 };

/** A file shaped like a SQLite database: 100-byte header with the change counter at 24-27. */
function makeDb(name, counter = 7) {
  const file = path.join(dir, name);
  const header = Buffer.alloc(100);
  header.write("SQLite format 3\0", 0, "binary");
  header.writeUInt32BE(counter, 24);
  fs.writeFileSync(file, Buffer.concat([header, crypto.randomBytes(8192)]));
  return file;
}

/** What a committed write does to the database file: changes a page and bumps the counter. */
function commitWrite(file) {
  const buf = fs.readFileSync(file);
  buf.writeUInt32BE(buf.readUInt32BE(24) + 1, 24);
  buf[5000] ^= 0xff;
  fs.writeFileSync(file, buf);
}

test("a database nobody writes to is copied on the first attempt, byte for byte", async () => {
  const src = makeDb("quiet.db");
  const dest = path.join(dir, "quiet.copy");
  const r = await copyConsistent(src, dest, FAST);
  assert.equal(r.attempts, 1);
  assert.deepEqual(fs.readFileSync(dest), fs.readFileSync(src));
  assert.equal((await readState(dest)).counter, 7);
});

test("a write committed during the copy is detected: that copy is thrown away and taken again", async () => {
  const src = makeDb("busy-once.db");
  const dest = path.join(dir, "busy-once.copy");
  let n = 0;
  const copy = async (from, to) => {
    await fsp.copyFile(from, to);
    if (++n === 1) commitWrite(from); // a phone saves a job card while the first copy runs
  };
  const r = await copyConsistent(src, dest, { ...FAST, copy });
  assert.equal(r.attempts, 2);
  assert.deepEqual(fs.readFileSync(dest), fs.readFileSync(src), "the kept copy is the database after the write");
  assert.equal((await readState(dest)).counter, 8);
});

test("a write still in progress after the copy (journal with saved pages) is detected", async () => {
  const src = makeDb("journal-during.db");
  const dest = path.join(dir, "journal-during.copy");
  let n = 0;
  const copy = async (from, to) => {
    await fsp.copyFile(from, to);
    if (++n === 1) {
      // The write started during the first copy and finishes (journal deleted) a moment later.
      fs.writeFileSync(from + "-journal", "original pages");
      setTimeout(() => fs.rmSync(from + "-journal", { force: true }), 5);
    }
  };
  const r = await copyConsistent(src, dest, { ...FAST, waitMs: 50, copy });
  assert.equal(r.attempts, 2);
  assert.equal(n, 2);
});

test("a page changed and put back during the copy (rolled-back write) is detected by the file time", async () => {
  const src = makeDb("rollback.db");
  const dest = path.join(dir, "rollback.copy");
  let n = 0;
  const copy = async (from, to) => {
    await fsp.copyFile(from, to);
    if (++n === 1) {
      const t = new Date(Date.now() + 5000);
      fs.utimesSync(from, t, t); // same bytes and counter, but the file was written to
    }
  };
  const r = await copyConsistent(src, dest, { ...FAST, copy });
  assert.equal(r.attempts, 2);
});

test("a database that keeps changing gives BUSY and leaves no copy behind", async () => {
  const src = makeDb("always-busy.db");
  const dest = path.join(dir, "always-busy.copy");
  const copy = async (from, to) => {
    await fsp.copyFile(from, to);
    commitWrite(from);
  };
  await assert.rejects(copyConsistent(src, dest, { ...FAST, copy }), (e) => e.code === "BUSY");
  assert.equal(fs.existsSync(dest), false);
});

test("a journal left by a write that was cut off (hot journal) blocks the copy", async () => {
  const src = makeDb("hot.db");
  const dest = path.join(dir, "hot.copy");
  fs.writeFileSync(src + "-journal", "pages to roll back");
  await assert.rejects(copyConsistent(src, dest, FAST), (e) => e.code === "BUSY");
  assert.equal(fs.existsSync(dest), false);
});

test("an empty journal (no pages saved yet) does not block the copy", async () => {
  const src = makeDb("empty-journal.db");
  fs.writeFileSync(src + "-journal", "");
  const r = await copyConsistent(src, path.join(dir, "empty-journal.copy"), FAST);
  assert.equal(r.attempts, 1);
});

test("a database with a write-ahead log in use, or a file that is not SQLite, is refused", async () => {
  const src = makeDb("wal.db");
  fs.writeFileSync(src + "-wal", "frames not yet in the main file");
  await assert.rejects(copyConsistent(src, path.join(dir, "wal.copy"), FAST), (e) => e.code === "WAL");
  const junk = path.join(dir, "junk.db");
  fs.writeFileSync(junk, "not a database at all");
  await assert.rejects(copyConsistent(junk, path.join(dir, "junk.copy"), FAST), (e) => e.code === "NOT_SQLITE");
  assert.equal(fs.existsSync(path.join(dir, "junk.copy")), false);
});
