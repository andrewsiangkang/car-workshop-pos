// AES-256-GCM sealing for secrets kept in the database (e.g. the MyInvois client secret).
// Pure helpers: the key is passed in, so they can be unit-tested with a fixed test key.
// The real key is per installation and is NOT in the database: the desktop app keeps it
// protected by Windows (DPAPI, electron safeStorage) and passes it in as WORKSHOP_DATA_KEY.
// 【中文】数据库里的密钥（如 MyInvois Client Secret）用 AES-256-GCM 加密保存；加密钥匙不在数据库里，由桌面程序用 Windows 保护后传给服务器。
import crypto from "node:crypto";

/** Stored values that start with this are sealed; anything else is a plain value from an older version. */
export const SEAL_PREFIX = "enc:v1:";
const AAD = Buffer.from(SEAL_PREFIX, "utf8");
const IV_LEN = 12;
const TAG_LEN = 16;

/**
 * 32-byte key from 64 hex characters (what the desktop app passes) or base64.
 * Returns null when missing or malformed.
 * @param {unknown} value
 * @returns {Buffer | null}
 */
export function parseDataKey(value) {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (/^[0-9a-fA-F]{64}$/.test(v)) return Buffer.from(v, "hex");
  if (/^[A-Za-z0-9+/]{43}=$/.test(v)) {
    const b = Buffer.from(v, "base64");
    return b.length === 32 ? b : null;
  }
  return null;
}

/** @param {unknown} stored */
export function isSealed(stored) {
  return typeof stored === "string" && stored.startsWith(SEAL_PREFIX);
}

/**
 * Seal a secret: "enc:v1:" + base64(iv | tag | ciphertext). A fresh random IV every time.
 * 【中文】加密：返回 enc:v1:<base64(iv|tag|密文)>，每次随机 IV。
 * @param {string} plain
 * @param {Buffer} key
 * @returns {string}
 */
export function sealWith(plain, key) {
  if (!key || key.length !== 32) throw new Error("secret-box: a 32-byte key is required");
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(AAD);
  const ct = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  return SEAL_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

/**
 * Plain secret from a stored value. Plain (legacy) values pass through unchanged.
 * A sealed value with a missing or wrong key, or a damaged value, gives null: the app then
 * treats the secret as "not configured" and the boss types it in again. Never throws.
 * 【中文】解密：旧版本的明文原样返回；钥匙不对 / 缺失 / 数据损坏时返回 null（不抛错），老板重新输入即可。
 * @param {string | null | undefined} stored
 * @param {Buffer | null | undefined} key
 * @returns {string | null}
 */
export function revealWith(stored, key) {
  if (stored == null) return null;
  if (!isSealed(stored)) return stored;
  if (!key || key.length !== 32) return null;
  try {
    const raw = Buffer.from(stored.slice(SEAL_PREFIX.length), "base64");
    if (raw.length < IV_LEN + TAG_LEN) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, raw.subarray(0, IV_LEN));
    decipher.setAAD(AAD);
    decipher.setAuthTag(raw.subarray(IV_LEN, IV_LEN + TAG_LEN));
    return Buffer.concat([decipher.update(raw.subarray(IV_LEN + TAG_LEN)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
