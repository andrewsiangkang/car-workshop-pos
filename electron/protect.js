// Small secret files kept on this PC (the data key, the backup-password key).
// Protected with Electron safeStorage (Windows DPAPI: only this Windows user on this PC can
// read them) as <name>.enc. When safeStorage is not available the value is written as a
// plain <name> file readable only by this user, and a line is logged.
// Electron 45 deprecated the synchronous safeStorage calls (removed in Electron 46): the
// asynchronous ones are used when this Electron has them. Data written by the old synchronous
// encryptString can be read by decryptStringAsync (same Windows key store).
// 【中文】本机小密钥文件的保存：优先用 Windows DPAPI（safeStorage）加密为 .enc；不可用时退回为仅本用户可读的普通文件并写日志。
// Electron 45 起同步的 safeStorage 接口已弃用（46 删除），有异步接口就用异步接口；旧版本加密的文件照样能读。
const fs = require("fs");
const path = require("path");
const { safeStorage } = require("electron");

function hasAsync() {
  return (
    !!safeStorage &&
    typeof safeStorage.isAsyncEncryptionAvailable === "function" &&
    typeof safeStorage.encryptStringAsync === "function" &&
    typeof safeStorage.decryptStringAsync === "function"
  );
}

/** Resolves true when values can be protected by Windows right now. Never rejects. */
async function canProtect() {
  try {
    if (hasAsync()) return (await safeStorage.isAsyncEncryptionAvailable()) === true;
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

async function encrypt(value) {
  if (hasAsync()) return Buffer.from(await safeStorage.encryptStringAsync(String(value)));
  return safeStorage.encryptString(String(value));
}

/** { value, reEncrypt }: reEncrypt = the key store rotated its key; the file should be written again. */
async function decrypt(buf) {
  if (hasAsync()) {
    const r = await safeStorage.decryptStringAsync(buf);
    return { value: String(r && r.result), reEncrypt: !!(r && r.shouldReEncrypt) };
  }
  return { value: safeStorage.decryptString(buf), reEncrypt: false };
}

function writeAtomic(file, data, mode) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, data, mode ? { mode } : undefined);
  fs.renameSync(tmp, file);
}

function codeError(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

/**
 * Read a protected value. Resolves null when there is none.
 * Rejects with code "LOCKED" when <name>.enc exists but safeStorage is not available right now
 * (or says it is temporarily unavailable), and "UNREADABLE" when it cannot be decrypted (e.g.
 * another Windows account).
 */
async function readProtected(base) {
  const enc = base + ".enc";
  if (fs.existsSync(enc)) {
    if (!(await canProtect())) throw codeError("LOCKED", path.basename(enc) + ": safeStorage is not available");
    let out;
    try {
      out = await decrypt(fs.readFileSync(enc));
    } catch (err) {
      if (err && err.isTemporarilyUnavailable) {
        throw codeError("LOCKED", path.basename(enc) + ": safeStorage is temporarily unavailable");
      }
      throw codeError("UNREADABLE", path.basename(enc) + " cannot be read: " + (err && err.message));
    }
    if (out.reEncrypt) {
      // Best effort: the value is still good, only the stored copy should use the new key.
      try { writeAtomic(enc, await encrypt(out.value)); } catch {}
    }
    return out.value;
  }
  if (fs.existsSync(base)) {
    const v = fs.readFileSync(base, "utf8").trim();
    return v || null;
  }
  return null;
}

/** Save a protected value; resolves "dpapi" or "plain". */
async function writeProtected(base, value, log) {
  if (await canProtect()) {
    writeAtomic(base + ".enc", await encrypt(value));
    try { fs.rmSync(base, { force: true }); } catch {}
    return "dpapi";
  }
  writeAtomic(base, String(value), 0o600);
  if (log) log("safeStorage is not available: " + path.basename(base) + " was saved as a plain file readable only by this user");
  return "plain";
}

function removeProtected(base) {
  for (const f of [base + ".enc", base]) {
    try { fs.rmSync(f, { force: true }); } catch {}
  }
}

module.exports = { canProtect, readProtected, writeProtected, removeProtected };
