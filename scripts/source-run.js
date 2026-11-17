// Source install (install.bat / install.sh / start.bat / start.sh): set up, build and run the
// POS as a PRODUCTION server (`next start`), never the development server.
//   node scripts/source-run.js setup   .env.local with a random AUTH_SECRET (once) + empty database
//   node scripts/source-run.js build   production build (`next build`)
//   node scripts/source-run.js start   `next start` on 127.0.0.1 (this computer only)
// Phone / tablet access is off unless WORKSHOP_LAN=1 is set (environment or a .env file); then
// the server listens on every network (0.0.0.0). Port: PORT (default 3000).
// The secret is kept in .env.local (git-ignored): Next.js copies .env / .env.production into
// .next/standalone, which the desktop installer packages, but never .env.local.
// The database is the DATABASE_URL set in the environment or in .env.production.local /
// .env.local / .env.production / .env (Next.js order; an older source install keeps using the
// database its .env points to, e.g. file:./dev.db = prisma/dev.db), else data/workshop.db.
// A relative file: path is relative to the prisma folder, as Prisma reads it.
// 【中文】源码版安装 / 启动：以「正式模式」运行（next start），默认只监听本机 127.0.0.1；
// 设置 WORKSHOP_LAN=1 才允许手机 / 平板连接。首次安装时生成随机的 AUTH_SECRET，保存在 .env.local（不会提交到 git，也不会被打包）。
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync, spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const ENV_FILE = ".env.local";

/** KEY=VALUE lines of a dotenv file (quotes removed, comments and blank lines skipped). */
function parseEnv(text) {
  const out = {};
  for (const raw of String(text || "").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(raw);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

/**
 * Make sure <root>/.env.local has an AUTH_SECRET of at least 32 characters. An existing one is
 * never changed (that would sign everybody out); other lines are kept as they are.
 * Returns { file, created: boolean, env }. The secret is never printed.
 */
function ensureEnvFile(root, randomBytes = crypto.randomBytes) {
  const file = path.join(root, ENV_FILE);
  let text = "";
  try { text = fs.readFileSync(file, "utf8"); } catch {}
  const env = parseEnv(text);
  if (env.AUTH_SECRET && env.AUTH_SECRET.length >= 32) return { file, created: false, env };
  const secret = randomBytes(32).toString("hex");
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "" && !/^\s*(?:export\s+)?AUTH_SECRET\s*=/.test(l));
  lines.unshift(
    "# Created by install (scripts/source-run.js). Keep this file private and never commit it.",
    "# Login cookies are signed with AUTH_SECRET; changing it signs everybody out.",
    "AUTH_SECRET=" + secret
  );
  fs.writeFileSync(file, lines.join("\n") + "\n", { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch {}
  return { file, created: true, env: { ...env, AUTH_SECRET: secret } };
}

/** 127.0.0.1 unless phone / tablet access was asked for with WORKSHOP_LAN=1. */
function listenHost(env) {
  return String(env.WORKSHOP_LAN || "").trim() === "1" ? "0.0.0.0" : "127.0.0.1";
}

/**
 * Settings from the project's dotenv files, in the order Next.js reads them for `next start`:
 * .env.production.local, then .env.local, then .env.production, then .env (earlier wins).
 * 【中文】按 Next.js 的顺序读取 .env 文件，旧的源码安装在 .env 里设置的 DATABASE_URL 会继续使用。
 */
function readFileEnv(root) {
  const out = {};
  for (const name of [".env", ".env.production", ENV_FILE, ".env.production.local"]) {
    try { Object.assign(out, parseEnv(fs.readFileSync(path.join(root, name), "utf8"))); } catch {}
  }
  return out;
}

/**
 * DATABASE_URL to use, always with an absolute file path: the one set by the user (a relative
 * `file:` path is relative to the prisma folder, as Prisma resolves it), else <root>/data/workshop.db.
 * 【中文】数据库位置：用户设置的 DATABASE_URL（相对路径按 Prisma 的规则以 prisma 文件夹为准），否则 data/workshop.db。
 */
function databaseUrl(root, env) {
  const url = String(env.DATABASE_URL || "").trim();
  if (!url) return "file:" + path.join(root, "data", "workshop.db").replace(/\\/g, "/");
  if (!url.startsWith("file:") || url.startsWith("file://")) return url;
  const rest = url.slice(5);
  const q = rest.indexOf("?");
  const file = q < 0 ? rest : rest.slice(0, q);
  const query = q < 0 ? "" : rest.slice(q);
  const abs = path.isAbsolute(file) ? file : path.resolve(root, "prisma", file);
  return "file:" + abs.replace(/\\/g, "/") + query;
}

/** The database file of a file: URL (null for anything else). */
function databaseFile(url) {
  return url.startsWith("file:") && !url.startsWith("file://") ? url.slice(5).split("?")[0] : null;
}

/** Environment for the server / build: process env wins over the dotenv files, like Next.js does. */
function serverEnv(root, fileEnv, processEnv = process.env) {
  const merged = { ...fileEnv, ...processEnv };
  const host = listenHost(merged);
  return {
    ...processEnv,
    AUTH_SECRET: merged.AUTH_SECRET,
    DATABASE_URL: databaseUrl(root, merged),
    WORKSHOP_DATA_DIR: merged.WORKSHOP_DATA_DIR || path.join(root, "data"),
    WORKSHOP_LISTEN_HOST: host,
    ...(merged.PORT ? { PORT: String(merged.PORT) } : {}),
  };
}

/** Run a Node.js script of this project (no shell, so folder names with spaces are fine). */
function runNode(script, args, env, root = ROOT) {
  const r = spawnSync(process.execPath, [path.join(root, script), ...args], { cwd: root, env, stdio: "inherit" });
  if (r.error) throw r.error;
  return r.status === 0;
}

/** .env.local (with its AUTH_SECRET) plus the other dotenv files, and whether the secret is new. */
function loadEnv(root) {
  const { created } = ensureEnvFile(root);
  return { created, fileEnv: readFileEnv(root) };
}

function setup(root = ROOT, run = runNode, processEnv = process.env) {
  const { created, fileEnv } = loadEnv(root);
  console.log(created ? "Created " + ENV_FILE + " with a new random AUTH_SECRET." : ENV_FILE + " already has an AUTH_SECRET (kept).");
  const env = serverEnv(root, fileEnv, processEnv);
  fs.mkdirSync(env.WORKSHOP_DATA_DIR, { recursive: true });
  const dbFile = databaseFile(env.DATABASE_URL);
  if (dbFile && fs.existsSync(dbFile) && fs.statSync(dbFile).size > 0) {
    // An existing shop database is upgraded by the server itself at start (src/lib/schema-upgrade.ts),
    // with a backup first; `prisma db push` could drop data, so it is never run on it.
    console.log("Database found: " + dbFile + " (it is upgraded automatically when the POS starts).");
    return true;
  }
  console.log("Creating an empty database: " + (dbFile || env.DATABASE_URL));
  return run("node_modules/prisma/build/index.js", ["db", "push", "--skip-generate"], env, root);
}

function build() {
  const { fileEnv } = loadEnv(ROOT);
  const env = { ...serverEnv(ROOT, fileEnv), NODE_ENV: "production" };
  // Same steps as `npm run build` (prebuild = offline OCR files, then next build).
  return runNode("scripts/copy-ocr.js", [], env) && runNode("node_modules/next/dist/bin/next", ["build"], env);
}

function start() {
  if (!fs.existsSync(path.join(ROOT, ".next", "BUILD_ID"))) {
    console.error("The POS has not been built yet. Run install.bat (Windows) or ./install.sh first.");
    return false;
  }
  const { fileEnv } = loadEnv(ROOT);
  const env = { ...serverEnv(ROOT, fileEnv), NODE_ENV: "production" };
  const host = env.WORKSHOP_LISTEN_HOST;
  const port = String(Number(env.PORT) || 3000);
  console.log("");
  console.log("Workshop POS: http://localhost:" + port + "   (stop: Ctrl + C)");
  console.log("Database: " + (databaseFile(env.DATABASE_URL) || env.DATABASE_URL));
  console.log(
    host === "127.0.0.1"
      ? "Only this computer can open it. For phones / tablets on a staff-only Wi-Fi, set WORKSHOP_LAN=1 (see README)."
      : "Phone / tablet access is ON (WORKSHOP_LAN=1): every device on this network can reach the login page. Plain HTTP: use a staff-only Wi-Fi."
  );
  console.log('(You can ignore a Next.js note that "next start" does not work with "output: standalone": it works.)');
  console.log("");
  const child = spawn(process.execPath, [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "-H", host, "-p", port], {
    cwd: ROOT,
    env,
    stdio: "inherit",
  });
  child.on("exit", (code) => process.exit(code ?? 0));
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
  return true;
}

if (require.main === module) {
  const cmd = process.argv[2];
  const ok = cmd === "setup" ? setup() : cmd === "build" ? build() : cmd === "start" ? start() : null;
  if (ok === null) {
    console.error("usage: node scripts/source-run.js setup | build | start");
    process.exit(2);
  }
  if (!ok) process.exit(1);
}

module.exports = { parseEnv, ensureEnvFile, readFileEnv, listenHost, databaseUrl, databaseFile, serverEnv, setup, ENV_FILE };
