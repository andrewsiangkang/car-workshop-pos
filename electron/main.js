const { app, BrowserWindow, Menu, dialog, shell, ipcMain, session } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const net = require("net");
const http = require("http");
const crypto = require("crypto");

let serverProc = null;
let win = null;
let currentPort = 0;
let paths = null;
let authSecret = null;
// HMAC proof that a request comes from this desktop window (see src/lib/accounts-local.ts):
// gives the shop computer its own login-lock bucket (LAN guessing cannot lock it out) and lets it
// set up without the code while phone access is on.
// 【中文】桌面窗口证明头：开启手机访问时，本机登录使用单独的限速桶，局域网设备猜密码锁不住桌面程序。
let desktopProof = "";
let crashTimes = []; // recent unexpected server exits (crash-policy.js)
let skipQuitBackup = false;
const backup = require("./backup");
const protect = require("./protect");
const crashPolicy = require("./crash-policy");
const updater = require("./updater");
const { RotatingLog } = require("./log-rotate");
const { onSecondInstance } = require("./second-instance");
const { runEmergencyRestore } = require("./emergency-restore");
const { readUpgradeNotices, markWarningsShown } = require("./upgrade-notice");

const CURRENT_VERSION = require("../package.json").version;
// 【中文】演示版（打包时 extraMetadata.workshopDemo=true）：不检查更新，标题标明“演示版”，只允许本机访问。
const IS_DEMO = (() => { try { return !!require("../package.json").workshopDemo; } catch { return false; } })();

// ===== Logs =====
// The embedded server's output and the desktop app's own notes go to data/logs/server.log
// (5 MB × 3 files), so support can see what happened on a shop PC.
// 【中文】内部服务器的输出和桌面程序的记录写到 data/logs/server.log（每个 5 MB，保留 3 个），方便技术支持排查。
function dataDirPath() {
  return path.join(app.getPath("userData"), "data");
}
function logFilePath() {
  return path.join(dataDirPath(), "logs", "server.log");
}
let logger = null;
function getLogger() {
  if (!logger) logger = new RotatingLog(logFilePath(), { maxBytes: 5 * 1024 * 1024, files: 3 });
  return logger;
}
function log(line) {
  try { getLogger().line("[desktop] " + line); } catch {}
  console.log(line);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// 【中文】找一个空闲端口来运行内部服务器。
function getFreePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

// 【中文】优先使用固定端口（正式版 3210，演示版 3211），这样手机书签、远程访问地址不会每次启动都变；
// 端口被占用时才退回随机端口。也可以用环境变量 WORKSHOP_PORT 指定。
function getPreferredPort() {
  const want = Number(process.env.WORKSHOP_PORT) || (IS_DEMO ? 3211 : 3210);
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(getFreePort()));
    s.listen(want, "127.0.0.1", () => s.close(() => resolve(want)));
  });
}

// 【中文】等待内部服务器可以访问；服务器进程中途退出就立即报错，不必等到超时。
function waitForServer(port, proc, timeoutMs = 60000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    let done = false;
    const onExit = (code) => finish(new Error("服务器启动失败 (exit " + code + ")"));
    const finish = (err) => {
      if (done) return;
      done = true;
      if (proc) proc.removeListener("exit", onExit);
      if (err) reject(err);
      else resolve();
    };
    if (proc) proc.once("exit", onExit);
    const tryOnce = () => {
      if (done) return;
      let retried = false;
      const next = () => { if (!retried) { retried = true; retry(); } };
      const req = http.get({ host: "127.0.0.1", port, path: "/", timeout: 2000 }, (res) => {
        res.resume();
        finish();
      });
      req.on("error", next);
      req.on("timeout", () => { req.destroy(); next(); });
    };
    const retry = () => {
      if (done) return;
      if (Date.now() - start > timeoutMs) return finish(new Error("服务器启动超时"));
      setTimeout(tryOnce, 300);
    };
    tryOnce();
  });
}

// 【中文】准备数据文件夹：数据放在用户目录，首次运行才复制空白模板数据库，升级或卸载程序都不会丢数据。
// 复制模板时先写临时文件再改名（断电也不会留下半个数据库）；0 字节的空数据库（里面没有资料）才会用模板修复，有资料的文件绝不覆盖。
function prepareData() {
  // 数据放在用户目录，升级/卸载程序不会丢失
  const dataDir = dataDirPath();
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, "workshop.db");
  let st = null;
  try { st = fs.statSync(dbPath); } catch {}
  const isNewInstall = !st;
  // A 0-byte workshop.db holds no data (e.g. power lost during the old, non-atomic first-run
  // copy), so it is replaced with the blank template. Unless a journal with content sits next
  // to it (SQLite may still need it), and never when the file has any data in it.
  let hotJournal = false;
  try { hotJournal = fs.statSync(dbPath + "-journal").size > 0; } catch {}
  if (!st || (st.size === 0 && !hotJournal)) {
    const template = app.isPackaged
      ? path.join(process.resourcesPath, "template.db")
      : path.join(__dirname, "..", "prisma", "template.db");
    if (!fs.existsSync(template)) throw new Error("找不到初始数据库: " + template);
    if (st) log("workshop.db is empty (0 bytes, no data): replacing it with the blank template");
    const tmp = dbPath + ".tmp";
    fs.copyFileSync(template, tmp);
    fs.renameSync(tmp, dbPath); // atomic: never half a database
  }
  return { dataDir, dbPath, isNewInstall };
}

// ===== Phone / tablet (LAN) access =====
// Off by default: the server only listens on this computer (127.0.0.1). The boss turns
// it on in Settings → Phone / Tablet; then it listens on all networks (0.0.0.0).
// 【中文】手机 / 平板访问开关：默认关闭，服务器只监听本机 127.0.0.1；老板在设置里打开后才监听 0.0.0.0（同一 Wi-Fi / Tailscale 可访问）。
function networkCfgFile() {
  return path.join(app.getPath("userData"), "data", "network-config.json");
}
function readNetworkConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(networkCfgFile(), "utf8"));
    return { exists: true, lanAccess: c.lanAccess === true };
  } catch {
    return { exists: false, lanAccess: false };
  }
}
function writeNetworkConfig(lanAccess) {
  fs.mkdirSync(path.dirname(networkCfgFile()), { recursive: true });
  fs.writeFileSync(networkCfgFile(), JSON.stringify({ lanAccess: lanAccess === true }, null, 2));
}
/** The demo build only ever listens on this computer (its logins are handed to prospects). */
function lanAccessOn() {
  return !IS_DEMO && readNetworkConfig().lanAccess;
}

// Only pages served by our own embedded server may call the desktop-only APIs.
function isAppUrl(url) {
  return typeof url === "string" && currentPort > 0 && url.startsWith("http://127.0.0.1:" + currentPort + "/");
}
function isAppSender(event) {
  return isAppUrl((event.senderFrame && event.senderFrame.url) || "");
}

// ===== External links =====
// Only https: links leave the app (opened in the normal browser). file:, smb:, javascript:,
// custom protocol handlers and the like are refused.
// 【中文】只允许用系统浏览器打开 https 网址；file:、smb:、javascript: 等其他协议一律拒绝。
function safeOpenExternal(url) {
  let u;
  try {
    u = new URL(String(url));
  } catch {
    return false;
  }
  if (u.protocol !== "https:") {
    log("blocked an external link with protocol " + u.protocol);
    return false;
  }
  shell.openExternal(u.toString()).catch(() => {});
  return true;
}

// Every window (also ones opened with window.open) may only show pages of the embedded
// server; anything else is blocked here and, if it is https, opened in the browser instead.
// 【中文】所有窗口只能显示本程序内部服务器的页面；其他网址被拦下（https 网址改用系统浏览器打开）。
app.on("web-contents-created", (_event, contents) => {
  contents.on("will-navigate", (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    safeOpenExternal(url);
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) return { action: "allow" };
    safeOpenExternal(url);
    return { action: "deny" };
  });
});

// 【中文】每台电脑首次运行时生成专属的登录签名密钥并保存。
function getAuthSecret(dataDir) {
  // Random per-installation secret used to sign login cookies
  const f = path.join(dataDir, "auth-secret");
  try {
    const v = fs.readFileSync(f, "utf8").trim();
    if (v.length >= 32) return v;
  } catch {}
  const v = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(f, v, { mode: 0o600 });
  return v;
}

// 【中文】每台电脑首次运行时生成「数据钥匙」，用来加密数据库里的 MyInvois 密钥；钥匙用 Windows DPAPI（safeStorage）保护，
// 不在数据库里，所以数据库或备份文件被拿走也解不开。
async function getDataKey(dataDir) {
  const base = path.join(dataDir, "data-key");
  let v = null;
  try {
    v = await protect.readProtected(base);
  } catch (e) {
    if (e.code === "LOCKED") {
      // safeStorage not available right now: start without the key, never destroy it.
      log(e.message + "; saved secrets cannot be opened in this session");
      return null;
    }
    // This Windows account cannot decrypt it (e.g. the data folder came from another PC).
    // Keep the file for support and make a new key; the boss enters the MyInvois secret again.
    const keep = base + ".enc.unreadable-" + Date.now();
    try { fs.renameSync(base + ".enc", keep); } catch {}
    log(e.message + "; moved to " + path.basename(keep) + " and created a new data key");
  }
  if (v && /^[0-9a-f]{64}$/.test(v)) {
    // A key saved as a plain file earlier is moved under DPAPI once that is available.
    if (!fs.existsSync(base + ".enc") && (await protect.canProtect())) await protect.writeProtected(base, v, log);
    return v;
  }
  v = crypto.randomBytes(32).toString("hex");
  await protect.writeProtected(base, v, log);
  return v;
}

/** Folder of the embedded Next.js server (and of the Prisma client the emergency check uses). */
function serverDirPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "app-server")
    : path.join(__dirname, "..", ".next", "standalone");
}

// 【中文】启动内置的 Next.js 服务器，输出写入日志文件，崩溃时按退避策略自动重启；默认只监听本机，打开「手机 / 平板访问」后才监听 0.0.0.0。
async function startServer() {
  const { dataDir, dbPath, isNewInstall } = prepareData();
  paths = { dataDir, dbPath, isNewInstall: paths ? paths.isNewInstall : isNewInstall };
  authSecret = getAuthSecret(dataDir);
  desktopProof = crypto.createHmac("sha256", authSecret).update("workshop-desktop-v1").digest("hex");
  const dataKey = await getDataKey(dataDir);
  const lanAccess = lanAccessOn();
  const port = await getPreferredPort();
  const serverDir = serverDirPath();

  const proc = spawn(process.execPath, [path.join(serverDir, "server.js")], {
    cwd: serverDir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: lanAccess ? "0.0.0.0" : "127.0.0.1",
      WORKSHOP_LAN_ACCESS: lanAccess ? "1" : "0",
      DATABASE_URL: "file:" + dbPath.replace(/\\/g, "/"),
      WORKSHOP_DATA_DIR: dataDir,
      AUTH_SECRET: authSecret,
      // Key for secrets stored in the database (src/lib/secret-box.ts); never in the database itself.
      WORKSHOP_DATA_KEY: dataKey || "",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  serverProc = proc;
  log("server starting (pid " + proc.pid + ", port " + port + ", v" + CURRENT_VERSION + ")");
  const out = getLogger();
  proc.stdout.on("data", (c) => out.write(c));
  proc.stderr.on("data", (c) => out.write(c));
  proc.on("error", (e) => log("server process error: " + e.message));
  proc.on("exit", (code, signal) => onServerExit(proc, code, signal));
  try {
    await waitForServer(port, proc);
  } catch (e) {
    log("server did not start: " + e.message);
    if (serverProc === proc) serverProc = null;
    await killAndWait(proc);
    throw e;
  }
  proc.ready = true;
  currentPort = port;
  return port;
}

/** Stop a server process and wait until it has exited (it holds the database file open). */
function killAndWait(proc, timeoutMs = 10000) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
      setTimeout(resolve, 1000);
    }, timeoutMs);
    proc.once("exit", () => { clearTimeout(t); resolve(); });
    try { proc.kill(); } catch { clearTimeout(t); resolve(); }
  });
}

/** Stop the running server on purpose (restore, phone-access switch): not treated as a crash. */
function stopServer() {
  const proc = serverProc;
  serverProc = null;
  return killAndWait(proc);
}

// 【中文】内部服务器意外退出：写日志，按 1 秒、5 秒、15 秒、60 秒的间隔自动重启；10 分钟内崩溃 5 次就停止并提示日志文件位置。
function onServerExit(proc, code, signal) {
  log("server exited (code " + code + (signal ? ", signal " + signal : "") + ")");
  // Replaced on purpose, quitting, or still starting (startServer's caller handles that).
  if (proc !== serverProc || app.isQuitting || !proc.ready) return;
  serverProc = null;
  scheduleRestart();
}

function scheduleRestart() {
  const d = crashPolicy.onCrash(crashTimes, Date.now());
  crashTimes = d.recent;
  if (d.giveUp) return giveUpAfterCrashes();
  log("restarting the server in " + d.delayMs / 1000 + " s (" + d.recent.length + " stop(s) in 10 minutes)");
  setTimeout(restartAfterCrash, d.delayMs);
}

async function restartAfterCrash() {
  if (app.isQuitting) return;
  try {
    const port = await startServer();
    if (win && !win.isDestroyed()) {
      updateTitle();
      win.loadURL("http://127.0.0.1:" + port + "/");
    }
  } catch (e) {
    log("server restart failed: " + ((e && e.message) || e));
    scheduleRestart();
  }
}

function giveUpAfterCrashes() {
  const f = logFilePath();
  log("the server stopped " + crashPolicy.MAX_CRASHES + " times in 10 minutes: giving up");
  app.isQuitting = true;
  skipQuitBackup = true; // the database may be the problem; keep the existing backups as they are
  const opts = {
    type: "error",
    title: "修车店 POS",
    message:
      "内部服务器在 10 分钟内停止了 5 次，程序将关闭。\n" +
      "The POS server stopped 5 times in 10 minutes, so the app will close.",
    detail:
      "请重新启动电脑后再打开程序。如果还是不行，请把这个日志文件发给技术支持：\n" +
      "Restart the computer and open the app again. If it still fails, send this log file to support:\n\n" + f +
      "\n\n如果资料文件已损坏，可以用「还原备份…」放回一个备份（不需要登录）。\n" +
      "If the data file is damaged, \"Restore a backup…\" puts a backup back (no login needed).",
    buttons: ["打开日志文件夹 Open log folder", "还原备份… Restore a backup…", "关闭 Close"],
    defaultId: 0,
    cancelId: 2,
  };
  const shown = win && !win.isDestroyed() ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts);
  shown
    .then(async (r) => {
      if (r.response === 0) shell.showItemInFolder(f);
      if (r.response === 1) await emergencyRestore("crashed");
    })
    .catch((e) => log("crash dialog: " + ((e && e.message) || e)))
    .finally(() => app.quit());
}

let emergencyRunning = false;
/**
 * Restore a backup without the server (it cannot start). Only from native dialogs of this
 * process: start failure, crash give-up, or the --restore-backup switch. On success the app
 * starts again on the restored data (the server records the restore in the audit log).
 * 【中文】服务器无法启动时的紧急还原（不需要登录）；只能从桌面程序自己的对话框或 --restore-backup 启动参数进入。
 */
async function emergencyRestore(reason) {
  if (emergencyRunning) return "busy";
  emergencyRunning = true;
  try {
    log("emergency restore offered (" + reason + ")");
    await stopServer(); // never swap the file under a running server
    const dataDir = dataDirPath();
    fs.mkdirSync(dataDir, { recursive: true });
    const result = await runEmergencyRestore({
      dataDir,
      dbPath: path.join(dataDir, "workshop.db"),
      serverDir: serverDirPath(),
      parent: win,
      log,
    });
    log("emergency restore: " + result);
    if (result === "restored") {
      // Start again normally (without --restore-backup, or it would ask again).
      app.relaunch({ args: process.argv.slice(1).filter((a) => a !== "--restore-backup") });
      app.exit(0);
    }
    return result;
  } catch (e) {
    log("emergency restore failed: " + ((e && e.message) || e));
    dialog.showErrorBox("修车店 POS", "还原没有完成，资料没有改变。\nThe restore did not finish. Your data was not changed.\n\n" + String((e && e.message) || e));
    return "failed";
  } finally {
    emergencyRunning = false;
  }
}

// 【中文】切换「手机 / 平板访问」后重启内置服务器（换监听地址），再重新打开设置页。
async function restartServer() {
  await stopServer(); // its exit is not treated as a crash
  const port = await startServer();
  if (win && !win.isDestroyed()) {
    updateTitle();
    win.loadURL("http://127.0.0.1:" + port + "/settings?tab=connect");
  }
  return port;
}

function updateTitle() {
  if (!win || win.isDestroyed()) return;
  const name = (IS_DEMO ? "【演示版】" : "") + "修车店 POS";
  win.setTitle(
    lanAccessOn() ? name + "  ·  手机: http://" + getLocalIP() + ":" + currentPort : name
  );
}

ipcMain.handle("network:get", async (event) => {
  if (!isAppSender(event)) return { error: "forbidden" };
  return { lanAccess: lanAccessOn(), port: currentPort };
});

ipcMain.handle("network:set", async (event, enabled) => {
  if (!isAppSender(event)) return { ok: false, error: "forbidden" };
  if (typeof enabled !== "boolean") return { ok: false, error: "invalid" };
  if (IS_DEMO && enabled) {
    await dialog.showMessageBox(win, {
      type: "info",
      title: "手机 / 平板访问 · Phone & tablet access",
      message: "演示版只能在这台电脑上使用。\nThe demo version only works on this computer.",
    });
    return { ok: false, error: "cancelled" };
  }
  if (lanAccessOn() === enabled) return { ok: true, lanAccess: enabled };
  if (enabled) {
    // Confirmed in a native dialog, so only someone at this computer can switch it on.
    const r = await dialog.showMessageBox(win, {
      type: "warning",
      title: "手机 / 平板访问 · Phone & tablet access",
      message:
        "打开后，连上同一个 Wi-Fi（或 Tailscale）的任何设备都能打开 POS 登录页。\n" +
        "Anyone on the same Wi-Fi (or Tailscale) will be able to reach the POS login page.",
      detail:
        "只在员工专用的 Wi-Fi 上打开，顾客请用另一个访客 Wi-Fi（Guest Wi-Fi）。每个账号都要用强密码。\n" +
        "Only turn this on for a staff-only Wi-Fi; give customers a separate guest Wi-Fi. Use a strong password on every account.\n\n" +
        "注意：收据上的「顾客自助 e-Invoice」二维码只对能连到这台电脑的手机有效。\n" +
        "Note: the customer e-Invoice QR on receipts only works for phones that can reach this computer.\n\n" +
        "程序会重新启动内部服务器（约几秒）。 The internal server will restart (a few seconds).",
      buttons: ["打开 Turn on", "取消 Cancel"],
      defaultId: 1,
      cancelId: 1,
    });
    if (r.response !== 0) return { ok: false, error: "cancelled" };
  }
  writeNetworkConfig(enabled);
  setTimeout(() => {
    restartServer().catch((e) => {
      dialog.showErrorBox("修车店 POS", "服务重启失败，请手动重新打开程序。\n" + String((e && e.message) || e));
      app.quit();
    });
  }, 200);
  return { ok: true, lanAccess: enabled, restarting: true };
});


// ===== Update check and verified install (GitHub Releases) =====
// Public GitHub repo whose latest Release is compared with this version. Set UPDATE_REPO="" to disable.
const GITHUB_REPO = process.env.UPDATE_REPO !== undefined ? process.env.UPDATE_REPO : "andrewsiangkang/car-workshop-pos";
/** Installers are downloaded here (only this Windows user can write it), never to the shared Temp folder. */
function updateDir() {
  return path.join(app.getPath("userData"), "updates");
}
let updateBusy = false;
let pendingInstaller = null; // { file, sha256 }: started once the app has closed (after the final backup)

/** Returns { current, latest, hasUpdate, pageUrl, canInstall } or { current, error }. */
async function getLatestRelease() {
  const r = await updater.getLatestRelease(GITHUB_REPO, CURRENT_VERSION);
  if (r.error) return r;
  return {
    current: r.current,
    latest: r.latest,
    hasUpdate: r.hasUpdate,
    pageUrl: r.pageUrl,
    canInstall: !!(r.installer && (r.installer.checksumUrl || r.installer.latestJsonUrl)),
    installer: r.installer,
  };
}

function updateErrorText(code) {
  switch (code) {
    case "NO_CHECKSUM":
    case "CHECKSUM_CONFLICT":
      return "这个版本没有可核对的校验值，为了安全不会安装。请联系技术支持。\nThis release has no checksum to check the installer against, so it will not be installed. Contact support.";
    case "CHECKSUM_MISMATCH":
      return "下载的安装程序和发布的校验值不一致（下载损坏或被替换），已删除，不会安装。\nThe downloaded installer does not match the published checksum (damaged or replaced download). It was deleted and will not be run.";
    case "NO_INSTALLER":
      return "这个版本没有 Windows 安装程序。\nThis release has no Windows installer.";
    default:
      return "下载失败，请检查网络后再试。\nThe download failed. Check the internet connection and try again.";
  }
}

/**
 * Download the new installer, check its SHA-256 against the value published with the release,
 * and start it after the app has closed. Every step is confirmed in a native dialog.
 * 【中文】下载新的安装程序，核对发布时附带的 SHA-256，一致才在程序关闭后运行；不一致就删除并拒绝。
 */
async function installUpdate(r) {
  if (IS_DEMO) return { ok: false, error: "demo" };
  if (!app.isPackaged) return { ok: false, error: "NOT_PACKAGED" };
  if (updateBusy) return { ok: false, error: "busy" };
  updateBusy = true;
  const progress = (p) => { try { if (win && !win.isDestroyed()) win.setProgressBar(p); } catch {} };
  try {
    const rel = r && r.installer ? r : await getLatestRelease();
    if (rel.error || !rel.hasUpdate) return { ok: false, error: rel.error ? "DOWNLOAD_FAILED" : "NO_UPDATE" };
    updater.cleanUpdateDir(updateDir());
    log("downloading update " + rel.latest);
    const got = await updater.downloadVerifiedInstaller(rel.installer, updateDir(), {
      headers: { "User-Agent": "WorkshopPOS/" + CURRENT_VERSION },
      onProgress: (n, total) => { if (total) progress(Math.min(1, n / total)); },
    });
    progress(-1);
    if (!got.ok) {
      log("update " + rel.latest + " refused: " + got.error + (got.detail ? " (" + got.detail + ")" : ""));
      await dialog.showMessageBox(win, { type: "error", title: "更新 · Update", message: updateErrorText(got.error) });
      return { ok: false, error: got.error };
    }
    log("update " + rel.latest + " downloaded and verified (sha256 " + got.sha256 + ")");
    const ask = await dialog.showMessageBox(win, {
      type: "question",
      title: "更新 · Update",
      message: "新版本 " + rel.latest + " 已下载并通过校验。现在安装？\nVersion " + rel.latest + " was downloaded and checked. Install it now?",
      detail:
        "程序会先做最后一次备份再关闭，然后打开安装程序。你的资料不会丢失。\n" +
        "The app makes a final backup and closes, then the installer opens. Your data is kept.",
      buttons: ["现在安装 Install now", "稍后 Later"],
      defaultId: 0,
      cancelId: 1,
    });
    if (ask.response !== 0) {
      updater.cleanUpdateDir(updateDir());
      return { ok: false, error: "cancelled" };
    }
    pendingInstaller = { file: got.file, sha256: got.sha256 };
    setTimeout(() => app.quit(), 100);
    return { ok: true };
  } catch (e) {
    progress(-1);
    log("update failed: " + ((e && e.message) || e));
    return { ok: false, error: "DOWNLOAD_FAILED" };
  } finally {
    updateBusy = false;
  }
}

/** Called while the app exits: check the saved installer once more, then start it. */
async function launchPendingInstaller() {
  const p = pendingInstaller;
  pendingInstaller = null;
  if (!p) return;
  if (!(await updater.recheckInstaller(p.file, p.sha256))) {
    log("update installer changed on disk after it was checked: not started");
    return;
  }
  // Opened through the Windows shell (not spawn), so Windows can ask for permission when the
  // installer needs it.
  const err = await shell.openPath(p.file).catch((e) => String((e && e.message) || e));
  log(err ? "update installer could not be started: " + err : "update installer started: " + path.basename(p.file));
}

// 【中文】检查更新：向 GitHub 查询最新发布的版本，有新版本就提示下载（下载后核对校验值才安装）。
async function checkForUpdates() {
  if (IS_DEMO) return;
  if (!app.isPackaged) return; // only in the installed app
  const r = await getLatestRelease();
  if (r.error || !r.hasUpdate) return;
  if (!win || win.isDestroyed()) return;
  const result = await dialog.showMessageBox(win, {
    type: "info",
    title: "发现新版本 / New version",
    message: "有新版本可用：" + r.latest + "\nA new version is available: " + r.latest,
    detail:
      "当前版本：" + r.current + "\n\n点「下载并安装」会下载新的安装程序，并先核对校验值。你的资料不会丢失。\n" +
      "Current version: " + r.current + "\n\n\"Download and install\" downloads the new installer and checks it first. Your data is kept.",
    buttons: ["下载并安装 Download and install", "稍后提醒 Later"],
    defaultId: 0,
    cancelId: 1,
  });
  if (result.response === 0) await installUpdate(r);
}

ipcMain.handle("window:refocus", (event) => {
  if (!isAppSender(event)) return false;
  if (win && !win.isDestroyed()) {
    win.blur();
    win.focus();
    win.webContents.focus();
  }
  return true;
});

ipcMain.handle("update:check", async (event) => {
  if (!isAppSender(event)) return { error: "forbidden" };
  // The demo never installs updates (installUpdate refuses): say so instead of offering a button
  // that cannot work. 【中文】演示版不安装更新，直接告诉用户，不显示无法使用的按钮。
  if (IS_DEMO) return { current: CURRENT_VERSION, demo: true };
  const r = await getLatestRelease();
  if (r.error) return { current: r.current, error: r.error };
  return { current: r.current, latest: r.latest, hasUpdate: r.hasUpdate, pageUrl: r.pageUrl, canInstall: r.canInstall };
});

// Settings → Version & updates: download, verify and install (confirmed in native dialogs).
ipcMain.handle("update:install", async (event) => {
  if (!isAppSender(event)) return { ok: false, error: "forbidden" };
  return installUpdate(null);
});

// Only the release page opens in the browser (never a direct installer download, which would skip the check).
ipcMain.handle("update:open", async (event, url) => {
  if (!isAppSender(event)) return false;
  if (typeof url === "string" && url.startsWith("https://github.com/" + GITHUB_REPO + "/releases") && !/\.exe($|\?)/i.test(url)) {
    return safeOpenExternal(url);
  }
  return false;
});

/** The app window's login cookie (sent with desktop → server calls that need the boss). */
async function getSessionCookie() {
  if (!currentPort) return null;
  const list = await session.defaultSession.cookies.get({ url: "http://127.0.0.1:" + currentPort + "/", name: "session" });
  return list && list[0] ? list[0].value : null;
}

// 【中文】启动服务器；如果上次「还原备份」后服务器无法打开新数据库，就自动放回还原前的安全副本再启动。
async function startFirstServer() {
  const dataDir = dataDirPath();
  const pending = backup.readPendingRestore(dataDir);
  try {
    const port = await startServer();
    if (pending) backup.clearPendingRestore(dataDir);
    return { port, rolledBack: false };
  } catch (e) {
    if (!pending) throw e;
    log("the server did not start on the restored database (" + e.message + "): putting the safety copy back");
    await backup.rollbackRestore(dataDir, path.join(dataDir, "workshop.db"), pending);
    return { port: await startServer(), rolledBack: true };
  }
}

function getLocalIP() {
  const os = require("os");
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "127.0.0.1";
}

// 【中文】主流程：准备数据 → 启动服务器 → 打开窗口 → 启动自动备份 → 检查更新。
async function createWindow() {
  try {
    log("app start v" + CURRENT_VERSION + (IS_DEMO ? " (demo)" : ""));
    const { port, rolledBack } = await startFirstServer();
    win = new BrowserWindow({
      width: 1366,
      height: 860,
      title: "修车店 POS",
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(__dirname, "preload.js"),
        backgroundThrottling: false,
      },
    });
    // Restore focus when window is shown or activated
    win.on("focus", () => {
      if (win && !win.isDestroyed()) win.webContents.focus();
    });
    // The app keeps running for up to 60 s after the window closes (final backup): never use
    // the destroyed window object after that.
    win.on("closed", () => { win = null; });
    Menu.setApplicationMenu(null);
    // Allow reload if page freezes
    win.webContents.on("before-input-event", (event, input) => {
      if (input.key === "F5" || (input.control && input.key === "r")) {
        win.webContents.reload();
        event.preventDefault();
      }
    });
    // Links and new windows: see the "web-contents-created" guard (only our server's pages).
    win.loadURL("http://127.0.0.1:" + port + "/");
    backup.init({
      dataDir: paths.dataDir,
      dbPath: paths.dbPath,
      getWin: () => win,
      isAllowedSender: isAppSender,
      getPort: () => (serverProc && serverProc.ready ? currentPort : 0),
      getAuthSecret: () => authSecret,
      getSessionCookie,
      stopServer,
      log,
    });
    if (rolledBack) {
      setTimeout(() => {
        if (!win || win.isDestroyed()) return;
        dialog.showMessageBox(win, {
          type: "warning",
          title: "修车店 POS",
          message:
            "还原的备份无法打开，已自动放回还原前的资料。\n" +
            "The restored backup could not be opened, so the data from before the restore was put back.",
          detail: "详情请看日志文件 / Details are in the log file:\n" + logFilePath(),
        });
      }, 1500);
    }
    // Phone address in the title only while phone / tablet access is on.
    // Non-blocking info in title only; avoid modal dialog that can steal focus
    updateTitle();
    setTimeout(updateTitle, 500);
    // v0.3.28: phone / tablet access became opt-in. Tell existing shops once, so staff
    // phones that stop connecting after the update are not a mystery.
    // 【中文】v0.3.28 起手机访问默认关闭；老用户升级后提示一次去哪里打开。
    if (!readNetworkConfig().exists) {
      writeNetworkConfig(false);
      if (!paths.isNewInstall) {
        setTimeout(() => {
          if (!win || win.isDestroyed()) return;
          dialog.showMessageBox(win, {
            type: "info",
            title: "修车店 POS",
            message: "为了安全，手机 / 平板访问现在默认关闭。\nFor security, phone / tablet access is now off by default.",
            detail:
              "需要用手机或平板开单的话，老板可在 设置 → Phone / Tablet 打开。\n" +
              "If staff use phones or tablets, the boss can turn it on in Settings → Phone / Tablet.",
          });
        }, 5000);
      }
    }
    // After the automatic database upgrade: a failure is a warning (the original data is
    // untouched and the upgrade is tried again); skipped duplicate-number indexes are a calm
    // notice shown once. 【中文】数据库升级失败 → 警告；有重复单号而跳过唯一索引 → 平和的提示（只显示一次）。
    setTimeout(() => {
      try {
        if (!win || win.isDestroyed()) return;
        const n = readUpgradeNotices(dataDirPath());
        if (n.errorFile) {
          dialog.showMessageBox(win, {
            type: "warning",
            title: "修车店 POS",
            message: "数据库升级失败，部分新功能可能无法使用。\nThe database upgrade failed; some new features may not work.",
            detail:
              "你的原有数据没有被改动，升级前已自动备份。程序会自动再试。如果每次打开都出现，请把此情况告诉技术支持。\n" +
              "Your data was not changed and a backup was made first. The upgrade is tried again automatically. If this appears every time, tell support.\n\n" +
              "详情文件 / Details: " + n.errorFile,
          }).catch(() => {});
        } else if (n.warnings) {
          const w = n.warnings;
          dialog.showMessageBox(win, {
            type: "info",
            title: "修车店 POS",
            message:
              "数据库已升级。旧资料里有几个单据号码重复，所以「单号不可重复」的额外保护暂时没有打开。\n" +
              "The database was upgraded. A few document numbers appear twice in your old records, so the extra \"no duplicate numbers\" protection was not switched on.",
            detail:
              "程序照常使用，资料没有改变。需要清理重复号码时请联系技术支持。\n" +
              "The app works as before and no data was changed. Contact support if you want the duplicates sorted out.\n\n" +
              w.lines.slice(0, 5).join("\n"),
            buttons: ["知道了 OK", "查看详情 Show details"],
            defaultId: 0,
            cancelId: 0,
          })
            .then((r) => {
              markWarningsShown(dataDirPath(), w.key);
              if (r.response === 1) shell.openPath(w.file).catch(() => {});
            })
            .catch(() => {});
        }
      } catch {}
    }, 8000);
    // Check for updates after window is ready
    win.webContents.once("did-finish-load", () => {
      setTimeout(checkForUpdates, 3000);
    });
  } catch (e) {
    log("start failed: " + String(e && e.message ? e.message : e));
    skipQuitBackup = true;
    // Offer the emergency restore: when the database is the problem, nobody can log in to restore.
    const opts = {
      type: "error",
      title: "修车店 POS 启动失败 · The POS could not start",
      message: "修车店 POS 启动失败。\nThe POS could not start.",
      detail:
        String(e && e.message ? e.message : e) + "\n\n日志文件 / Log file:\n" + logFilePath() +
        "\n\n如果资料文件已损坏，可以用「还原备份…」放回一个备份（不需要登录）。\n" +
        "If the data file is damaged, \"Restore a backup…\" puts a backup back (no login needed).",
      buttons: ["关闭 Close", "还原备份… Restore a backup…"],
      defaultId: 0,
      cancelId: 0,
    };
    try {
      const r = await (win && !win.isDestroyed() ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts));
      if (r.response === 1) await emergencyRestore("start failed");
    } catch (err) {
      log("start-failure dialog: " + ((err && err.message) || err));
    }
    app.quit();
  }
}

let quitStage = 0; // 0 = running, 1 = final backup in progress, 2 = ready to exit
let reopenAfterQuit = false;
// 【中文】再次双击程序：窗口还在就把它调到前面；如果窗口已关闭、正在做最后一次备份，就在备份完成后自动重新打开程序。
app.on("second-instance", () => {
  if (onSecondInstance(win, quitStage) === "reopen-after-quit") {
    reopenAfterQuit = true;
    log("opened again while the final backup runs: the app starts again when it is done");
  }
});
app.whenReady().then(() => {
  // Sent only to our own embedded server over loopback (isAppUrl), never to other sites.
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const h = details.requestHeaders;
    if (desktopProof && isAppUrl(details.url)) h["X-Workshop-Desktop"] = desktopProof;
    callback({ requestHeaders: h });
  });
  if (!gotLock) return; // a second copy only hands over to the first one
  // --restore-backup: support can start the app straight into the emergency restore (for a
  // database that starts but cannot be used). Still confirmed step by step in native dialogs.
  // 【中文】--restore-backup 启动参数：直接进入紧急还原（仍需在原生对话框里逐步确认）；取消就照常启动。
  if (process.argv.includes("--restore-backup")) {
    emergencyRestore("--restore-backup").then((r) => { if (r !== "restored") createWindow(); });
    return;
  }
  createWindow();
});
// 【中文】退出：先等最后一次备份完成（服务器还在运行，用一致性快照，最多等 60 秒），再关闭服务器。
app.on("before-quit", (event) => {
  app.isQuitting = true;
  if (quitStage === 2 || !gotLock) {
    if (serverProc) { try { serverProc.kill(); } catch {} }
    return;
  }
  event.preventDefault();
  if (quitStage === 1) return;
  quitStage = 1;
  const work = skipQuitBackup ? Promise.resolve() : backup.onQuit();
  Promise.race([work, new Promise((r) => setTimeout(r, 60000))])
    .catch((e) => log("final backup: " + ((e && e.message) || e)))
    .then(() => launchPendingInstaller()) // a verified update: started as this process exits
    .catch((e) => log("update installer: " + ((e && e.message) || e)))
    .finally(() => {
      quitStage = 2;
      if (reopenAfterQuit) app.relaunch(); // takes effect when this process exits
      app.quit();
    });
});
// The emergency restore may run with no main window (only its own small password window).
app.on("window-all-closed", () => { if (!emergencyRunning) app.quit(); });
