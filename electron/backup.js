// Automatic database backup (runs in the Electron main process, independent of the web UI)
const fs = require("fs");
const path = require("path");
const { ipcMain, dialog, shell, app } = require("electron");

const DEFAULTS = { enabled: true, intervalHours: 6, keep: 30, extraDir: null };

let ctx = null; // { dataDir, dbPath, autoDir, cfgFile, statusFile, getWin, isAllowedSender, stopServer }
let timer = null;

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return fallback;
  }
}
function writeJson(file, obj) {
  try {
    fs.writeFileSync(file, JSON.stringify(obj, null, 2));
  } catch (e) {
    console.error("backup: cannot write", file, e.message);
  }
}

function getConfig() {
  const c = { ...DEFAULTS, ...readJson(ctx.cfgFile, {}) };
  c.intervalHours = Math.min(168, Math.max(1, Number(c.intervalHours) || DEFAULTS.intervalHours));
  c.keep = Math.min(365, Math.max(3, Number(c.keep) || DEFAULTS.keep));
  return c;
}
function getStatus() {
  return readJson(ctx.statusFile, {});
}

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" +
    p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds())
  );
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function listBackups() {
  try {
    return fs
      .readdirSync(ctx.autoDir)
      .filter((f) => /^workshop-auto-.*\.db$/.test(f))
      .map((f) => {
        const st = fs.statSync(path.join(ctx.autoDir, f));
        return { name: f, size: st.size, mtime: st.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch (e) {
    return [];
  }
}

// 【中文】删除过旧的备份，只保留最近的几份。
function prune(dir, keep) {
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => /^workshop-auto-.*\.db$/.test(f))
      .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const x of files.slice(keep)) {
      try { fs.unlinkSync(path.join(dir, x.f)); } catch (e) {}
    }
  } catch (e) {}
}

/**
 * 【中文】把上传的图片（发票照片、收款二维码）也备份：只复制新增的文件，从不删除。
 * Mirror the uploads folder (scanned supplier invoices, payment QR) into a backup
 * folder. Uploaded files are never changed or deleted (unique names), so only new
 * files are copied. Returns the number copied.
 */
function mirrorUploads(destRoot) {
  const src = path.join(ctx.dataDir, "uploads");
  if (!fs.existsSync(src)) return 0;
  const dest = path.join(destRoot, "uploads");
  fs.mkdirSync(dest, { recursive: true });
  let n = 0;
  for (const f of fs.readdirSync(src)) {
    const from = path.join(src, f);
    const to = path.join(dest, f);
    try {
      if (!fs.statSync(from).isFile() || fs.existsSync(to)) continue;
      fs.copyFileSync(from, to);
      n++;
    } catch (e) {}
  }
  return n;
}

/** Copy the database. force = ignore "unchanged since last backup" check. */
// 【中文】执行一次备份（用 SQLite 一致性快照），并按设置只保留最近 N 份。
function runBackup(reason, force) {
  if (!ctx) return { ok: false, error: "not ready" };
  const cfg = getConfig();
  const status = getStatus();
  try {
    // Photos first: cheap, and done even when the database itself is unchanged.
    try { mirrorUploads(ctx.autoDir); } catch (e) { console.error("backup: uploads", e.message); }
    if (cfg.extraDir) {
      try { mirrorUploads(cfg.extraDir); } catch (e) { console.error("backup: uploads (extra)", e.message); }
    }
    if (!fs.existsSync(ctx.dbPath)) return { ok: false, error: "database file not found" };
    const dbStat = fs.statSync(ctx.dbPath);
    if (!force && status.lastDbMtime && status.lastDbMtime === dbStat.mtimeMs && status.lastOk) {
      return { ok: true, skipped: true };
    }
    // Avoid copying in the middle of a write transaction
    for (let i = 0; i < 5 && fs.existsSync(ctx.dbPath + "-journal"); i++) sleepSync(400);

    fs.mkdirSync(ctx.autoDir, { recursive: true });
    const base = "workshop-auto-" + stamp() + (reason === "before-restore" ? "-pre-restore" : "");
    let name = base + ".db";
    for (let n = 2; fs.existsSync(path.join(ctx.autoDir, name)); n++) name = base + "-" + n + ".db";
    const dest = path.join(ctx.autoDir, name);
    fs.copyFileSync(ctx.dbPath, dest);

    // Sanity check: SQLite files start with this header
    const head = Buffer.alloc(15);
    const fd = fs.openSync(dest, "r");
    fs.readSync(fd, head, 0, 15, 0);
    fs.closeSync(fd);
    if (head.toString("utf8") !== "SQLite format 3") {
      fs.unlinkSync(dest);
      throw new Error("backup file failed verification");
    }
    prune(ctx.autoDir, cfg.keep);

    const next = {
      ...status,
      lastAt: Date.now(),
      lastOk: true,
      lastError: null,
      lastFile: name,
      lastReason: reason,
      lastDbMtime: dbStat.mtimeMs,
    };

    if (cfg.extraDir) {
      try {
        fs.mkdirSync(cfg.extraDir, { recursive: true });
        fs.copyFileSync(dest, path.join(cfg.extraDir, name));
        prune(cfg.extraDir, cfg.keep);
        next.extraOk = true;
        next.extraError = null;
      } catch (e) {
        next.extraOk = false;
        next.extraError = e.message;
      }
    } else {
      next.extraOk = null;
      next.extraError = null;
    }
    writeJson(ctx.statusFile, next);
    return { ok: true, file: name };
  } catch (e) {
    console.error("backup failed:", e.message);
    writeJson(ctx.statusFile, { ...status, lastAt: Date.now(), lastOk: false, lastError: e.message });
    return { ok: false, error: e.message };
  }
}

function tick() {
  const cfg = getConfig();
  if (!cfg.enabled) return;
  const st = getStatus();
  const due = !st.lastAt || Date.now() - st.lastAt >= cfg.intervalHours * 3600 * 1000;
  if (due) runBackup("scheduled", false);
}

function snapshot() {
  const cfg = getConfig();
  return { config: cfg, status: getStatus(), files: listBackups(), autoDir: ctx.autoDir };
}

// 【中文】初始化自动备份：定时备份、退出时备份、响应设置页的备份/还原操作。
function init(opts) {
  ctx = {
    ...opts,
    autoDir: path.join(opts.dataDir, "backups", "auto"),
    cfgFile: path.join(opts.dataDir, "backup-config.json"),
    statusFile: path.join(opts.dataDir, "backup-status.json"),
  };

  if (!init.ipcDone) {
    init.ipcDone = true;
    const guard = (fn) => async (event, ...args) => {
      if (!ctx || !ctx.isAllowedSender(event)) return { ok: false, error: "forbidden" };
      return fn(event, ...args);
    };

    ipcMain.handle("backup:get", guard(async () => snapshot()));

    ipcMain.handle("backup:set", guard(async (_e, patch) => {
      const cur = getConfig();
      const next = { ...cur };
      if (typeof patch.enabled === "boolean") next.enabled = patch.enabled;
      if (patch.intervalHours !== undefined) next.intervalHours = Number(patch.intervalHours);
      if (patch.keep !== undefined) next.keep = Number(patch.keep);
      if (patch.extraDir === null) next.extraDir = null;
      writeJson(ctx.cfgFile, next);
      return snapshot();
    }));

    ipcMain.handle("backup:choose-dir", guard(async () => {
      const win = ctx.getWin();
      const r = await dialog.showOpenDialog(win, {
        title: "Choose a folder for backup copies (USB drive, OneDrive, Google Drive...)",
        properties: ["openDirectory", "createDirectory"],
      });
      if (r.canceled || !r.filePaths[0]) return snapshot();
      const next = { ...getConfig(), extraDir: r.filePaths[0] };
      writeJson(ctx.cfgFile, next);
      return snapshot();
    }));

    ipcMain.handle("backup:run-now", guard(async () => {
      const r = runBackup("manual", true);
      return { ...snapshot(), result: r };
    }));

    ipcMain.handle("backup:open-folder", guard(async () => {
      fs.mkdirSync(ctx.autoDir, { recursive: true });
      await shell.openPath(ctx.autoDir);
      return { ok: true };
    }));

    ipcMain.handle("backup:restore", guard(async (_e, name) => {
      if (typeof name !== "string" || !/^workshop-auto-[\w-]+\.db$/.test(name)) {
        return { ok: false, error: "invalid file" };
      }
      const src = path.join(ctx.autoDir, name);
      if (!fs.existsSync(src)) return { ok: false, error: "file not found" };
      const r = await dialog.showMessageBox(ctx.getWin(), {
        type: "warning",
        title: "Restore backup",
        message: "Restore this backup?",
        detail:
          name +
          "\n\nAll data entered after this backup will be replaced. " +
          "A safety copy of the current data is saved first. The app will restart.",
        buttons: ["Restore and restart", "Cancel"],
        defaultId: 1,
        cancelId: 1,
      });
      if (r.response !== 0) return { ok: false, error: "cancelled" };
      try {
        runBackup("before-restore", true); // safety copy of the current data
        app.isQuitting = true;
        if (ctx.stopServer) ctx.stopServer();
        sleepSync(1200);
        for (const ext of ["-journal", "-wal", "-shm"]) {
          try { fs.unlinkSync(ctx.dbPath + ext); } catch (e) {}
        }
        fs.copyFileSync(src, ctx.dbPath);
        app.relaunch();
        app.exit(0);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }));
  }

  if (timer) clearInterval(timer);
  setTimeout(tick, 15 * 1000); // first check shortly after start
  timer = setInterval(tick, 30 * 60 * 1000); // then every 30 minutes
}

/** Called when the app quits */
// 【中文】程序退出前做最后一次备份。
function onQuit() {
  if (!ctx) return;
  const cfg = getConfig();
  if (cfg.enabled) runBackup("on-quit", false);
}

module.exports = { init, onQuit };
