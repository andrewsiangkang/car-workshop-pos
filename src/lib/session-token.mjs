// Edge-safe session helpers shared by middleware.ts (Edge runtime) and auth.ts (Node).
// No Node.js imports here: only Web Crypto, TextEncoder and atob, which both runtimes have.
// 【中文】登录凭证的共用工具：中间件（Edge）和 auth.ts（Node）都用；只用 Web Crypto，两种运行环境都支持。

/** Name of the login cookie. */
export const SESSION_COOKIE = "session";

/**
 * Per-installation signing secret. The desktop app generates it on first run and passes
 * it in as AUTH_SECRET. Throws in production when it is missing.
 * 【中文】读取本机专属的签名密钥（AUTH_SECRET），用来给登录凭证签名，防止被伪造。
 * @returns {string}
 */
export function getAuthSecret() {
  const s = process.env.AUTH_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET is not set");
  }
  return "dev-only-secret-not-for-production";
}

/**
 * The AUTH_SECRET this installation was really given, or null. Unlike getAuthSecret() it never
 * falls back to the public development string, so anything keyed with it (desktop proof header,
 * internal backup token) cannot be forged from the source code on a start.bat / `npm run dev` run.
 * 【中文】只返回真正配置的 AUTH_SECRET；没有配置时返回 null（不使用源码里公开的开发用密钥），
 * 这样桌面证明头和内部备份签名在 npm run dev 下无法被伪造。
 * @returns {string | null}
 */
export function getConfiguredAuthSecret() {
  const s = process.env.AUTH_SECRET;
  return s && s.length >= 16 ? s : null;
}

const enc = new TextEncoder();
/** @type {{ secret: string, key: Promise<CryptoKey> } | null} */
let cachedKey = null;

/** @param {string} secret */
function hmacKey(secret) {
  if (!cachedKey || cachedKey.secret !== secret) {
    cachedKey = {
      secret,
      key: crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]),
    };
  }
  return cachedKey.key;
}

/** @param {string} b64url */
function base64UrlToText(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b64url.length / 4) * 4, "=");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** @param {string} hex */
function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Checks the cookie's HMAC signature and expiry, without the database. The format is the
 * one createSessionToken() in auth.ts writes: base64url("userId|expiry|fp|hexHmac").
 * A forged or expired cookie returns false. (Pages and API routes still load the user
 * from the database, so deleted users and reset passwords are caught there.)
 * 【中文】只校验登录凭证的签名和有效期（不查数据库）。伪造或过期的 cookie 返回 false。
 * @param {string} token
 * @returns {Promise<boolean>}
 */
export async function verifySessionSignature(token) {
  try {
    const parts = base64UrlToText(String(token || "")).split("|");
    if (parts.length !== 4) return false;
    const [userId, expiryStr, fp, sig] = parts;
    if (!(Date.now() <= Number(expiryStr))) return false;
    if (!/^[0-9a-f]{64}$/.test(sig)) return false;
    const key = await hmacKey(getAuthSecret());
    // crypto.subtle.verify compares in constant time.
    return await crypto.subtle.verify("HMAC", key, hexToBytes(sig), enc.encode(`${userId}|${expiryStr}|${fp}`));
  } catch {
    return false;
  }
}
