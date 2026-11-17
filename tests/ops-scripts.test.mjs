import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

// Build and install scripts: the source install (scripts/source-run.js), the offline OCR files
// (scripts/copy-ocr.js) and the demo logins (scripts/seed-demo.js).
const require = createRequire(import.meta.url);
const ROOT = path.join(import.meta.dirname, "..");
const run = require("../scripts/source-run.js");
const ocr = require("../scripts/copy-ocr.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ops-scripts-"));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// ---- source install ----

test("install creates .env.local with a random AUTH_SECRET once, and never changes it afterwards", () => {
  const root = path.join(tmp, "src1");
  fs.mkdirSync(root);
  const a = run.ensureEnvFile(root);
  assert.equal(a.created, true);
  assert.equal(path.basename(a.file), ".env.local", "not .env: Next.js copies .env into the packaged server");
  assert.match(a.env.AUTH_SECRET, /^[0-9a-f]{64}$/);
  assert.notEqual(a.env.AUTH_SECRET, "dev-only-secret-not-for-production");
  if (process.platform !== "win32") assert.equal(fs.statSync(a.file).mode & 0o777, 0o600);
  const b = run.ensureEnvFile(root);
  assert.equal(b.created, false);
  assert.equal(b.env.AUTH_SECRET, a.env.AUTH_SECRET, "a second install keeps everybody signed in");
  // Another install folder gets a different secret.
  const other = path.join(tmp, "src2");
  fs.mkdirSync(other);
  assert.notEqual(run.ensureEnvFile(other).env.AUTH_SECRET, a.env.AUTH_SECRET);
});

test("a too-short secret is replaced; the boss's own settings in .env.local are kept", () => {
  const root = path.join(tmp, "src3");
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, ".env.local"), "# mine\nWORKSHOP_LAN=1\nAUTH_SECRET=short\nPORT='3005'\n");
  const r = run.ensureEnvFile(root);
  assert.equal(r.created, true);
  const env = run.parseEnv(fs.readFileSync(r.file, "utf8"));
  assert.match(env.AUTH_SECRET, /^[0-9a-f]{64}$/);
  assert.equal(env.WORKSHOP_LAN, "1");
  assert.equal(env.PORT, "3005");
  assert.equal(fs.readFileSync(r.file, "utf8").match(/AUTH_SECRET=/g).length, 1);
});

test("the shop server listens on this computer only unless WORKSHOP_LAN=1", () => {
  assert.equal(run.listenHost({}), "127.0.0.1");
  assert.equal(run.listenHost({ WORKSHOP_LAN: "0" }), "127.0.0.1");
  assert.equal(run.listenHost({ WORKSHOP_LAN: "yes" }), "127.0.0.1", "only an explicit 1 opens it");
  assert.equal(run.listenHost({ WORKSHOP_LAN: "1" }), "0.0.0.0");
  const root = path.join(tmp, "src4");
  const file = { AUTH_SECRET: "f".repeat(64), WORKSHOP_LAN: "1", PORT: "3005" };
  const e1 = run.serverEnv(root, file, { PATH: "/bin" });
  assert.equal(e1.WORKSHOP_LISTEN_HOST, "0.0.0.0");
  assert.equal(e1.PORT, "3005", "the port can be set in .env.local too");
  assert.equal(e1.AUTH_SECRET, "f".repeat(64));
  assert.equal(e1.DATABASE_URL, "file:" + path.join(root, "data", "workshop.db").replace(/\\/g, "/"));
  assert.equal(e1.WORKSHOP_DATA_DIR, path.join(root, "data"));
  // The environment wins over the file (like Next.js), e.g. a one-off WORKSHOP_LAN=0.
  const e2 = run.serverEnv(root, file, { WORKSHOP_LAN: "0", DATABASE_URL: "file:/elsewhere.db" });
  assert.equal(e2.WORKSHOP_LISTEN_HOST, "127.0.0.1");
  assert.equal(e2.DATABASE_URL, "file:/elsewhere.db");
});

test("an older source install keeps the database its .env points to (relative = prisma folder, like Prisma)", () => {
  const root = path.join(tmp, "legacy");
  fs.mkdirSync(path.join(root, "prisma"), { recursive: true });
  fs.writeFileSync(path.join(root, ".env"), 'DATABASE_URL="file:./dev.db"\nWORKSHOP_LAN=1\n');
  fs.writeFileSync(path.join(root, "prisma", "dev.db"), "SQLite format 3\0 shop data");
  const want = "file:" + path.join(root, "prisma", "dev.db").replace(/\\/g, "/");
  // Next.js order: .env.local wins over .env.production, which wins over .env.
  fs.writeFileSync(path.join(root, ".env.production"), "PORT=3007\n");
  fs.writeFileSync(path.join(root, ".env.local"), "PORT=3009\n");
  const fileEnv = run.readFileEnv(root);
  assert.equal(fileEnv.PORT, "3009");
  assert.equal(fileEnv.DATABASE_URL, "file:./dev.db");
  const env = run.serverEnv(root, fileEnv, { PATH: "/bin" });
  assert.equal(env.DATABASE_URL, want, "not a new empty data/workshop.db");
  assert.equal(env.WORKSHOP_LISTEN_HOST, "0.0.0.0", "settings in .env still count");
  // setup sees the existing database and never runs `prisma db push` on it.
  const calls = [];
  const ok = run.setup(root, (...a) => { calls.push(a); return true; }, { PATH: "/bin" });
  assert.equal(ok, true);
  assert.deepEqual(calls, []);
  assert.match(fs.readFileSync(path.join(root, ".env.local"), "utf8"), /AUTH_SECRET=[0-9a-f]{64}/);
  assert.match(fs.readFileSync(path.join(root, ".env.local"), "utf8"), /PORT=3009/, "the boss's own line is kept");
  // A missing database is created where the URL points, with an absolute path.
  fs.rmSync(path.join(root, "prisma", "dev.db"));
  assert.equal(run.setup(root, (...a) => { calls.push(a); return true; }, { PATH: "/bin" }), true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 2), ["node_modules/prisma/build/index.js", ["db", "push", "--skip-generate"]]);
  assert.equal(calls[0][2].DATABASE_URL, want);
});

test("database URLs: absolute paths and query strings are kept, nothing set means data/workshop.db", () => {
  const root = path.join(tmp, "urls");
  const abs = path.join(tmp, "shop", "pos.db").replace(/\\/g, "/");
  assert.equal(run.databaseUrl(root, { DATABASE_URL: "file:" + abs }), "file:" + abs);
  assert.equal(run.databaseUrl(root, { DATABASE_URL: "file:dev.db?connection_limit=1" }), "file:" + path.join(root, "prisma", "dev.db").replace(/\\/g, "/") + "?connection_limit=1");
  assert.equal(run.databaseUrl(root, { DATABASE_URL: "file:../data/x.db" }), "file:" + path.join(root, "data", "x.db").replace(/\\/g, "/"));
  assert.equal(run.databaseUrl(root, {}), "file:" + path.join(root, "data", "workshop.db").replace(/\\/g, "/"));
  assert.equal(run.databaseFile("file:" + abs + "?x=1"), abs);
  assert.equal(run.databaseFile("postgresql://x"), null);
});

test("start refuses to run before the production build exists (never falls back to the dev server)", () => {
  const root = path.join(tmp, "src5");
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "scripts", "source-run.js"), path.join(root, "scripts", "source-run.js"));
  const r = spawnSync(process.execPath, [path.join(root, "scripts", "source-run.js"), "start"], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /has not been built yet/);
  const u = spawnSync(process.execPath, [path.join(root, "scripts", "source-run.js"), "dev"], { encoding: "utf8" });
  assert.equal(u.status, 2);
});

// ---- offline OCR files ----

test("release builds must have the offline OCR files: CI, WORKSHOP_RELEASE=1 or --strict", () => {
  assert.equal(ocr.isStrict([], {}), false);
  assert.equal(ocr.isStrict([], { CI: "true" }), true);
  assert.equal(ocr.isStrict([], { CI: "false" }), false);
  assert.equal(ocr.isStrict([], { WORKSHOP_RELEASE: "1" }), true);
  assert.equal(ocr.isStrict(["node", "copy-ocr.js", "--strict"], {}), true);
});

test("OCR files are copied when present; a missing one is reported", () => {
  const root = path.join(tmp, "ocr-ok");
  const nm = path.join(root, "node_modules");
  fs.mkdirSync(path.join(nm, "tesseract.js", "dist"), { recursive: true });
  fs.mkdirSync(path.join(nm, "tesseract.js-core"), { recursive: true });
  fs.mkdirSync(path.join(nm, "@tesseract.js-data", "eng", "4.0.0_best_int"), { recursive: true });
  fs.writeFileSync(path.join(nm, "tesseract.js", "dist", "worker.min.js"), "worker");
  fs.writeFileSync(path.join(nm, "tesseract.js-core", "tesseract-core-simd-lstm.wasm"), "wasm");
  fs.writeFileSync(path.join(nm, "tesseract.js-core", "tesseract-core-simd-lstm.wasm.js"), "js");
  fs.writeFileSync(path.join(nm, "@tesseract.js-data", "eng", "4.0.0_best_int", "eng.traineddata.gz"), "lang");
  const out = path.join(root, "public", "ocr");
  const r = ocr.prepareOcr(root, out);
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.copied.sort(), ["lang/eng.traineddata.gz".replace("/", path.sep), "tesseract-core-simd-lstm.wasm", "tesseract-core-simd-lstm.wasm.js", "worker.min.js"].sort());
  // An empty language file (broken install) is not accepted.
  fs.writeFileSync(path.join(nm, "@tesseract.js-data", "eng", "4.0.0_best_int", "eng.traineddata.gz"), "");
  const bad = ocr.prepareOcr(root, path.join(root, "out2"));
  assert.equal(bad.ok, false);
  assert.match(bad.error, /empty/);
});

test("a release build without the OCR files fails; a developer build only warns", () => {
  const root = path.join(tmp, "ocr-missing");
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "scripts", "copy-ocr.js"), path.join(root, "scripts", "copy-ocr.js"));
  const env = { ...process.env, CI: "", WORKSHOP_RELEASE: "" };
  const strict = spawnSync(process.execPath, [path.join(root, "scripts", "copy-ocr.js"), "--strict"], { encoding: "utf8", env });
  assert.equal(strict.status, 1);
  assert.match(strict.stderr, /A release must include them/);
  const ci = spawnSync(process.execPath, [path.join(root, "scripts", "copy-ocr.js")], { encoding: "utf8", env: { ...env, CI: "true" } });
  assert.equal(ci.status, 1);
  const dev = spawnSync(process.execPath, [path.join(root, "scripts", "copy-ocr.js")], { encoding: "utf8", env });
  assert.equal(dev.status, 0);
  assert.match(dev.stderr, /Scanning supplier invoices will not work/);
});

// ---- demo logins ----

test("the demo has no fixed logins: passwords come from the environment or are random per build", () => {
  const { demoPasswords, randomPassword } = require("../scripts/seed-demo.js");
  const a = demoPasswords({});
  const b = demoPasswords({});
  assert.equal(a.generated, true);
  for (const p of [a.owner, a.staff]) {
    assert.match(p, /^[2-9a-km-zA-HJ-NP-Z]{4}-[2-9a-km-zA-HJ-NP-Z]{4}-[2-9a-km-zA-HJ-NP-Z]{4}$/);
    assert.ok(!["demo12345", "staff12345"].includes(p));
  }
  assert.notEqual(a.owner, a.staff);
  assert.notEqual(a.owner, b.owner);
  assert.deepEqual(demoPasswords({ DEMO_OWNER_PASSWORD: "Boss-Pass-2026", DEMO_STAFF_PASSWORD: "Staff-Pass-26" }), {
    owner: "Boss-Pass-2026",
    staff: "Staff-Pass-26",
    generated: false,
    fromEnv: { owner: true, staff: true },
  });
  assert.throws(() => demoPasswords({ DEMO_OWNER_PASSWORD: "short" }), /at least 8 characters/);
  // Unbiased symbols even with a skewed random source (rejection sampling).
  let i = 0;
  const skewed = (n) => Buffer.from(Array.from({ length: n }, () => (i++ % 2 ? 255 : 7)));
  assert.match(randomPassword(skewed), /^\w{4}-\w{4}-\w{4}$/);
});

test("a demo password from a repository secret is never written to the login file (public artifact)", () => {
  const { demoPasswords, loginText } = require("../scripts/seed-demo.js");
  const mixed = demoPasswords({ DEMO_OWNER_PASSWORD: "Boss-Reused-Pass" });
  assert.deepEqual(mixed.fromEnv, { owner: true, staff: false });
  const text = loginText(mixed);
  assert.doesNotMatch(text, /Boss-Reused-Pass/);
  assert.match(text, /demo +\/ \(the password set in the DEMO_OWNER_PASSWORD repository secret/);
  assert.ok(text.includes("staff / " + mixed.staff + "\n"), "a password made for this build is shown once");
  const random = demoPasswords({});
  const all = loginText(random);
  assert.ok(all.includes(random.owner) && all.includes(random.staff));
});
