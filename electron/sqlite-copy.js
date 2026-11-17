// Checked plain copy of the SQLite database file, for when the embedded server cannot make a
// VACUUM INTO snapshot (server stopped, or the snapshot call was not let through).
// The shop database uses SQLite's rollback journal. A write in progress always has a non-empty
// "-journal" file next to the database before it changes any page of it, and every committed
// write increases the "file change counter" in the database header (bytes 24-27). So the copy is
// kept only when, before and after copying, there is no journal and the counter, size and
// modification time of the database are unchanged; otherwise it may mix pages from before and
// after a write, so it is thrown away and tried again a few times.
// No Electron imports, so tests can require it directly.
// 【中文】服务器无法做 VACUUM INTO 快照时才直接复制数据库文件：复制前后都确认没有写入中的日志文件、
// 文件头的「修改计数」、大小和修改时间都没变，才算完整的副本；否则说明复制时有资料写入，丢弃后重试。
const fs = require("fs");
const fsp = require("fs/promises");

const SQLITE_HEADER = "SQLite format 3\0";
const HEADER_BYTES = 100; // a real SQLite file always has a 100-byte header

function codeError(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Size of a file, or 0 when it does not exist. */
function sizeOf(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

/** { counter, size, mtimeMs } of a SQLite file, or null when it is not one. */
async function readState(file) {
  const st = await fsp.stat(file);
  const fh = await fsp.open(file, "r");
  try {
    const buf = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await fh.read(buf, 0, HEADER_BYTES, 0);
    if (bytesRead < HEADER_BYTES || buf.toString("binary", 0, SQLITE_HEADER.length) !== SQLITE_HEADER) return null;
    return { counter: buf.readUInt32BE(24), size: st.size, mtimeMs: st.mtimeMs };
  } finally {
    await fh.close();
  }
}

/**
 * Copy dbPath to dest and resolve { attempts } once the copy is known to be complete.
 * Throws code NOT_SQLITE (not a database), WAL (write-ahead log in use: the file alone is not
 * the whole database) or BUSY (a write overlapped every attempt). dest is removed on failure.
 * opts: attempts (default 8), waitMs between attempts (default 750), copy(from, to) for tests.
 * 【中文】复制数据库并确认副本完整；一直有资料写入时报 BUSY，副本不会留下。
 */
async function copyConsistent(dbPath, dest, opts = {}) {
  const attempts = Math.max(1, opts.attempts || 8);
  const waitMs = opts.waitMs ?? 750;
  const copy = opts.copy || ((from, to) => fsp.copyFile(from, to));
  // A 0-byte journal has no saved pages yet, so the database file has not been touched.
  const writing = () => sizeOf(dbPath + "-journal") > 0;
  try {
    for (let i = 1; i <= attempts; i++) {
      if (i > 1) await sleep(waitMs);
      if (sizeOf(dbPath + "-wal") > 0) throw codeError("WAL", "the database uses a write-ahead log");
      // Order matters: read the counter, THEN check the journal (before the copy) ...
      const before = await readState(dbPath);
      if (!before) throw codeError("NOT_SQLITE", "the database file is not a SQLite database");
      if (writing()) continue;
      await fsp.rm(dest, { force: true });
      await copy(dbPath, dest);
      // ... and check the journal, THEN read the counter (after the copy).
      if (writing()) continue;
      const after = await readState(dbPath);
      const copied = await readState(dest);
      if (
        after && copied &&
        after.counter === before.counter && after.size === before.size && after.mtimeMs === before.mtimeMs &&
        copied.counter === before.counter && copied.size === before.size
      ) {
        return { attempts: i };
      }
    }
    throw codeError("BUSY", "the database was being changed during every copy attempt");
  } catch (e) {
    await fsp.rm(dest, { force: true }).catch(() => {});
    throw e;
  }
}

module.exports = { copyConsistent, readState };
