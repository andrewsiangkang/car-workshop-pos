// Emergency restore: put a backup back when the POS server cannot start (so nobody can log in
// and Settings → Backup cannot be opened). Offered by main.js in the "could not start" and
// "stopped 5 times" dialogs, and with the --restore-backup switch. Everything happens in native
// dialogs of the desktop app; nothing in the web page can start it.
// Steps: choose the file → backup password for .db.enc (small local window) → copy / decrypt →
// integrity check in a separate process (db-check.js) → confirmation showing what the backup
// holds → safety copy of the current data → swap → main.js relaunches the app.
// 【中文】紧急还原：服务器无法启动（无法登录、打不开设置页）时还原备份。只在桌面程序的原生对话框里进行，网页无法调用。
// 步骤：选择文件 → 加密备份输入备份密码 → 复制/解密 → 在独立进程里做完整性检查 → 确认 → 保存当前资料的安全副本 → 替换 → 重新启动。
const { dialog, BrowserWindow, ipcMain } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const backup = require("./backup");
const bcrypto = require("./backup-crypto");

const CHECK_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_PASSWORD_TRIES = 5;

/** db-check.js, preferring the copy electron-builder unpacks next to app.asar (asarUnpack). */
function helperPath() {
  const inAsar = path.join(__dirname, "db-check.js");
  const unpacked = inAsar.replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
  return unpacked !== inAsar && fs.existsSync(unpacked) ? unpacked : inAsar;
}

/** Run db-check.js in its own process (Electron as Node, like the server). Never rejects. */
function checkFile(file, serverDir, log) {
  return new Promise((resolve) => {
    let out = "";
    let finished = false;
    let timer = null;
    const finish = (r) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      resolve(r);
    };
    let proc;
    try {
      proc = spawn(process.execPath, [helperPath(), file, serverDir], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (e) {
      return finish({ ok: false, error: e.message });
    }
    timer = setTimeout(() => {
      try { proc.kill(); } catch {}
      finish({ ok: false, error: "the check took too long" });
    }, CHECK_TIMEOUT_MS);
    proc.stdout.on("data", (c) => {
      out = (out + c).slice(-64 * 1024);
    });
    proc.stderr.on("data", (c) => {
      if (log) log("[db-check] " + String(c).trim().slice(0, 500));
    });
    proc.on("error", (e) => finish({ ok: false, error: e.message }));
    proc.on("close", () => {
      try {
        finish(JSON.parse(out.trim().split("\n").pop()));
      } catch {
        finish({ ok: false, error: "the check gave no answer" });
      }
    });
  });
}

/**
 * Ask for the backup password in a small local window (a native dialog has no text box).
 * Resolves the password, or null when cancelled / closed. Answers are accepted only from
 * this window's own page.
 */
function askPassword(parent, fileName) {
  return new Promise((resolve) => {
    const w = new BrowserWindow({
      width: 480,
      height: 270,
      parent: parent || undefined,
      modal: !!parent,
      resizable: false,
      minimizable: false,
      maximizable: false,
      show: false,
      autoHideMenuBar: true,
      title: "备份密码 · Backup password",
      webPreferences: {
        preload: path.join(__dirname, "password-preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    const wcId = w.webContents.id;
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      ipcMain.removeListener("emergency-restore:password", onAnswer);
      if (!w.isDestroyed()) w.destroy();
      resolve(value);
    };
    function onAnswer(event, password) {
      if (!event || !event.sender || event.sender.id !== wcId) return;
      done(typeof password === "string" && password.length > 0 && password.length <= 200 ? password : null);
    }
    ipcMain.on("emergency-restore:password", onAnswer);
    w.on("closed", () => done(null));
    w.once("ready-to-show", () => w.show());
    w.loadFile(path.join(__dirname, "password-prompt.html"), { query: { file: String(fileName || "") } }).catch(() => done(null));
  });
}

function fmtDate(iso) {
  try {
    return iso ? new Date(iso).toLocaleString() : "";
  } catch {
    return "";
  }
}

/** Plain-language reason for a refused restore (Chinese + English, like the other desktop dialogs). */
function explain(r) {
  const detail = r.detail ? "\n\n" + String(r.detail).slice(0, 300) : "";
  switch (r.error) {
    case "NOT_A_BACKUP":
      return "这不是本程序的备份文件。\nThis is not a backup file of this app.";
    case "LIVE_DB":
      return "这是正在使用的数据库文件，请选择一个备份文件。\nThis is the database file in use. Choose a backup file.";
    case "WRONG_PASSWORD":
      return "备份密码不对，资料没有改变。\nThat backup password is not right. Your data was not changed.";
    case "DAMAGED":
      return "这个加密备份已损坏或被改动过，请换一个备份。\nThis encrypted backup is damaged or was changed. Choose another backup.";
    case "VERIFY_FAILED":
      if (/ENGINE_MISSING/.test(String(r.detail))) {
        return "无法检查备份文件：程序文件不完整。请重新安装本程序（资料不会丢失），然后再试。\nThe backup could not be checked because the app's files are incomplete. Reinstall the app (your data is kept) and try again." + detail;
      }
      return "备份文件没有通过检查（可能已损坏），资料没有改变。请换一个备份。\nThe backup did not pass the check (it may be damaged). Your data was not changed. Choose another backup." + detail;
    case "SAFETY_COPY_FAILED":
      return "无法保存当前资料的安全副本，请检查硬盘空间。资料没有改变。\nThe safety copy of the current data could not be saved. Check the free disk space. Your data was not changed." + detail;
    default:
      return "还原没有完成，资料没有改变。\nThe restore did not finish. Your data was not changed." + detail;
  }
}

/**
 * The whole emergency restore. Resolves "restored" (the caller relaunches the app),
 * "cancelled" or "failed". The embedded server must not be running.
 * opts: { dataDir, dbPath, serverDir, parent?, log? }
 */
async function runEmergencyRestore({ dataDir, dbPath, serverDir, parent, log }) {
  const win = parent && !parent.isDestroyed() ? parent : null;
  const box = (o) => (win ? dialog.showMessageBox(win, o) : dialog.showMessageBox(o));
  const title = "紧急还原 · Emergency restore";
  const autoDir = path.join(dataDir, "backups", "auto");
  const say = (m) => { if (log) log("[emergency-restore] " + m); };

  const intro = await box({
    type: "question",
    title,
    message: "不启动 POS，直接还原一个备份？\nRestore a backup without starting the POS?",
    detail:
      "选择一个备份文件（本机自动备份、U 盘或云盘上的 .db 或加密的 .db.enc）。程序会先检查文件，并在替换前保存一份当前资料的安全副本。\n" +
      "Choose a backup file (an automatic backup on this PC, or a .db / encrypted .db.enc file on a USB drive or cloud folder). The file is checked first, and a safety copy of the current data is saved before anything is replaced.",
    buttons: ["选择备份文件… Choose a backup file…", "取消 Cancel"],
    defaultId: 0,
    cancelId: 1,
  });
  if (intro.response !== 0) return "cancelled";

  const openOpts = {
    title: "选择要还原的备份文件 · Choose a backup file to restore",
    defaultPath: fs.existsSync(autoDir) ? autoDir : dataDir,
    properties: ["openFile"],
    filters: [
      { name: "Workshop POS backup (.db, .db.enc)", extensions: ["db", "enc"] },
      { name: "All files", extensions: ["*"] },
    ],
  };
  const pick = await (win ? dialog.showOpenDialog(win, openOpts) : dialog.showOpenDialog(openOpts));
  if (pick.canceled || !pick.filePaths[0]) return "cancelled";
  const file = pick.filePaths[0];
  const encrypted = bcrypto.isEncryptedBackupFile(file);
  if (!encrypted && !bcrypto.isSqliteFile(file)) {
    await box({ type: "error", title, message: explain({ error: "NOT_A_BACKUP" }) });
    return "failed";
  }
  say("chosen " + file + (encrypted ? " (encrypted)" : ""));

  const confirm = async (info) => {
    const summary =
      info.workOrders != null
        ? "\n工单 Work orders: " + info.workOrders + (info.lastWorkOrderAt ? "   最新 Latest: " + fmtDate(info.lastWorkOrderAt) : "")
        : "";
    const r = await box({
      type: "warning",
      title,
      message: "还原这个备份？\nRestore this backup?",
      detail:
        info.label + summary +
        "\n\n这个备份之后输入的所有资料都会被替换。替换前会先保存一份当前资料的安全副本，然后程序会重新启动。\n" +
        "All data entered after this backup will be replaced. A safety copy of the current data is saved first, then the app restarts.\n\n" +
        "注意：这个备份之后开出的单据号码不会再被使用；已提交 LHDN、但还原后不在资料里的 e-Invoice 会列在审计日志（Audit Log）里，请重新登记。\n" +
        "Note: document numbers issued after this backup will not be issued again. e-Invoices already sent to LHDN that are no longer in the restored data are listed in the Audit Log so you can re-enter them.",
      buttons: ["还原并重启 Restore and restart", "取消 Cancel"],
      defaultId: 1,
      cancelId: 1,
    });
    return r.response === 0;
  };

  for (let attempt = 1; attempt <= (encrypted ? MAX_PASSWORD_TRIES : 1); attempt++) {
    let password = null;
    if (encrypted) {
      password = await askPassword(win, path.basename(file));
      if (!password) return "cancelled";
    }
    const r = await backup.offlineRestore({
      dataDir,
      dbPath,
      file,
      encrypted,
      password,
      verify: (tmp) => checkFile(tmp, serverDir, log),
      confirm,
      log,
    });
    if (r.ok) {
      await box({
        type: "info",
        title,
        message: "已还原，程序会重新启动。\nThe backup was restored. The app will start again.",
        detail: r.damagedCopy
          ? "原来的资料文件已损坏，已原样保存在 backups/damaged 文件夹，供技术支持查看。\nThe previous data file was damaged; it was kept as it was in the backups/damaged folder for support."
          : r.safetyCopy
            ? "还原前的资料已保存为 / The data from before the restore was saved as:\n" + r.safetyCopy
            : "",
      });
      return "restored";
    }
    if (r.error === "cancelled") return "cancelled";
    if (r.error === "WRONG_PASSWORD" && attempt < MAX_PASSWORD_TRIES) {
      await box({ type: "warning", title, message: "备份密码不对，请再试一次。\nThat backup password is not right. Try again." });
      continue;
    }
    await box({ type: "error", title, message: explain(r) });
    return "failed";
  }
  return "failed";
}

module.exports = { runEmergencyRestore, checkFile };
