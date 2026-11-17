// Small size-rotated log file: server.log, then server.1.log, server.2.log (oldest).
// Synchronous writes keep it simple; the embedded server only logs a few lines a minute.
// Logging must never break the app, so every error here is swallowed.
// 【中文】按大小轮换的日志文件（默认每个 5 MB，保留 3 个）；写日志失败绝不影响程序运行。
const fs = require("fs");
const path = require("path");

class RotatingLog {
  /**
   * @param {string} file e.g. <data>/logs/server.log
   * @param {{ maxBytes?: number, files?: number }} [opts]
   */
  constructor(file, opts = {}) {
    this.file = file;
    this.maxBytes = opts.maxBytes || 5 * 1024 * 1024;
    this.files = Math.max(1, opts.files || 3);
    this.fd = null;
    this.size = 0;
  }

  /** Name of the n-th older file: server.log → server.1.log, server.2.log ... */
  nameFor(n) {
    if (n === 0) return this.file;
    const ext = path.extname(this.file);
    return this.file.slice(0, this.file.length - ext.length) + "." + n + ext;
  }

  open() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.fd = fs.openSync(this.file, "a");
    this.size = fs.fstatSync(this.fd).size;
  }

  rotate() {
    this.close();
    for (let n = this.files - 1; n >= 1; n--) {
      const from = this.nameFor(n - 1);
      const to = this.nameFor(n);
      try { fs.rmSync(to, { force: true }); } catch {}
      try { if (fs.existsSync(from)) fs.renameSync(from, to); } catch {}
    }
    if (this.files === 1) try { fs.rmSync(this.file, { force: true }); } catch {}
  }

  /** Append raw output (Buffer or string). */
  write(chunk) {
    try {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
      if (this.fd === null) this.open();
      if (this.size > 0 && this.size + buf.length > this.maxBytes) {
        this.rotate();
        this.open();
      }
      fs.writeSync(this.fd, buf);
      this.size += buf.length;
    } catch {
      // never let logging crash the app
    }
  }

  /** Append one timestamped line. */
  line(text) {
    this.write("[" + new Date().toISOString() + "] " + text + "\n");
  }

  close() {
    if (this.fd !== null) {
      try { fs.closeSync(this.fd); } catch {}
      this.fd = null;
    }
  }
}

module.exports = { RotatingLog };
