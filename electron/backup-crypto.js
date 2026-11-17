// Password-encrypted backup files (*.db.enc) for copies that leave this PC (USB / OneDrive /
// Google Drive). scrypt turns the boss's backup password into a key; AES-256-GCM encrypts
// and authenticates the file. Only the password is needed to open a copy on another PC.
// No Electron imports, so tests can require it directly.
// 【中文】离开本机的备份副本（USB / 云盘）用「备份密码」加密：scrypt 由密码生成钥匙，AES-256-GCM 加密并防篡改；换电脑也只需要密码就能打开。
//
// File layout (all integers are single bytes):
//   magic "WSPOSBK1" (8) | logN (1) | r (1) | p (1) | salt length = 16 (1) | salt (16) |
//   key check (16) | iv (12) | ciphertext ... | GCM tag (16)
// The header (everything before the ciphertext) is authenticated as GCM additional data.
// "key check" = first 16 bytes of HMAC-SHA256(key, "key-check"): a wrong password is
// reported at once instead of after reading the whole file.
const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const { pipeline } = require("stream/promises");

const MAGIC = Buffer.from("WSPOSBK1", "ascii");
const SALT_LEN = 16;
const CHECK_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = MAGIC.length + 4 + SALT_LEN + CHECK_LEN + IV_LEN; // 56
const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "binary");
/** scrypt N = 2^15, r = 8, p = 1: about 32 MB and well under a second on a shop PC. */
const DEFAULT_PARAMS = { logN: 15, r: 8, p: 1 };
/** Largest scrypt cost accepted from a file header: memory 128·N·r ≤ 64 MiB (2× default), p ≤ 2. */
const MAX_SCRYPT_MEM = 64 * 1024 * 1024;
const MAX_SCRYPT_P = 2;
const MIN_PASSWORD = 8;

function codeError(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

function scryptKey(password, salt, params) {
  const N = 2 ** params.logN;
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      Buffer.from(String(password).normalize("NFC"), "utf8"),
      salt,
      32,
      { N, r: params.r, p: params.p, maxmem: 256 * N * params.r + 16 * 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key))
    );
  });
}

function keyCheck(key) {
  return crypto.createHmac("sha256", key).update("key-check").digest().subarray(0, CHECK_LEN);
}

/**
 * Derive the key for a new backup password. The result is what the desktop app stores
 * (protected by Windows); the password itself is never stored.
 * 【中文】由新的备份密码生成钥匙（只保存钥匙，不保存密码本身）。
 */
async function createBackupKey(password, params = DEFAULT_PARAMS) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD) throw codeError("TOO_SHORT", "password too short");
  const salt = crypto.randomBytes(SALT_LEN);
  const key = await scryptKey(password, salt, params);
  return { v: 1, logN: params.logN, r: params.r, p: params.p, salt: salt.toString("base64"), key: key.toString("hex") };
}

function buildHeader(info, iv) {
  const key = Buffer.from(info.key, "hex");
  const salt = Buffer.from(info.salt, "base64");
  if (key.length !== 32 || salt.length !== SALT_LEN) throw new Error("invalid backup key");
  return Buffer.concat([MAGIC, Buffer.from([info.logN, info.r, info.p, SALT_LEN]), salt, keyCheck(key), iv]);
}

function parseHeader(buf) {
  if (!buf || buf.length < HEADER_LEN || !buf.subarray(0, MAGIC.length).equals(MAGIC)) return null;
  let o = MAGIC.length;
  const logN = buf[o++], r = buf[o++], p = buf[o++], saltLen = buf[o++];
  // Refuse parameters far from what this app writes (DEFAULT_PARAMS: 32 MiB, p = 1): a damaged
  // or crafted file must not make scrypt take gigabytes of memory or minutes of CPU while the
  // restore cannot be cancelled. 【中文】只接受接近本程序设定的参数，防止损坏 / 伪造的文件占用大量内存和时间。
  if (logN < 10 || logN > 20 || r < 1 || p < 1 || p > MAX_SCRYPT_P || saltLen !== SALT_LEN) return null;
  if (128 * 2 ** logN * r > MAX_SCRYPT_MEM) return null;
  const salt = buf.subarray(o, o + SALT_LEN); o += SALT_LEN;
  const check = buf.subarray(o, o + CHECK_LEN); o += CHECK_LEN;
  const iv = buf.subarray(o, o + IV_LEN);
  return { logN, r, p, salt, check, iv, header: buf.subarray(0, HEADER_LEN) };
}

async function readRange(file, start, length) {
  const fh = await fsp.open(file, "r");
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buf, 0, length, start);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

function readHeadSync(file, length) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(length);
    const n = fs.readSync(fd, buf, 0, length, 0);
    return buf.subarray(0, n);
  } catch {
    return Buffer.alloc(0);
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
  }
}

/** True when the file starts like one of our encrypted backups. */
function isEncryptedBackupFile(file) {
  return readHeadSync(file, MAGIC.length).equals(MAGIC);
}

/** True when the file starts with the SQLite header ("SQLite format 3\0"). */
function isSqliteFile(file) {
  return readHeadSync(file, SQLITE_HEADER.length).equals(SQLITE_HEADER);
}

/**
 * Encrypt src into dest (written as dest.partial, renamed when complete).
 * 【中文】把 src 加密写到 dest（先写临时文件，完成后再改名，避免半个文件）。
 */
async function encryptFile(src, dest, info) {
  const iv = crypto.randomBytes(IV_LEN);
  const header = buildHeader(info, iv);
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(info.key, "hex"), iv);
  cipher.setAAD(header);
  const tmp = dest + ".partial";
  try {
    await fsp.writeFile(tmp, header);
    await pipeline(fs.createReadStream(src), cipher, fs.createWriteStream(tmp, { flags: "a" }));
    await fsp.appendFile(tmp, cipher.getAuthTag());
    await fsp.rename(tmp, dest);
  } catch (e) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

/**
 * Decrypt an encrypted backup into dest. Wrong password → error with code WRONG_PASSWORD;
 * not one of our files → NOT_A_BACKUP; damaged / altered → DAMAGED. dest is removed on error.
 * `keyCache` (a Map) lets many files made with the same password share one scrypt run.
 * 【中文】解密备份：密码错误 / 不是备份文件 / 文件损坏会给出不同的错误代码，失败时删除输出文件。
 */
async function decryptFile(src, dest, password, keyCache) {
  const st = await fsp.stat(src);
  if (st.size < HEADER_LEN + TAG_LEN) throw codeError("NOT_A_BACKUP");
  const h = parseHeader(await readRange(src, 0, HEADER_LEN));
  if (!h) throw codeError("NOT_A_BACKUP");
  const cacheKey = [h.salt.toString("base64"), h.logN, h.r, h.p, String(password)].join("|");
  let key = keyCache && keyCache.get(cacheKey);
  if (!key) {
    key = await scryptKey(password, h.salt, h);
    if (keyCache) keyCache.set(cacheKey, key);
  }
  if (!crypto.timingSafeEqual(keyCheck(key), h.check)) throw codeError("WRONG_PASSWORD");
  const tag = await readRange(src, st.size - TAG_LEN, TAG_LEN);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, h.iv);
  decipher.setAAD(h.header);
  decipher.setAuthTag(tag);
  try {
    const bodyEnd = st.size - TAG_LEN - 1;
    if (bodyEnd < HEADER_LEN) {
      await fsp.writeFile(dest, decipher.final());
    } else {
      await pipeline(fs.createReadStream(src, { start: HEADER_LEN, end: bodyEnd }), decipher, fs.createWriteStream(dest));
    }
  } catch (e) {
    await fsp.rm(dest, { force: true }).catch(() => {});
    if (/authenticate/i.test(String(e && e.message))) throw codeError("DAMAGED", "backup file is damaged or was changed");
    throw e;
  }
}

module.exports = {
  DEFAULT_PARAMS,
  MIN_PASSWORD,
  createBackupKey,
  encryptFile,
  decryptFile,
  isEncryptedBackupFile,
  isSqliteFile,
};
