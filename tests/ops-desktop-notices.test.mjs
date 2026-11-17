import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

// What the desktop app shows after the automatic database upgrade (electron/upgrade-notice.js),
// and that every desktop file main.js needs is packaged by both installers.
const require = createRequire(import.meta.url);
const { readUpgradeNotices, markWarningsShown } = require("../electron/upgrade-notice.js");
const ROOT = path.join(import.meta.dirname, "..");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ops-notice-"));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("no notice when the upgrade went fine", () => {
  assert.deepEqual(readUpgradeNotices(tmp), { errorFile: null, warnings: null });
});

test("skipped unique indexes are a one-time notice; new problems are shown again", () => {
  const warn = path.join(tmp, "upgrade-warnings.txt");
  fs.writeFileSync(warn, "2026-11-14T01:00:00.000Z\nWorkOrder.invoiceNumber has duplicate numbers (INV1); unique index not created\n");
  const first = readUpgradeNotices(tmp);
  assert.equal(first.errorFile, null);
  assert.deepEqual(first.warnings.lines, ["WorkOrder.invoiceNumber has duplicate numbers (INV1); unique index not created"]);
  markWarningsShown(tmp, first.warnings.key);
  assert.equal(readUpgradeNotices(tmp).warnings, null, "shown once");
  // The server rewrites the file at every start with a new time: still the same problem.
  fs.writeFileSync(warn, "2026-11-15T01:00:00.000Z\nWorkOrder.invoiceNumber has duplicate numbers (INV1); unique index not created\n");
  assert.equal(readUpgradeNotices(tmp).warnings, null);
  fs.appendFileSync(warn, "WorkOrder.receiptNumber has duplicate numbers (RC9); unique index not created\n");
  assert.equal(readUpgradeNotices(tmp).warnings.lines.length, 2, "a new problem is shown");
});

test("a failed upgrade is reported (before any warning)", () => {
  fs.writeFileSync(path.join(tmp, "upgrade-error.txt"), "2026-11-14\nError: database is locked\n");
  assert.equal(readUpgradeNotices(tmp).errorFile, path.join(tmp, "upgrade-error.txt"));
});

/** Every local file required (directly or not) from electron/main.js, plus files loaded by path. */
function desktopFiles() {
  const seen = new Set();
  const visit = (rel) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    const src = fs.readFileSync(path.join(ROOT, "electron", rel), "utf8");
    for (const m of src.matchAll(/require\("\.\/([\w.-]+?)(?:\.js)?"\)/g)) visit(m[1] + ".js");
    // Loaded by path at run time: preload scripts, the password page, the db-check helper.
    for (const m of src.matchAll(/path\.join\(__dirname, "([\w.-]+\.(?:js|html))"\)/g)) seen.add(m[1]);
  };
  visit("main.js");
  return [...seen].sort();
}

test("every desktop file main.js needs exists and is packaged by both installers, with the licences", () => {
  const files = desktopFiles();
  for (const f of ["backup.js", "updater.js", "update-verify.js", "emergency-restore.js", "db-check.js", "password-preload.js", "password-prompt.html", "upgrade-notice.js", "preload.js"]) {
    assert.ok(files.includes(f), f + " is used by the desktop app");
  }
  for (const f of files) assert.ok(fs.existsSync(path.join(ROOT, "electron", f)), "electron/" + f + " exists");
  for (const yml of ["electron-builder.yml", "electron-builder-demo.yml"]) {
    const s = fs.readFileSync(path.join(ROOT, yml), "utf8");
    assert.match(s, /^files:\s*\n\s+- electron\/\*\*\/\*\s*$/m, yml + " packages the whole electron folder");
    assert.match(s, /- from: licenses\s*\n\s*to: licenses\s*\n/, yml + " ships the licences");
    assert.match(s, /"!\*\*\/\.env"/, yml + " never ships a local .env");
    assert.match(s, /^asarUnpack:\s*\n\s+- electron\/db-check\.js\s*$/m, yml + " keeps the emergency check helper outside app.asar");
  }
});
