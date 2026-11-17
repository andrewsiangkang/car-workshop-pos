import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { onCrash, WINDOW_MS } = require("../electron/crash-policy.js");
const { RotatingLog } = require("../electron/log-rotate.js");

test("server restarts wait 1 s, 5 s, 15 s, 60 s and stop at the 5th crash in 10 minutes", () => {
  let history = [];
  const delays = [];
  let t = 1_000_000;
  for (let i = 0; i < 4; i++) {
    const d = onCrash(history, t);
    assert.equal(d.giveUp, false);
    delays.push(d.delayMs);
    history = d.recent;
    t += 30_000;
  }
  assert.deepEqual(delays, [1000, 5000, 15000, 60000]);
  assert.equal(onCrash(history, t).giveUp, true);
});

test("crashes older than 10 minutes are forgotten", () => {
  const t = 5_000_000;
  const old = [t - WINDOW_MS - 1, t - WINDOW_MS - 2, t - WINDOW_MS - 3, t - WINDOW_MS - 4];
  const d = onCrash(old, t);
  assert.equal(d.giveUp, false);
  assert.equal(d.delayMs, 1000);
  assert.deepEqual(d.recent, [t]);
});

test("server log rotates by size and keeps at most 3 files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-log-"));
  try {
    const file = path.join(dir, "logs", "server.log");
    const log = new RotatingLog(file, { maxBytes: 200, files: 3 });
    for (let i = 0; i < 100; i++) log.line("line " + i + " " + "x".repeat(20));
    log.close();
    const names = fs.readdirSync(path.join(dir, "logs")).sort();
    assert.deepEqual(names, ["server.1.log", "server.2.log", "server.log"]);
    for (const n of names) assert.ok(fs.statSync(path.join(dir, "logs", n)).size <= 200, n);
    // the newest line is in server.log, older ones in .1 / .2
    assert.match(fs.readFileSync(file, "utf8"), /line 99 /);
    assert.doesNotMatch(fs.readFileSync(path.join(dir, "logs", "server.2.log"), "utf8"), /line 99 /);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("server log keeps appending across restarts until it is full", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-log-"));
  try {
    const file = path.join(dir, "server.log");
    const a = new RotatingLog(file, { maxBytes: 10_000 });
    a.write("first run\n");
    a.close();
    const b = new RotatingLog(file, { maxBytes: 10_000 });
    b.write(Buffer.from("second run\n"));
    b.close();
    assert.equal(fs.readFileSync(file, "utf8"), "first run\nsecond run\n");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const { onSecondInstance } = require("../electron/second-instance.js");

/** Stand-in for a BrowserWindow: like Electron, every method throws once it is destroyed. */
function fakeWindow({ destroyed = false, minimized = false } = {}) {
  const calls = [];
  const guard = (name, fn) => () => {
    if (destroyed) throw new TypeError("Object has been destroyed");
    calls.push(name);
    return fn ? fn() : undefined;
  };
  return {
    calls,
    isDestroyed: () => destroyed,
    isMinimized: guard("isMinimized", () => minimized),
    restore: guard("restore"),
    focus: guard("focus"),
  };
}

test("opening the app again brings the open window to the front (restored if minimized)", () => {
  const w = fakeWindow({ minimized: true });
  assert.equal(onSecondInstance(w, 0), "focused");
  assert.deepEqual(w.calls, ["isMinimized", "restore", "focus"]);
});

test("opening the app again during the final backup never touches the closed window, and reopens later", () => {
  // The window is destroyed (or already set to null) while the on-quit backup runs.
  assert.doesNotThrow(() => onSecondInstance(fakeWindow({ destroyed: true }), 1));
  assert.equal(onSecondInstance(fakeWindow({ destroyed: true }), 1), "reopen-after-quit");
  assert.equal(onSecondInstance(null, 1), "reopen-after-quit");
  // Still starting up (no window yet) or already exiting: nothing to do.
  assert.equal(onSecondInstance(null, 0), "ignored");
  assert.equal(onSecondInstance(null, 2), "ignored");
});
