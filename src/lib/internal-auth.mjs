// Checks for calls from the desktop app (Electron main process) to /api/internal/*.
// The desktop app knows AUTH_SECRET (it generated it and passes it to this server), so it
// sends "<timestamp>.<HMAC-SHA256(AUTH_SECRET, label|timestamp)>". Browsers, phones and
// other programs on the network do not know the secret. Must match electron/internal-auth.js.
// 【中文】桌面程序调用内部接口的凭证校验：用本机 AUTH_SECRET 做 HMAC 签名并带时间戳，别人无法伪造；与 electron/internal-auth.js 必须一致。
import crypto from "node:crypto";

export const INTERNAL_HEADER = "x-workshop-internal";
const LABEL = "workshop-internal-v1|";
/** A token is accepted for 2 minutes either side of the server clock. */
export const MAX_SKEW_MS = 120_000;

/**
 * @param {string} secret
 * @param {number} [now]
 * @returns {string}
 */
export function makeInternalToken(secret, now = Date.now()) {
  const ts = String(Math.floor(now));
  return ts + "." + crypto.createHmac("sha256", secret).update(LABEL + ts).digest("hex");
}

/**
 * True only for a fresh token signed with this installation's secret. Constant-time compare.
 * @param {unknown} header
 * @param {string | null | undefined} secret
 * @param {number} [now]
 * @returns {boolean}
 */
export function checkInternalToken(header, secret, now = Date.now()) {
  if (!secret || typeof header !== "string") return false;
  const m = /^(\d{10,16})\.([0-9a-f]{64})$/.exec(header);
  if (!m) return false;
  if (Math.abs(now - Number(m[1])) > MAX_SKEW_MS) return false;
  const want = crypto.createHmac("sha256", secret).update(LABEL + m[1]).digest();
  return crypto.timingSafeEqual(want, Buffer.from(m[2], "hex"));
}

/**
 * Socket address of this computer (IPv4 / IPv6 loopback).
 * @param {string | null | undefined} addr
 */
export function isLoopbackAddress(addr) {
  const a = String(addr || "").split(",")[0].trim();
  return a === "::1" || /^(::ffff:)?127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(a);
}

/**
 * Host header naming this computer, e.g. "127.0.0.1:3210" (blocks DNS-rebinding pages).
 * @param {string | null | undefined} host
 */
export function isLoopbackHost(host) {
  return /^(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?$/i.test(String(host || ""));
}
