import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

// electron/protect.js keeps the data key and the backup-password key under Windows DPAPI
// (Electron safeStorage). Electron 45 deprecated the synchronous safeStorage calls (removed in 46),
// so the asynchronous ones are used when present, with the old ones as a fallback.
const require = createRequire(import.meta.url);
const ss = {};
const electronPath = require.resolve("electron");
require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: { safeStorage: ss } };
const protect = require("../electron/protect.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ops-protect-"));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// A reversible stand-in for DPAPI; "v2:" marks data written with a rotated key.
const seal = (s, v = "v1") => Buffer.from(v + ":" + Buffer.from(s, "utf8").toString("base64"));
const open = (b) => Buffer.from(String(b).slice(3), "base64").toString("utf8");
const calls = [];
function asyncApi({ available = true, rotateOnRead = false, decryptError = null } = {}) {
  for (const k of Object.keys(ss)) delete ss[k];
  Object.assign(ss, {
    isAsyncEncryptionAvailable: async () => available,
    encryptStringAsync: async (s) => { calls.push("encryptAsync"); return seal(s, rotateOnRead ? "v2" : "v1"); },
    decryptStringAsync: async (b) => {
      calls.push("decryptAsync");
      if (decryptError) throw decryptError;
      return { result: open(b), shouldReEncrypt: rotateOnRead && String(b).startsWith("v1:") };
    },
    // The deprecated calls must not be used when the asynchronous ones exist.
    isEncryptionAvailable: () => { throw new Error("deprecated sync API used"); },
    encryptString: () => { throw new Error("deprecated sync API used"); },
    decryptString: () => { throw new Error("deprecated sync API used"); },
  });
}
function syncApi(available = true) {
  for (const k of Object.keys(ss)) delete ss[k];
  Object.assign(ss, {
    isEncryptionAvailable: () => available,
    encryptString: (s) => seal(s),
    decryptString: (b) => open(b),
  });
}

test("with Electron 45+ the asynchronous safeStorage API protects and reads the key", async () => {
  asyncApi();
  const base = path.join(tmp, "data-key");
  assert.equal(await protect.canProtect(), true);
  assert.equal(await protect.writeProtected(base, "secret-1"), "dpapi");
  assert.ok(fs.existsSync(base + ".enc"));
  assert.ok(!fs.readFileSync(base + ".enc", "utf8").includes("secret-1"));
  assert.equal(await protect.readProtected(base), "secret-1");
  assert.deepEqual(calls.splice(0), ["encryptAsync", "decryptAsync"]);
});

test("a key written by the old synchronous API (v0.3.29) is still read, and re-saved when the key store rotated", async () => {
  syncApi();
  const base = path.join(tmp, "backup-key");
  await protect.writeProtected(base, "old-key");
  asyncApi({ rotateOnRead: true });
  assert.equal(await protect.readProtected(base), "old-key");
  assert.match(fs.readFileSync(base + ".enc", "utf8"), /^v2:/, "written again with the new key");
  assert.equal(await protect.readProtected(base), "old-key");
});

test("not available now → LOCKED (the key is kept); cannot be decrypted → UNREADABLE", async () => {
  asyncApi();
  const base = path.join(tmp, "k3");
  await protect.writeProtected(base, "value");
  asyncApi({ available: false });
  await assert.rejects(protect.readProtected(base), (e) => e.code === "LOCKED");
  asyncApi({ decryptError: Object.assign(new Error("busy"), { isTemporarilyUnavailable: true }) });
  await assert.rejects(protect.readProtected(base), (e) => e.code === "LOCKED");
  asyncApi({ decryptError: new Error("another Windows account") });
  await assert.rejects(protect.readProtected(base), (e) => e.code === "UNREADABLE");
  assert.ok(fs.existsSync(base + ".enc"), "never deleted");
});

test("without Windows protection the value is a plain file readable only by this user, and older Electron still works", async () => {
  asyncApi({ available: false });
  const base = path.join(tmp, "k4");
  const logged = [];
  assert.equal(await protect.writeProtected(base, "plain-value", (m) => logged.push(m)), "plain");
  assert.equal(fs.readFileSync(base, "utf8"), "plain-value");
  if (process.platform !== "win32") assert.equal(fs.statSync(base).mode & 0o777, 0o600);
  assert.match(logged[0], /saved as a plain file/);
  assert.equal(await protect.readProtected(base), "plain-value");
  // Once protection is available the plain file is replaced by the protected one.
  syncApi();
  assert.equal(await protect.writeProtected(base, "plain-value"), "dpapi");
  assert.ok(!fs.existsSync(base));
  assert.equal(await protect.readProtected(base), "plain-value");
  protect.removeProtected(base);
  assert.equal(await protect.readProtected(base), null);
});
