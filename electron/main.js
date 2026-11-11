const { app, BrowserWindow, Menu, dialog, shell, ipcMain } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const net = require("net");
const http = require("http");

let serverProc = null;
let win = null;
let currentPort = 0;
let paths = null;
const backup = require("./backup");

if (!app.requestSingleInstanceLock()) {
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

function waitForServer(port, timeoutMs = 60000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get({ host: "127.0.0.1", port, path: "/", timeout: 2000 }, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", retry);
      req.on("timeout", () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() - start > timeoutMs) return reject(new Error("服务器启动超时"));
      setTimeout(tryOnce, 300);
    };
    tryOnce();
  });
}

// 【中文】准备数据文件夹：数据放在用户目录，首次运行才复制空白模板数据库，升级或卸载程序都不会丢数据。
function prepareData() {
  // 数据放在用户目录，升级/卸载程序不会丢失
  const dataDir = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, "workshop.db");
  if (!fs.existsSync(dbPath)) {
    const template = app.isPackaged
      ? path.join(process.resourcesPath, "template.db")
      : path.join(__dirname, "..", "prisma", "template.db");
    if (!fs.existsSync(template)) throw new Error("找不到初始数据库: " + template);
    fs.copyFileSync(template, dbPath);
  }
  return { dataDir, dbPath };
}

// 【中文】每台电脑首次运行时生成专属的登录签名密钥并保存。
function getAuthSecret(dataDir) {
  // Random per-installation secret used to sign login cookies
  const f = path.join(dataDir, "auth-secret");
  try {
    const v = fs.readFileSync(f, "utf8").trim();
    if (v.length >= 32) return v;
  } catch (e) {}
  const v = require("crypto").randomBytes(32).toString("hex");
  fs.writeFileSync(f, v, { mode: 0o600 });
  return v;
}

// 【中文】启动内置的 Next.js 服务器，崩溃时自动重启；监听 0.0.0.0 让同一 Wi-Fi 的手机也能访问。
async function startServer() {
  const { dataDir, dbPath } = prepareData();
  paths = { dataDir, dbPath };
  const authSecret = getAuthSecret(dataDir);
  const port = await getFreePort();
  const serverDir = app.isPackaged
    ? path.join(process.resourcesPath, "app-server")
    : path.join(__dirname, "..", ".next", "standalone");

  serverProc = spawn(process.execPath, [path.join(serverDir, "server.js")], {
    cwd: serverDir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "0.0.0.0",
      DATABASE_URL: "file:" + dbPath.replace(/\\/g, "/"),
      WORKSHOP_DATA_DIR: dataDir,
      AUTH_SECRET: authSecret,
    },
    stdio: "ignore",
    windowsHide: true,
  });
  serverProc.on("exit", (code) => {
    if (!app.isQuitting && code) {
      console.error("Server exited with code", code, "- restarting...");
      setTimeout(async () => {
        if (app.isQuitting) return;
        try {
          const newPort = await startServer();
          if (win && !win.isDestroyed()) {
            win.loadURL("http://127.0.0.1:" + newPort + "/");
          }
        } catch (e) {
          dialog.showErrorBox("修车店 POS", "服务重启失败，请手动重新打开程序。\n" + String(e.message || e));
          app.quit();
        }
      }, 1000);
    }
  });
  await waitForServer(port);
  currentPort = port;
  return port;
}


// ===== Update check (GitHub Releases) =====
const CURRENT_VERSION = require("../package.json").version;
// Public GitHub repo whose latest Release is compared with this version. Set UPDATE_REPO="" to disable.
const GITHUB_REPO = process.env.UPDATE_REPO !== undefined ? process.env.UPDATE_REPO : "andrewsiangkang/car-workshop-pos";

// 【中文】比较版本号大小（如 0.1.10 大于 0.1.9）。
function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0, nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const https = require("https");
    const req = https.get(
      url,
      { headers: { "User-Agent": "WorkshopPOS/" + CURRENT_VERSION, Accept: "application/vnd.github+json" }, timeout: 10000 },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          if (res.statusCode !== 200) return reject(new Error("HTTP " + res.statusCode));
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

/** Returns { current, latest, url, hasUpdate } or { current, error } */
async function getLatestRelease() {
  if (!GITHUB_REPO) return { current: CURRENT_VERSION, error: "update source not configured" };
  try {
    const data = await fetchJson("https://api.github.com/repos/" + GITHUB_REPO + "/releases/latest");
    const latest = data.tag_name || data.name;
    if (!latest) return { current: CURRENT_VERSION, error: "no release found" };
    const exe = (data.assets || []).find((a) => /\.exe$/i.test(a.name));
    return {
      current: CURRENT_VERSION,
      latest: String(latest).replace(/^v/, ""),
      url: exe ? exe.browser_download_url : data.html_url,
      pageUrl: data.html_url,
      hasUpdate: compareVersions(latest, CURRENT_VERSION) > 0,
    };
  } catch (e) {
    return { current: CURRENT_VERSION, error: e.message };
  }
}

// 【中文】检查更新：向 GitHub 查询最新发布的版本，有新版本就提示下载。
// 【中文】演示版（打包时 extraMetadata.workshopDemo=true）：不检查更新，标题标明“演示版”。
const IS_DEMO = (() => { try { return !!require("../package.json").workshopDemo; } catch { return false; } })();

async function checkForUpdates() {
  if (IS_DEMO) return;
  if (!app.isPackaged) return; // only in the installed app
  const r = await getLatestRelease();
  if (r.error || !r.hasUpdate) return;
  if (!win || win.isDestroyed()) return;
  const result = await dialog.showMessageBox(win, {
    type: "info",
    title: "发现新版本 / New version",
    message: "有新版本可用：" + r.latest,
    detail: "当前版本：" + r.current + "\n\n点「下载」会下载新的安装程序。关闭本程序后运行它即可覆盖安装，你的资料不会丢失。",
    buttons: ["下载", "稍后提醒"],
    defaultId: 0,
    cancelId: 1,
  });
  if (result.response === 0 && r.url) shell.openExternal(r.url);
}

ipcMain.handle("update:check", async (event) => {
  const u = (event.senderFrame && event.senderFrame.url) || "";
  if (!u.startsWith("http://127.0.0.1:" + currentPort + "/")) return { error: "forbidden" };
  return getLatestRelease();
});

ipcMain.handle("update:open", async (event, url) => {
  const u = (event.senderFrame && event.senderFrame.url) || "";
  if (!u.startsWith("http://127.0.0.1:" + currentPort + "/")) return false;
  if (typeof url === "string" && url.startsWith("https://github.com/" + GITHUB_REPO + "/")) {
    await shell.openExternal(url);
    return true;
  }
  return false;
});

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
    const port = await startServer();
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
    Menu.setApplicationMenu(null);
    // Allow reload if page freezes
    win.webContents.on("before-input-event", (event, input) => {
      if (input.key === "F5" || (input.control && input.key === "r")) {
        win.webContents.reload();
        event.preventDefault();
      }
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (!url.startsWith("http://127.0.0.1:" + port)) {
        shell.openExternal(url);
        return { action: "deny" };
      }
      return { action: "allow" };
    });
    win.loadURL("http://127.0.0.1:" + port + "/");
    backup.init({
      dataDir: paths.dataDir,
      dbPath: paths.dbPath,
      getWin: () => win,
      isAllowedSender: (event) => {
        const u = (event.senderFrame && event.senderFrame.url) || "";
        return u.startsWith("http://127.0.0.1:" + currentPort + "/");
      },
      stopServer: () => {
        if (serverProc) serverProc.kill();
      },
    });
    const lanIP = getLocalIP();
    const mobileUrl = "http://" + lanIP + ":" + port;
    win.setTitle((IS_DEMO ? "【演示版】" : "") + "修车店 POS  ·  手机访问: " + mobileUrl);
    // Show mobile access info once
    // Non-blocking info in title only; avoid modal dialog that can steal focus
    setTimeout(() => {
      if (win && !win.isDestroyed()) {
        win.setTitle((IS_DEMO ? "【演示版】" : "") + "修车店 POS  ·  手机: " + mobileUrl);
      }
    }, 500);
    // Warn if the automatic database upgrade failed (the original data is untouched).
    setTimeout(() => {
      try {
        const f = path.join(app.getPath("userData"), "data", "upgrade-error.txt");
        if (fs.existsSync(f)) {
          dialog.showMessageBox(win, {
            type: "warning",
            title: "修车店 POS",
            message: "数据库升级失败，部分新功能可能无法使用。",
            detail: "你的原有数据没有被改动，升级前已自动备份。请把此情况告诉技术支持。\n详情文件：" + f,
          });
        }
      } catch {}
    }, 8000);
    // Check for updates after window is ready
    win.webContents.once("did-finish-load", () => {
      setTimeout(checkForUpdates, 3000);
    });
  } catch (e) {
    dialog.showErrorBox("修车店 POS 启动失败", String(e && e.message ? e.message : e));
    app.quit();
  }
}

app.on("second-instance", () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});
app.whenReady().then(createWindow);
app.on("before-quit", () => {
  app.isQuitting = true;
  try { backup.onQuit(); } catch (e) { console.error(e); }
  if (serverProc) serverProc.kill();
});
app.on("window-all-closed", () => app.quit());
