// Automatic database backup (runs in the Electron main process, independent of the web UI)
//
// - Snapshots are taken by the embedded server with SQLite VACUUM INTO (a consistent copy even
//   while the app is writing), through /api/internal/backup. When the server is stopped or does
//   not let the call through, a checked file copy is made instead (sqlite-copy.js: kept only
//   when no write happened during the copy, otherwise the backup fails) and the method is recorded.
// - Copies to the boss's extra folder (USB / OneDrive / Google Drive) are encrypted with the
//   backup password (*.db.enc); without a password no extra copies are written.
// - Restore: verify first (SQLite header + integrity_check by the server), add missing photos,
//   stop the server, make a safety copy (abort if it fails), then swap the file in with a rename
//   and always relaunch.
// - Emergency restore (offlineRestore): the same steps while the server cannot start, driven by
//   native dialogs in emergency-restore.js (no login, not reachable from the web page).
// 【中文】自动备份：由服务器用 VACUUM INTO 做一致性快照；做不了快照时改用「经检查的文件复制」（复制期间有写入就放弃）；
// USB / 云盘副本用备份密码加密；还原前先校验、先停服务器再做安全副本（失败就不还原），再用改名方式替换，最后一定重新启动程序。
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { ipcMain, dialog, shell, app } = require("electron");
const { selectForDeletion, parseBackupName } = require("./retention");
const bcrypto = require("./backup-crypto");
const { copyConsistent } = require("./sqlite-copy");
const protect = require("./protect");
const { INTERNAL_HEADER, makeInternalToken } = require("./internal-auth");

const DEFAULTS = { enabled: true, intervalHours: 6, keep: 30, extraDir: null };
const AUTO_RE = /^workshop-auto-[\w-]+\.db$/;
const ENC_RE = /^workshop-auto-[\w-]+\.db\.enc$/;
const PARTIAL_RE = /^workshop-auto-[\w-]+\.db(\.enc)?\.partial$/;
const UPLOAD_NAME = /^[a-z0-9-]+\.(png|jpg|webp)$/; // same rule as src/lib/uploads.ts SAFE_NAME

// { dataDir, dbPath, autoDir, cfgFile, statusFile, getWin, isAllowedSender, getPort,
//   getAuthSecret, getSessionCookie, stopServer, log, copyRetry? (tests: { attempts, waitMs }) }
let ctx = null;
let timer = null;
let chain = Promise.resolve(); // backups run one at a time
let restoring = false;
let pendingPick = null; // file chosen in "Restore from a backup file…": { id, file, encrypted }
let backupKeyCache; // undefined = not read yet, null = no password set

function log(msg) {
  try {
    if (ctx && ctx.log) ctx.log("[backup] " + msg);
    else console.log("[backup] " + msg);
  } catch {}
}

function codeError(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
function writeJson(file, obj) {
  try {
    fs.writeFileSync(file + ".tmp", JSON.stringify(obj, null, 2));
    fs.renameSync(file + ".tmp", file);
  } catch (e) {
    log("cannot write " + file + ": " + e.message);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function samePath(a, b) {
  const x = path.resolve(a), y = path.resolve(b);
  return process.platform === "win32" ? x.toLowerCase() === y.toLowerCase() : x === y;
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

function listBackups() {
  try {
    return fs
      .readdirSync(ctx.autoDir)
      .filter((f) => AUTO_RE.test(f))
      .map((f) => {
        const st = fs.statSync(path.join(ctx.autoDir, f));
        const p = parseBackupName(f);
        return { name: f, size: st.size, mtime: st.mtimeMs, preRestore: !!(p && p.preRestore) };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return [];
  }
}

// 【中文】按保留规则删除旧备份（最近 N 份 + 最近 7 天每天一份 + 最近 12 个月每月一份 + 最新的还原前安全副本）。
function prune(dir, re, keep) {
  try {
    const files = fs.readdirSync(dir).filter((f) => re.test(f)).map((name) => ({ name }));
    for (const name of selectForDeletion(files, { keep })) {
      try { fs.unlinkSync(path.join(dir, name)); } catch {}
    }
    // Half-written copies left when the app was closed (60 s quit limit) or the power went off
    // mid-backup. Safe here: backups run one at a time (runBackup chain) and prune runs only
    // after this backup's own .partial was renamed. 【中文】清理上次关闭/断电时没写完的 .partial 临时文件。
    for (const f of fs.readdirSync(dir)) {
      if (PARTIAL_RE.test(f)) { try { fs.unlinkSync(path.join(dir, f)); } catch {} }
    }
  } catch {}
}

/**
 * 【中文】把上传的图片（发票照片、收款二维码）也备份到本机备份文件夹：只复制新增的文件，从不删除。
 * Uploaded files are never changed or deleted (unique names), so only new files are copied.
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
    } catch {}
  }
  return n;
}

/** Same, for the extra folder: every photo is encrypted with the backup password (<name>.enc). */
async function mirrorUploadsEncrypted(destRoot, key) {
  const src = path.join(ctx.dataDir, "uploads");
  if (!fs.existsSync(src)) return 0;
  const dest = path.join(destRoot, "uploads");
  fs.mkdirSync(dest, { recursive: true });
  let n = 0;
  for (const f of fs.readdirSync(src)) {
    const from = path.join(src, f);
    const to = path.join(dest, f + ".enc");
    try {
      if (!fs.statSync(from).isFile() || fs.existsSync(to)) continue;
      await bcrypto.encryptFile(from, to, key);
      n++;
    } catch {}
  }
  return n;
}


/** v0.5.0 — mirror workshop DVI/check-in photos recursively; filenames are random and never overwritten. */
function workshopPhotoFiles(root, base = root) {
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) out.push(...workshopPhotoFiles(full, base));
    else if (entry.isFile() && /\.(jpg|jpeg|png|webp)(\.enc)?$/i.test(entry.name)) out.push({ full, relative: path.relative(base, full) });
  }
  return out;
}
function mirrorWorkshopPhotos(destRoot) {
  const src = path.join(ctx.dataDir, "workshop-photos");
  const files = workshopPhotoFiles(src);
  let n = 0;
  for (const item of files) {
    const to = path.join(destRoot, "workshop-photos", item.relative);
    try { fs.mkdirSync(path.dirname(to), { recursive: true }); if (fs.existsSync(to)) continue; fs.copyFileSync(item.full, to, fs.constants.COPYFILE_EXCL); n++; } catch {}
  }
  return n;
}
async function mirrorWorkshopPhotosEncrypted(destRoot, key) {
  const src = path.join(ctx.dataDir, "workshop-photos");
  const files = workshopPhotoFiles(src);
  let n = 0;
  for (const item of files) {
    const to = path.join(destRoot, "workshop-photos", item.relative + ".enc");
    try { fs.mkdirSync(path.dirname(to), { recursive: true }); if (fs.existsSync(to)) continue; await bcrypto.encryptFile(item.full, to, key); n++; } catch {}
  }
  return n;
}

// ---------- backup password (key kept on this PC, protected by Windows) ----------

function keyBase() {
  return path.join(ctx.dataDir, "backup-key");
}

/** Resolves the derived key for the backup password, or null when none is set. */
async function readBackupKey() {
  if (backupKeyCache !== undefined) return backupKeyCache;
  try {
    const raw = await protect.readProtected(keyBase());
    const k = raw ? JSON.parse(raw) : null;
    backupKeyCache = k && k.v === 1 && /^[0-9a-f]{64}$/.test(k.key) ? k : null;
  } catch (e) {
    log("backup password key cannot be read: " + e.message);
    // LOCKED may be temporary: do not cache. UNREADABLE: the boss sets the password again.
    if (e.code !== "LOCKED") backupKeyCache = null;
    return null;
  }
  return backupKeyCache;
}

// ---------- calls to the embedded server (/api/internal/backup) ----------

/** Resolves { status, json } or { down: true } when the server is not running. Never rejects. */
async function callInternal(action, payload, opts = {}) {
  const port = ctx.getPort();
  if (!port) return { down: true, error: "server not running" };
  let cookie = null;
  try { cookie = await ctx.getSessionCookie(); } catch {}
  const body = JSON.stringify({ ...payload, action });
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/api/internal/backup",
        method: "POST",
        timeout: opts.timeoutMs || 120000,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          [INTERNAL_HEADER]: makeInternalToken(ctx.getAuthSecret()),
          // The window's login lets the server check that the boss asked for a restore / setting
          // change, and record who did it in the audit log.
          ...(cookie ? { Cookie: "session=" + cookie } : {}),
        },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let json = {};
          try { json = JSON.parse(data) || {}; } catch {}
          resolve({ status: res.statusCode, json });
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (e) => resolve({ down: e.code === "ECONNREFUSED", error: e.message, json: {} }));
    req.end(body);
  });
}

/** The logged-in user in the app window, if it is the boss. */
async function ownerSession() {
  const r = await callInternal("whoami", {});
  if (r.status === 200 && r.json.ok && r.json.user) return { ok: true, user: r.json.user };
  if (r.down) return { ok: false, error: "server-down" };
  if (r.status === 401 || r.status === 403) return { ok: false, error: "owner-only" };
  return { ok: false, error: "server-error", detail: r.json.error || r.error };
}

/** Best effort: a failed audit write is logged, it never blocks the action. */
async function audit(auditAction, summary, details) {
  const r = await callInternal("audit", { auditAction, summary, details });
  if (!(r.status === 200 && r.json.ok)) log("audit " + auditAction + " not recorded: " + (r.json.error || r.error || r.status));
}

// ---------- taking a backup ----------

async function finalizeCopy(partial, dest) {
  if (!bcrypto.isSqliteFile(partial)) {
    await fsp.rm(partial, { force: true }).catch(() => {});
    throw new Error("backup file failed verification");
  }
  await fsp.rename(partial, dest);
}

// Whole English sentence: shown as the last backup error and translated by the page dictionary.
const BUSY_MESSAGE = "The database was being changed during the backup, so this backup was not saved. Press Back up now to try again.";

/**
 * Plain copy of the database file, kept only when no write happened during the copy
 * (sqlite-copy.js). A copy that may be torn is never saved as a backup.
 * 【中文】直接复制数据库文件，只有确认复制期间没有写入才保留；可能不完整的副本绝不当作备份。
 */
async function copyLiveFile(dest) {
  const partial = dest + ".partial";
  try {
    await copyConsistent(ctx.dbPath, partial, ctx.copyRetry || {});
  } catch (e) {
    if (e.code === "BUSY") throw new Error(BUSY_MESSAGE);
    throw e;
  }
  await finalizeCopy(partial, dest);
}

// 【中文】做一份数据库快照：服务器运行时用 VACUUM INTO（一致性快照）；做不了快照时改用经检查的文件复制。
async function snapshotDb(dest) {
  const partial = dest + ".partial";
  await fsp.rm(partial, { force: true }).catch(() => {});
  const r = await callInternal("snapshot", { dest: partial }, { timeoutMs: 10 * 60 * 1000 });
  if (r.status === 200 && r.json.ok) {
    await finalizeCopy(partial, dest);
    return { method: "snapshot" };
  }
  await fsp.rm(partial, { force: true }).catch(() => {});
  if (r.down) {
    await copyLiveFile(dest);
    return { method: "copy", note: "server stopped" };
  }
  if (r.status === 401 || r.status === 404) {
    // The running server did not let the call through to the snapshot route (e.g. a server
    // without the /api/internal/backup login exemption while nobody is logged in). Phones on
    // the LAN may be writing, so this is the checked copy: it fails rather than keep a torn file.
    await copyLiveFile(dest);
    return { method: "copy", note: "checked copy: snapshot route unavailable (HTTP " + r.status + ")" };
  }
  throw new Error("snapshot failed: " + (r.json.error || r.error || "HTTP " + r.status));
}

/** Encrypted copy to the extra folder. Refused (NO_PASSWORD) when no backup password is set. */
async function copyToExtra(cfg, src, name) {
  if (!cfg.extraDir) return { extraOk: null, extraError: null };
  const key = await readBackupKey();
  if (!key) return { extraOk: false, extraError: "NO_PASSWORD" };
  try {
    fs.mkdirSync(cfg.extraDir, { recursive: true });
    await bcrypto.encryptFile(src, path.join(cfg.extraDir, name + ".enc"), key);
    try { await mirrorUploadsEncrypted(cfg.extraDir, key); await mirrorWorkshopPhotosEncrypted(cfg.extraDir, key); } catch (e) { log("photos (extra folder): " + e.message); }
    prune(cfg.extraDir, ENC_RE, cfg.keep);
    return { extraOk: true, extraError: null, extraLastFile: name + ".enc", extraAt: Date.now() };
  } catch (e) {
    log("copy to extra folder failed: " + e.message);
    return { extraOk: false, extraError: e.message };
  }
}

// 【中文】执行一次备份（一致性快照），按保留规则清理旧备份，并把加密副本写到额外文件夹。
async function doBackup(reason, force) {
  if (!ctx) return { ok: false, error: "not ready" };
  const cfg = getConfig();
  const status = getStatus();
  try {
    // Photos first: cheap, and done even when the database itself is unchanged.
    try { mirrorUploads(ctx.autoDir); mirrorWorkshopPhotos(ctx.autoDir); } catch (e) { log("photos: " + e.message); }
    if (!fs.existsSync(ctx.dbPath)) return { ok: false, error: "database file not found" };
    const dbStat = fs.statSync(ctx.dbPath);
    if (!force && status.lastDbMtime && status.lastDbMtime === dbStat.mtimeMs && status.lastOk) {
      // Database unchanged. Still retry the extra copy of the last backup if it did not work.
      if (cfg.extraDir && status.extraOk !== true && status.lastFile) {
        const src = path.join(ctx.autoDir, status.lastFile);
        if (fs.existsSync(src)) writeJson(ctx.statusFile, { ...getStatus(), ...(await copyToExtra(cfg, src, status.lastFile)) });
      }
      return { ok: true, skipped: true };
    }

    fs.mkdirSync(ctx.autoDir, { recursive: true });
    const base = "workshop-auto-" + stamp() + (reason === "before-restore" ? "-pre-restore" : "");
    let name = base + ".db";
    for (let n = 2; fs.existsSync(path.join(ctx.autoDir, name)); n++) name = base + "-" + n + ".db";
    const dest = path.join(ctx.autoDir, name);
    const snap = await snapshotDb(dest);
    prune(ctx.autoDir, AUTO_RE, cfg.keep);

    const next = {
      ...getStatus(),
      lastAt: Date.now(),
      lastOk: true,
      lastError: null,
      lastFile: name,
      lastReason: reason,
      lastMethod: snap.method,
      lastMethodNote: snap.note || null,
      lastDbMtime: dbStat.mtimeMs,
      ...(await copyToExtra(cfg, dest, name)),
    };
    writeJson(ctx.statusFile, next);
    log(reason + ": " + name + " (" + snap.method + (snap.note ? ", " + snap.note : "") + ")");
    return { ok: true, file: name, method: snap.method };
  } catch (e) {
    log(reason + " backup failed: " + e.message);
    writeJson(ctx.statusFile, { ...getStatus(), lastAt: Date.now(), lastOk: false, lastError: e.message });
    return { ok: false, error: e.message };
  }
}

/** Run a backup; backups never run at the same time. force = ignore "unchanged since last backup". */
function runBackup(reason, force) {
  const p = chain.then(() => doBackup(reason, force));
  chain = p.catch(() => {});
  return p;
}

function tick() {
  const cfg = getConfig();
  if (!cfg.enabled) return;
  const st = getStatus();
  const due = !st.lastAt || Date.now() - st.lastAt >= cfg.intervalHours * 3600 * 1000;
  if (due) runBackup("scheduled", false).catch((e) => log("scheduled: " + e.message));
}

function countPlainExtra(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => AUTO_RE.test(f)).length;
  } catch {
    return 0;
  }
}

async function snapshot() {
  const cfg = getConfig();
  const key = await readBackupKey();
  return {
    config: cfg,
    status: getStatus(),
    files: listBackups(),
    autoDir: ctx.autoDir,
    hasPassword: !!key,
    passwordSetAt: key ? key.setAt || null : null,
    extraPlainCount: cfg.extraDir ? countPlainExtra(cfg.extraDir) : 0,
  };
}

// ---------- restore ----------

function restorePendingFile(dataDir) {
  return path.join(dataDir, "restore-pending.json");
}
/** Read by the server at start (src/lib/desktop-startup.ts) to write the audit entry. */
function restoreAuditFile(dataDir) {
  return path.join(dataDir, "restore-audit.json");
}

async function renameRetry(from, to) {
  for (let i = 0; ; i++) {
    try {
      return fs.renameSync(from, to);
    } catch (e) {
      // Windows can keep the file locked for a moment after the server process exits.
      if (i >= 10 || !["EBUSY", "EPERM", "EACCES"].includes(e.code)) throw e;
      await sleep(300);
    }
  }
}

/**
 * Put `tmp` in place of the database with a rename (all or nothing). The old database's
 * journal files are moved aside first, so SQLite never applies them to the new file, and
 * are put back if the rename fails.
 * 【中文】用改名替换数据库（要么完全成功，要么完全不变）；旧的日志文件先挪开，失败时放回。
 */
async function swapInto(tmp, dbPath) {
  const moved = [];
  try {
    for (const ext of ["-journal", "-wal", "-shm"]) {
      if (fs.existsSync(dbPath + ext)) {
        await renameRetry(dbPath + ext, dbPath + ext + ".before-restore");
        moved.push(ext);
      }
    }
    await renameRetry(tmp, dbPath);
  } catch (e) {
    for (const ext of moved) {
      try { fs.renameSync(dbPath + ext + ".before-restore", dbPath + ext); } catch {}
    }
    throw e;
  }
  for (const ext of moved) {
    try { fs.rmSync(dbPath + ext + ".before-restore", { force: true }); } catch {}
  }
}

/** Copy photos that are missing from the data folder (never overwrites; names are unique). */
async function restorePhotos(fromDir, password, keyCache, dataDir = ctx.dataDir) {
  const src = path.join(fromDir, "uploads");
  const dest = path.join(dataDir, "uploads");
  let n = 0;
  if (fs.existsSync(src) && !samePath(src, dest)) {
    fs.mkdirSync(dest, { recursive: true });
    for (const f of fs.readdirSync(src)) {
      try {
        const from = path.join(src, f);
        const encrypted = f.endsWith(".enc");
        const name = encrypted ? f.slice(0, -4) : f;
        if (!UPLOAD_NAME.test(name) || fs.existsSync(path.join(dest, name))) continue;
        if (!fs.statSync(from).isFile()) continue;
        if (encrypted) {
          if (!password) continue;
          await bcrypto.decryptFile(from, path.join(dest, name), password, keyCache);
        } else {
          await fsp.copyFile(from, path.join(dest, name));
        }
        n++;
      } catch (e) {
        log("photo " + f + " not restored: " + e.message);
      }
    }
  }
  // v0.5.0 — restore nested workshop inspection/check-in images as well as legacy uploads.
  const workshopSrc = path.join(fromDir, "workshop-photos");
  const workshopDest = path.join(dataDir, "workshop-photos");
  if (fs.existsSync(workshopSrc) && !samePath(workshopSrc, workshopDest)) {
    for (const item of workshopPhotoFiles(workshopSrc)) {
      try {
        const relative = path.relative(workshopSrc, item.full);
        const encrypted = relative.endsWith(".enc");
        const targetRelative = encrypted ? relative.slice(0, -4) : relative;
        if (!/\.(jpg|jpeg|png|webp)$/i.test(targetRelative)) continue;
        const target = path.join(workshopDest, targetRelative);
        if (!target.startsWith(workshopDest + path.sep) || fs.existsSync(target)) continue;
        await fsp.mkdir(path.dirname(target), { recursive: true });
        if (encrypted) { if (!password) continue; await bcrypto.decryptFile(item.full, target, password, keyCache); }
        else await fsp.copyFile(item.full, target);
        n++;
      } catch (e) { log("workshop photo " + item.relative + " not restored: " + e.message); }
    }
  }
  return n;
}

function fmtDate(iso) {
  try {
    return iso ? new Date(iso).toLocaleString() : "";
  } catch {
    return "";
  }
}

/**
 * Shared restore steps for an auto backup or a chosen file.
 * 1 boss logged in → 2 copy / decrypt to workshop.db.restoring → 3 SQLite header + integrity_check
 * → 4 confirm → 5 add missing photos → 6 stop server → 7 safety copy (abort if it fails)
 * → 8 rename into place → 9 relaunch.
 * The server is stopped BEFORE the safety copy, so nothing (e.g. a phone on the LAN) can save
 * data that ends up in neither the safety copy nor the restored database.
 * 【中文】还原流程：确认老板身份 → 复制/解密到临时文件 → 校验 → 确认 → 补回照片 → 先停服务器 → 安全副本（失败则中止）
 * → 替换 → 一定重新启动。先停服务器再做安全副本，这样不会有资料在两边都找不到。
 */
async function restoreFlow({ label, folder, prepare, photosFrom, password, keyCache }) {
  if (restoring) return { ok: false, error: "busy" };
  restoring = true;
  const tmp = ctx.dbPath + ".restoring";
  let stopped = false;
  let marker = null;
  try {
    const who = await ownerSession();
    if (!who.ok) return who;
    await fsp.rm(tmp, { force: true });
    await prepare(tmp);
    if (!bcrypto.isSqliteFile(tmp)) throw codeError("NOT_A_BACKUP");
    const v = await callInternal("verify", { file: tmp }, { timeoutMs: 10 * 60 * 1000 });
    if (v.down) throw codeError("server-down");
    if (!(v.status === 200 && v.json.ok)) throw codeError("VERIFY_FAILED", v.json.error || v.error || "HTTP " + v.status);
    const info = { workOrders: v.json.workOrders ?? null, lastWorkOrderAt: v.json.lastWorkOrderAt || null };

    const summary =
      info.workOrders != null
        ? "\n工单 Work orders: " + info.workOrders + (info.lastWorkOrderAt ? "   最新 Latest: " + fmtDate(info.lastWorkOrderAt) : "")
        : "";
    const r = await dialog.showMessageBox(ctx.getWin(), {
      type: "warning",
      title: "还原备份 · Restore backup",
      message: "还原这个备份？\nRestore this backup?",
      detail:
        label + summary +
        "\n\n这个备份之后输入的所有资料都会被替换。还原前会先保存一份当前资料的安全副本，然后程序会重新启动。\n" +
        "All data entered after this backup will be replaced. A safety copy of the current data is saved first, then the app restarts.\n\n" +
        "注意：这个备份之后开出的单据号码不会再被使用；已提交 LHDN、但还原后不在资料里的 e-Invoice 会列在审计日志（Audit Log）里，请重新登记。\n" +
        "Note: document numbers issued after this backup will not be issued again. e-Invoices already sent to LHDN that are no longer in the restored data are listed in the Audit Log so you can re-enter them.",
      buttons: ["还原并重启 Restore and restart", "取消 Cancel"],
      defaultId: 1,
      cancelId: 1,
    });
    if (r.response !== 0) return { ok: false, error: "cancelled" };

    await audit("BACKUP_RESTORE_STARTED", "Restore started from backup " + label, { source: label, folder, ...info });
    // Photos only add missing files (never overwrite), so doing this while the app still runs is
    // harmless even if the restore stops later, and keeps the server's downtime short.
    const photos = photosFrom ? await restorePhotos(photosFrom, password, keyCache) : 0;

    marker = { at: Date.now(), source: label, folder, safetyCopy: null, actor: who.user, photos, ...info };
    app.isQuitting = true;
    stopped = true;
    await ctx.stopServer();
    // Nothing writes to the database any more: the safety copy is the checked file copy.
    const safety = await runBackup("before-restore", true);
    if (!safety.ok || !safety.file) throw codeError("SAFETY_COPY_FAILED", safety.error || "no safety copy");
    marker.safetyCopy = safety.file;
    writeJson(restorePendingFile(ctx.dataDir), { ...marker, safetyCopyPath: path.join(ctx.autoDir, safety.file) });
    writeJson(restoreAuditFile(ctx.dataDir), { ...marker, status: "restored" });
    await swapInto(tmp, ctx.dbPath);
    log("restored " + label + " (safety copy " + safety.file + ")");
    return { ok: true };
  } catch (e) {
    log("restore of " + label + " failed: " + e.message);
    const error = e.code && /^[A-Za-z_-]+$/.test(e.code) ? e.code : "FAILED";
    if (stopped && marker) {
      // swapInto is all or nothing: the live database is still the one from before.
      writeJson(restoreAuditFile(ctx.dataDir), { ...marker, status: "failed", error: String(e.message).slice(0, 300) });
      try { fs.rmSync(restorePendingFile(ctx.dataDir), { force: true }); } catch {}
      // The app restarts below, so the settings page cannot show the error: tell the boss here.
      await dialog.showMessageBox(ctx.getWin(), {
        type: "error",
        title: "还原备份 · Restore backup",
        message: "还原没有完成，资料没有改变。\nThe restore did not finish. Your data was not changed.",
        detail:
          (error === "SAFETY_COPY_FAILED"
            ? "无法保存当前资料的安全副本，请检查硬盘空间。\nThe safety copy of the current data could not be saved. Check the free disk space.\n\n"
            : "") +
          "程序会重新启动。 The app will restart.\n\n" + String(e.message).slice(0, 300),
      }).catch(() => {});
    }
    return { ok: false, error, detail: e.message };
  } finally {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    restoring = false;
    // Once the server was stopped, always start the app again, even after an error.
    if (stopped) {
      app.relaunch();
      app.exit(0);
    }
  }
}

/** Restore marker left by a restore whose server start has not been confirmed yet. */
function readPendingRestore(dataDir) {
  const p = readJson(restorePendingFile(dataDir), null);
  return p && typeof p.safetyCopyPath === "string" ? p : null;
}
function clearPendingRestore(dataDir) {
  try { fs.rmSync(restorePendingFile(dataDir), { force: true }); } catch {}
}

/**
 * The server would not start on a just-restored database: put the safety copy back.
 * 【中文】还原后服务器无法启动：自动放回还原前的安全副本。
 */
async function rollbackRestore(dataDir, dbPath, pending) {
  const tmp = dbPath + ".restoring";
  await fsp.copyFile(pending.safetyCopyPath, tmp);
  if (!bcrypto.isSqliteFile(tmp)) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw new Error("safety copy failed verification");
  }
  await swapInto(tmp, dbPath);
  const marker = { ...pending };
  delete marker.safetyCopyPath;
  writeJson(restoreAuditFile(dataDir), { ...marker, status: "rolled-back", rolledBackAt: Date.now() });
  clearPendingRestore(dataDir);
}

// ---------- emergency restore (the server cannot start) ----------

/** Name recorded as "who" in the audit log: nobody can log in while the server cannot start. */
const EMERGENCY_ACTOR = "Emergency restore at the shop computer (no login)";

/**
 * Safety copy of the current database while the server is NOT running.
 * - A healthy file: checked copy into backups/auto as "...-pre-restore.db" (listed in Settings →
 *   Backup, kept by retention, used to roll back if the restored file does not start).
 * - A damaged file (not SQLite, or a write was cut off and left a journal): the raw files are
 *   copied into backups/damaged/<stamp>/ for support; they are never offered as a backup.
 * Throws SAFETY_COPY_FAILED when neither works (e.g. the disk is full): then nothing is changed.
 * 【中文】服务器没在运行时保存当前资料的安全副本：正常文件 → 经检查的复制（可用来自动回滚）；
 * 已损坏的文件 → 原样复制到 backups/damaged 给技术支持。两种都失败就中止，不做任何改动。
 */
async function safetyCopyOffline(dataDir, dbPath, copyRetry, say) {
  if (!fs.existsSync(dbPath)) return { name: null, path: null, restorable: false };
  const autoDir = path.join(dataDir, "backups", "auto");
  const base = "workshop-auto-" + stamp() + "-pre-restore";
  let name = base + ".db";
  for (let n = 2; fs.existsSync(path.join(autoDir, name)); n++) name = base + "-" + n + ".db";
  const dest = path.join(autoDir, name);
  try {
    fs.mkdirSync(autoDir, { recursive: true });
    await copyConsistent(dbPath, dest + ".partial", copyRetry || {});
    await finalizeCopy(dest + ".partial", dest);
    return { name, path: dest, restorable: true };
  } catch (e) {
    say("checked safety copy not possible (" + (e.code || e.message) + "): keeping the raw files instead");
  }
  try {
    const dir = path.join(dataDir, "backups", "damaged", "workshop-before-emergency-restore-" + stamp());
    fs.mkdirSync(dir, { recursive: true });
    for (const ext of ["", "-journal", "-wal", "-shm"]) {
      if (fs.existsSync(dbPath + ext)) await fsp.copyFile(dbPath + ext, path.join(dir, path.basename(dbPath) + ext));
    }
    return { name: path.relative(path.join(dataDir, "backups"), dir), path: dir, restorable: false };
  } catch (e) {
    throw codeError("SAFETY_COPY_FAILED", e.message);
  }
}

/**
 * Restore a backup while the embedded server is NOT running: the emergency path of the desktop
 * app (start failed, or the server crashed too often), so it needs no login. The caller
 * (emergency-restore.js) checks the file in a helper process (`verify`) and asks for the boss's
 * confirmation in native dialogs (`confirm`); nothing in the web page can reach this.
 * Steps: copy / decrypt to workshop.db.restoring → SQLite header → verify (integrity_check)
 * → confirm → add missing photos → safety copy (abort if it fails) → rename into place.
 * Resolves { ok: true, safetyCopy, damagedCopy } or { ok: false, error, detail }; the caller
 * relaunches the app. The restore is written to the audit log at the next start.
 * opts: { dataDir, dbPath, file, encrypted, password, verify(tmp), confirm(info), log?, copyRetry? }
 * 【中文】紧急还原（服务器无法启动时）：不需要登录；由桌面程序的原生对话框确认，网页无法调用。
 * 步骤：复制/解密到临时文件 → 校验 → 确认 → 补回照片 → 安全副本（失败就中止）→ 改名替换；之后由调用方重启程序。
 */
async function offlineRestore(opts) {
  const say = (m) => {
    if (opts.log) { try { opts.log("[backup] " + m); } catch {} } else log(m);
  };
  if (restoring) return { ok: false, error: "busy" };
  restoring = true;
  const { dataDir, dbPath, file } = opts;
  const tmp = dbPath + ".restoring";
  const label = path.basename(file);
  const folder = path.dirname(file);
  let marker = null;
  try {
    if (samePath(file, dbPath) || (samePath(folder, dataDir) && label.toLowerCase().startsWith("workshop.db"))) {
      throw codeError("LIVE_DB");
    }
    if (opts.encrypted && !opts.password) throw codeError("PASSWORD_REQUIRED");
    await fsp.rm(tmp, { force: true });
    const keyCache = new Map();
    if (opts.encrypted) await bcrypto.decryptFile(file, tmp, opts.password, keyCache);
    else await fsp.copyFile(file, tmp);
    if (!bcrypto.isSqliteFile(tmp)) throw codeError("NOT_A_BACKUP");
    const v = await opts.verify(tmp);
    if (!v || v.ok !== true) throw codeError("VERIFY_FAILED", (v && v.error) || "the file did not pass the check");
    const info = { workOrders: v.workOrders ?? null, lastWorkOrderAt: v.lastWorkOrderAt || null };
    if (!(await opts.confirm({ label, folder, ...info }))) return { ok: false, error: "cancelled" };

    const photos = await restorePhotos(folder, opts.encrypted ? opts.password : null, keyCache, dataDir);
    const safety = await safetyCopyOffline(dataDir, dbPath, opts.copyRetry, say);
    marker = {
      at: Date.now(),
      source: label,
      folder,
      safetyCopy: safety.name,
      actor: { id: "", name: EMERGENCY_ACTOR, role: "OWNER" },
      photos,
      emergency: true,
      ...info,
    };
    // Roll back to the safety copy only when it is a healthy database (a damaged one would not start either).
    if (safety.restorable) writeJson(restorePendingFile(dataDir), { ...marker, safetyCopyPath: safety.path });
    else clearPendingRestore(dataDir);
    writeJson(restoreAuditFile(dataDir), { ...marker, status: "restored" });
    await swapInto(tmp, dbPath);
    say("emergency restore of " + label + " (safety copy " + safety.name + ")");
    return { ok: true, safetyCopy: safety.name, damagedCopy: !safety.restorable && !!safety.name };
  } catch (e) {
    say("emergency restore of " + label + " failed: " + e.message);
    if (marker) {
      // swapInto is all or nothing: the database is still the one from before.
      writeJson(restoreAuditFile(dataDir), { ...marker, status: "failed", error: String(e.message).slice(0, 300) });
      clearPendingRestore(dataDir);
    }
    const error = e.code && /^[A-Za-z_-]+$/.test(e.code) ? e.code : "FAILED";
    return { ok: false, error, detail: e.message };
  } finally {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    restoring = false;
  }
}

// ---------- IPC (Settings → Backup) ----------

// 【中文】初始化自动备份：定时备份、退出时备份、响应设置页的备份 / 密码 / 还原操作。
function init(opts) {
  ctx = {
    ...opts,
    autoDir: path.join(opts.dataDir, "backups", "auto"),
    cfgFile: path.join(opts.dataDir, "backup-config.json"),
    statusFile: path.join(opts.dataDir, "backup-status.json"),
  };
  backupKeyCache = undefined;

  if (!init.ipcDone) {
    init.ipcDone = true;
    const guard = (fn) => async (event, ...args) => {
      if (!ctx || !ctx.isAllowedSender(event)) return { ok: false, error: "forbidden" };
      try {
        return await fn(event, ...args);
      } catch (e) {
        // e.g. the USB drive was unplugged: report it to the page instead of an unhandled rejection
        log("settings action failed: " + (e && e.message));
        const snap = await snapshot().catch(() => ({}));
        return { ...snap, ok: false, error: "FAILED", detail: String((e && e.message) || e) };
      }
    };

    ipcMain.handle("backup:get", guard(async () => await snapshot()));

    ipcMain.handle("backup:set", guard(async (_e, patch) => {
      const who = await ownerSession();
      if (!who.ok) return { ...(await snapshot()), error: who.error };
      const p = patch && typeof patch === "object" ? patch : {};
      const cur = getConfig();
      const next = { ...cur };
      if (typeof p.enabled === "boolean") next.enabled = p.enabled;
      if (p.intervalHours !== undefined) next.intervalHours = Number(p.intervalHours);
      if (p.keep !== undefined) next.keep = Number(p.keep);
      if (p.extraDir === null) next.extraDir = null;
      writeJson(ctx.cfgFile, next);
      const after = getConfig();
      const changed = {};
      for (const k of ["enabled", "intervalHours", "keep", "extraDir"]) {
        if (cur[k] !== after[k]) changed[k] = { before: cur[k], after: after[k] };
      }
      if (Object.keys(changed).length) {
        await audit(changed.extraDir ? "BACKUP_FOLDER_CHANGED" : "BACKUP_SETTINGS_CHANGED", "Automatic backup settings changed", { changed });
      }
      return await snapshot();
    }));

    ipcMain.handle("backup:choose-dir", guard(async () => {
      const who = await ownerSession();
      if (!who.ok) return { ...(await snapshot()), error: who.error };
      // Electron 44+ opens file dialogs in Downloads unless a folder is given: start in the
      // current copy folder, or the user's documents folder.
      const current = getConfig().extraDir;
      const r = await dialog.showOpenDialog(ctx.getWin(), {
        title: "选择备份副本文件夹 · Choose a folder for backup copies (USB drive, OneDrive, Google Drive...)",
        defaultPath: current && fs.existsSync(current) ? current : app.getPath("documents"),
        properties: ["openDirectory", "createDirectory"],
      });
      if (r.canceled || !r.filePaths[0]) return await snapshot();
      const chosen = r.filePaths[0];
      if (samePath(chosen, ctx.dataDir) || samePath(chosen, ctx.autoDir)) return { ...(await snapshot()), error: "SAME_FOLDER" };
      const before = getConfig().extraDir;
      writeJson(ctx.cfgFile, { ...getConfig(), extraDir: chosen });
      await audit("BACKUP_FOLDER_CHANGED", "Backup copy folder changed", { before, after: chosen });
      // Make an encrypted copy right away so the boss sees at once whether the folder works.
      const result = (await readBackupKey()) ? await runBackup("manual", true) : undefined;
      return { ...(await snapshot()), result };
    }));

    ipcMain.handle("backup:set-password", guard(async (_e, password) => {
      const who = await ownerSession();
      if (!who.ok) return { ...(await snapshot()), ok: false, error: who.error };
      if (typeof password !== "string" || password.length < bcrypto.MIN_PASSWORD) return { ...(await snapshot()), ok: false, error: "TOO_SHORT" };
      if (password.length > 200) return { ...(await snapshot()), ok: false, error: "TOO_LONG" };
      const had = !!(await readBackupKey());
      const key = { ...(await bcrypto.createBackupKey(password)), setAt: Date.now() };
      await protect.writeProtected(keyBase(), JSON.stringify(key), log);
      backupKeyCache = key;
      await audit("BACKUP_PASSWORD_SET", had ? "Backup password changed" : "Backup password set", { changed: had });
      const result = getConfig().extraDir ? await runBackup("manual", true) : undefined;
      return { ...(await snapshot()), ok: true, result };
    }));

    ipcMain.handle("backup:remove-password", guard(async () => {
      const who = await ownerSession();
      if (!who.ok) return { ...(await snapshot()), error: who.error };
      const r = await dialog.showMessageBox(ctx.getWin(), {
        type: "warning",
        title: "备份密码 · Backup password",
        message: "删除备份密码？\nRemove the backup password?",
        detail:
          "删除后不会再往 USB / 云盘文件夹写入副本。已有的加密副本仍需要原来的密码才能打开。\n" +
          "Copies will no longer be written to the USB / cloud folder. Existing encrypted copies still need the old password.",
        buttons: ["删除 Remove", "取消 Cancel"],
        defaultId: 1,
        cancelId: 1,
      });
      if (r.response !== 0) return await snapshot();
      protect.removeProtected(keyBase());
      backupKeyCache = null;
      await audit("BACKUP_PASSWORD_REMOVED", "Backup password removed", {});
      return await snapshot();
    }));

    ipcMain.handle("backup:delete-plain-extra", guard(async () => {
      const who = await ownerSession();
      if (!who.ok) return { ...(await snapshot()), error: who.error };
      const cfg = getConfig();
      if (!cfg.extraDir) return await snapshot();
      // Only when an encrypted copy really is in THIS folder: extraOk alone can be stale (v0.3.28
      // set it after a plain copy; changing the folder or swapping the USB stick keeps it).
      // 【中文】必须确认当前文件夹里真的有加密副本（.db.enc）且已设置备份密码，才允许删除未加密副本。
      const st = getStatus();
      if (
        !(await readBackupKey()) ||
        st.extraOk !== true ||
        typeof st.extraLastFile !== "string" ||
        !ENC_RE.test(st.extraLastFile) ||
        !fs.existsSync(path.join(cfg.extraDir, st.extraLastFile))
      ) return { ...(await snapshot()), error: "NO_ENCRYPTED_COPY" };
      const plain = fs.readdirSync(cfg.extraDir).filter((f) => AUTO_RE.test(f));
      const upDir = path.join(cfg.extraDir, "uploads");
      const plainPhotos = fs.existsSync(upDir)
        ? fs.readdirSync(upDir).filter((f) => UPLOAD_NAME.test(f) && fs.existsSync(path.join(upDir, f + ".enc")))
        : [];
      if (plain.length + plainPhotos.length === 0) return await snapshot();
      const r = await dialog.showMessageBox(ctx.getWin(), {
        type: "warning",
        title: "旧的未加密副本 · Old unencrypted copies",
        message: "删除 " + plain.length + " 个未加密的旧备份？\nDelete " + plain.length + " old unencrypted backup copies?",
        detail:
          cfg.extraDir + "\n\n加密副本（.db.enc）会保留。\nThe encrypted copies (.db.enc) are kept.",
        buttons: ["删除 Delete", "取消 Cancel"],
        defaultId: 1,
        cancelId: 1,
      });
      if (r.response !== 0) return await snapshot();
      let files = 0, photos = 0;
      for (const f of plain) { try { fs.unlinkSync(path.join(cfg.extraDir, f)); files++; } catch {} }
      for (const f of plainPhotos) { try { fs.unlinkSync(path.join(upDir, f)); photos++; } catch {} }
      await audit("BACKUP_PLAIN_COPIES_DELETED", "Old unencrypted backup copies deleted", { folder: cfg.extraDir, files, photos });
      return await snapshot();
    }));

    ipcMain.handle("backup:run-now", guard(async () => {
      const r = await runBackup("manual", true);
      return { ...(await snapshot()), result: r };
    }));

    ipcMain.handle("backup:open-folder", guard(async () => {
      fs.mkdirSync(ctx.autoDir, { recursive: true });
      await shell.openPath(ctx.autoDir);
      return { ok: true };
    }));

    ipcMain.handle("backup:restore", guard(async (_e, name) => {
      if (typeof name !== "string" || !AUTO_RE.test(name)) return { ok: false, error: "invalid file" };
      const src = path.join(ctx.autoDir, name);
      if (!fs.existsSync(src)) return { ok: false, error: "file not found" };
      return restoreFlow({
        label: name,
        folder: ctx.autoDir,
        prepare: (tmp) => fsp.copyFile(src, tmp),
        photosFrom: ctx.autoDir,
      });
    }));

    ipcMain.handle("backup:pick-restore-file", guard(async () => {
      const r = await dialog.showOpenDialog(ctx.getWin(), {
        title: "选择要还原的备份文件 · Choose a backup file to restore",
        defaultPath: ctx.autoDir,
        properties: ["openFile"],
        filters: [
          { name: "Workshop POS backup (.db, .db.enc)", extensions: ["db", "enc"] },
          { name: "All files", extensions: ["*"] },
        ],
      });
      if (r.canceled || !r.filePaths[0]) return { ok: false, error: "cancelled" };
      const file = r.filePaths[0];
      const base = path.basename(file).toLowerCase();
      if (samePath(file, ctx.dbPath) || (samePath(path.dirname(file), ctx.dataDir) && base.startsWith("workshop.db"))) {
        return { ok: false, error: "LIVE_DB" };
      }
      const encrypted = bcrypto.isEncryptedBackupFile(file);
      if (!encrypted && !bcrypto.isSqliteFile(file)) return { ok: false, error: "NOT_A_BACKUP" };
      pendingPick = { id: crypto.randomBytes(16).toString("hex"), file, encrypted };
      return { ok: true, id: pendingPick.id, name: path.basename(file), encrypted };
    }));

    ipcMain.handle("backup:restore-file", guard(async (_e, args) => {
      const id = args && typeof args.id === "string" ? args.id : "";
      const password = args && typeof args.password === "string" ? args.password : "";
      const pick = pendingPick;
      if (!pick || pick.id !== id) return { ok: false, error: "invalid file" };
      if (pick.encrypted && !password) return { ok: false, error: "PASSWORD_REQUIRED" };
      const keyCache = new Map();
      return restoreFlow({
        label: path.basename(pick.file),
        folder: path.dirname(pick.file),
        prepare: (tmp) => (pick.encrypted ? bcrypto.decryptFile(pick.file, tmp, password, keyCache) : fsp.copyFile(pick.file, tmp)),
        photosFrom: path.dirname(pick.file),
        password: pick.encrypted ? password : null,
        keyCache,
      });
    }));
  }

  if (timer) clearInterval(timer);
  // unref: the timers never keep the process alive on their own (the window does).
  setTimeout(tick, 15 * 1000).unref(); // first check shortly after start
  timer = setInterval(tick, 30 * 60 * 1000); // then every 30 minutes
  timer.unref();
}

/** Called when the app quits (the server is still running: a VACUUM INTO snapshot, see snapshotDb). */
// 【中文】程序退出前做最后一次备份（服务器还在运行，用一致性快照；做不了快照时用经检查的文件复制）。
async function onQuit() {
  if (!ctx) return;
  if (timer) clearInterval(timer);
  timer = null;
  const cfg = getConfig();
  if (cfg.enabled) await runBackup("on-quit", false);
}

module.exports = { init, onQuit, readPendingRestore, clearPendingRestore, rollbackRestore, offlineRestore, EMERGENCY_ACTOR };
