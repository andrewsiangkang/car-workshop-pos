// Pure account / login rules shared by the API routes and the browser (no Node or Next.js imports),
// so they can be unit-tested with node:test.
// 【中文】账号与登录的纯规则（不依赖 Node / Next.js）：登录限速、本机请求判断、账号停用 / 改角色的限制、弹窗输入校验。

/** Minimum password length for every account. 【中文】密码最少长度（8 位）。 */
export const MIN_PASSWORD_LENGTH = 8;

// ===== Login throttle =====

/** Failed attempts allowed before the username is locked for the first time. */
export const LOGIN_FREE_ATTEMPTS = 5;
/** First lock length; it doubles with each further failure. */
export const LOGIN_BASE_LOCK_SECONDS = 30;
/** The lock never grows past 15 minutes, so a LAN device cannot lock the boss out for longer. */
export const LOGIN_MAX_LOCK_SECONDS = 15 * 60;
/** After an hour with no attempt the count starts again from zero. */
export const LOGIN_RESET_AFTER_MS = 60 * 60 * 1000;

/**
 * How long the username stays locked after its n-th failed attempt in a row (0 = no lock).
 * 5 → 30 s, 6 → 1 min, 7 → 2 min, 8 → 4 min, 9 → 8 min, 10 or more → 15 min.
 * 【中文】连续第 n 次失败后锁定多少秒：前 4 次不锁，之后 30 秒起每次加倍，最多 15 分钟。
 * @param {number} failures
 * @returns {number}
 */
export function lockSecondsAfter(failures) {
  const n = Math.floor(Number(failures) || 0);
  if (n < LOGIN_FREE_ATTEMPTS) return 0;
  const steps = Math.min(n - LOGIN_FREE_ATTEMPTS, 20); // 2^20 is far past the cap; avoids huge numbers
  return Math.min(LOGIN_MAX_LOCK_SECONDS, LOGIN_BASE_LOCK_SECONDS * 2 ** steps);
}

/**
 * The failure counts where the lock length changes, highest first: [[10, 900], [9, 480], … [5, 30]].
 * @returns {Array<[number, number]>}
 */
export function lockSteps() {
  /** @type {Array<[number, number]>} */
  const out = [];
  for (let n = LOGIN_FREE_ATTEMPTS; ; n++) {
    const s = lockSecondsAfter(n);
    out.push([n, s]);
    if (s >= LOGIN_MAX_LOCK_SECONDS) break;
  }
  return out.reverse();
}

/**
 * One SQL statement that reserves a login attempt for this username (key) BEFORE the password
 * is checked: it adds 1 to the failure count and sets the new lock time, but only when the
 * username is not locked right now. SQLite runs one statement at a time, so parallel requests
 * cannot all slip past the lock (the old code checked first and counted later).
 * Affected rows: 1 = attempt allowed, 0 = locked. A correct password then deletes the row.
 * Times are stored as ISO text ("2026-11-14T10:00:00.000Z"), which compares correctly as text.
 * 【中文】生成一条原子 SQL：在核对密码之前，先「预约」一次登录尝试——没被锁时失败次数 +1 并按新次数设定锁定时间；
 * 已被锁时什么都不改（影响 0 行 = 拒绝）。同时多个请求也无法绕过锁定。密码正确后再删掉这条记录。
 * @param {string} key  digest of the normalised username
 * @param {number} nowMs
 * @returns {{ sql: string, params: Array<string | number | null> }}
 */
export function buildReserveAttemptSql(key, nowMs) {
  /** @type {Array<string | number | null>} */
  const params = [];
  // Adds a bound value and returns its placeholder (template parts are evaluated left to right).
  const p = (/** @type {string | number | null} */ v) => {
    params.push(v);
    return "?";
  };
  const now = new Date(nowMs).toISOString();
  const cutoff = new Date(nowMs - LOGIN_RESET_AFTER_MS).toISOString();
  const lockAt = (/** @type {number} */ n) => {
    const s = lockSecondsAfter(n);
    return s ? new Date(nowMs + s * 1000).toISOString() : null;
  };
  // New failure count for an existing row ("updatedAt" here is the row's previous attempt).
  const count = () => `(CASE WHEN "updatedAt" < ${p(cutoff)} THEN 1 ELSE "failures" + 1 END)`;
  const lockCase = () =>
    `CASE ${lockSteps()
      .map(([n]) => `WHEN ${count()} >= ${n} THEN ${p(lockAt(n))}`)
      .join(" ")} ELSE NULL END`;

  const sql =
    `INSERT INTO "LoginThrottle" ("key", "failures", "windowStartedAt", "lockedUntil", "updatedAt") ` +
    `VALUES (${p(key)}, 1, ${p(now)}, ${p(lockAt(1))}, ${p(now)}) ` +
    `ON CONFLICT("key") DO UPDATE SET ` +
    `"failures" = ${count()}, ` +
    `"windowStartedAt" = CASE WHEN "updatedAt" < ${p(cutoff)} THEN ${p(now)} ELSE "windowStartedAt" END, ` +
    `"lockedUntil" = ${lockCase()}, ` +
    `"updatedAt" = ${p(now)} ` +
    `WHERE ("lockedUntil" IS NULL OR "lockedUntil" <= ${p(now)})`;
  return { sql, params };
}

/**
 * Seconds left on a lock, for the "try again in…" message (at least 1).
 * Accepts the stored ISO text, an older "YYYY-MM-DD HH:MM:SS" (UTC) value, a Date or epoch ms.
 * @param {string | Date | number | null | undefined} lockedUntil
 * @param {number} nowMs
 * @returns {number}
 */
export function waitSecondsUntil(lockedUntil, nowMs) {
  const t = lockTimeMs(lockedUntil);
  if (!Number.isFinite(t)) return LOGIN_MAX_LOCK_SECONDS;
  return Math.min(LOGIN_MAX_LOCK_SECONDS, Math.max(1, Math.ceil((t - nowMs) / 1000)));
}

/**
 * Stored lock time as epoch ms (NaN when missing or unreadable).
 * @param {string | Date | number | null | undefined} lockedUntil
 * @returns {number}
 */
function lockTimeMs(lockedUntil) {
  if (lockedUntil instanceof Date) return lockedUntil.getTime();
  if (typeof lockedUntil === "number") return lockedUntil;
  if (typeof lockedUntil !== "string") return NaN;
  const s = lockedUntil.trim();
  return Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? s.replace(" ", "T") + "Z" : s);
}

/**
 * Like waitSecondsUntil(), but 0 when the username is NOT locked any more: no row (a correct
 * login cleared it), no lock time, or a lock time that has already passed.
 * 【中文】剩余锁定秒数；记录已被删除、没有锁定时间或锁定已过期时返回 0（表示其实没被锁）。
 * @param {string | Date | number | null | undefined} lockedUntil
 * @param {number} nowMs
 * @returns {number}
 */
export function lockWaitSeconds(lockedUntil, nowMs) {
  if (lockedUntil === null || lockedUntil === undefined || lockedUntil === "") return 0;
  const t = lockTimeMs(lockedUntil);
  // Unreadable text: the database still said "locked", so keep the cautious maximum.
  if (Number.isFinite(t) && t <= nowMs) return 0;
  return waitSecondsUntil(lockedUntil, nowMs);
}

/**
 * Reserves a login attempt (see buildReserveAttemptSql). When the reservation is refused, the
 * lock time is read in a second statement; if the row vanished in between (a correct login or a
 * desktop login cleared it) or the lock just ran out, it tries ONCE more instead of answering
 * "wait 15 minutes" for a username that is not locked. Database access is passed in, so this
 * can be tested against a real SQLite file.
 * 【中文】预约登录尝试；被拒后读取锁定时间，如果这期间记录已被清除或锁定刚好到期，就再试一次，
 * 不会错误地回复「15 分钟后再试」。
 * @param {{ reserve: (nowMs: number) => Promise<boolean>,
 *           readLockedUntil: () => Promise<string | Date | number | null | undefined>,
 *           now?: () => number }} io
 * @returns {Promise<{ ok: true } | { ok: false, waitSeconds: number }>}
 */
export async function reserveLoginWithRetry({ reserve, readLockedUntil, now = Date.now }) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const t = now();
    if (await reserve(t)) return { ok: true };
    const wait = lockWaitSeconds(await readLockedUntil(), t);
    if (wait > 0) return { ok: false, waitSeconds: wait };
  }
  // Still refused although no lock can be seen: someone else is racing on this username. Short wait.
  return { ok: false, waitSeconds: 1 };
}

// ===== Is this request from the shop computer itself? =====

/**
 * Host name from a Host header, lower-case, without the port: "127.0.0.1:3000" → "127.0.0.1",
 * "[::1]:3000" → "::1". Returns "" when missing or malformed.
 * @param {string | null | undefined} host
 * @returns {string}
 */
export function hostnameOf(host) {
  const h = String(host ?? "").trim().toLowerCase();
  if (!h) return "";
  if (h.startsWith("[")) {
    const m = /^\[([0-9a-f:.]+)\](?::\d{1,5})?$/.exec(h);
    return m ? m[1] : "";
  }
  const m = /^([a-z0-9.-]+)(?::\d{1,5})?$/.exec(h);
  return m ? m[1] : "";
}

/** @param {string} ip */
function isLoopbackIPv4(ip) {
  const m = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  return !!m && m.slice(1).every((x) => Number(x) <= 255);
}

/**
 * True only for this computer's own names. A DNS-rebinding page ("evil.example" pointing at
 * 127.0.0.1) still sends its own name in the Host header, so it fails this check.
 * @param {string} hostname  output of hostnameOf()
 * @returns {boolean}
 */
export function isLoopbackHostname(hostname) {
  return hostname === "localhost" || hostname === "::1" || isLoopbackIPv4(hostname);
}

/**
 * True when the client address (the X-Forwarded-For value Next.js fills in from the socket)
 * is this computer. More than one address means the request came through a proxy: not local.
 * @param {string | null | undefined} forwardedFor
 * @returns {boolean}
 */
export function isLoopbackAddress(forwardedFor) {
  const a = String(forwardedFor ?? "").trim().toLowerCase();
  if (!a || a.includes(",")) return false;
  if (a === "::1" || a === "0:0:0:0:0:0:0:1") return true;
  return isLoopbackIPv4(a.startsWith("::ffff:") ? a.slice(7) : a);
}

/**
 * Where a request comes from:
 * - "desktop": proven to be this computer — the desktop app's proof header matched, or the
 *   server only listens on 127.0.0.1 (phone / tablet access off), and Host + client address are local.
 * - "loopback": Host and client address say 127.0.0.1, but the server also listens on the LAN,
 *   where a non-browser client could fake both headers. Not trusted for bypassing the lock.
 * - "remote": anything else (phone / tablet, another PC, a DNS-rebinding web page).
 * 【中文】判断请求来源：desktop = 确认是这台电脑（桌面程序证明头，或服务器只监听本机）；
 * loopback = 看起来是本机但服务器也在监听局域网（可能被伪造）；remote = 其他设备或 DNS 重绑定网页。
 * @param {{ host?: string | null, forwardedFor?: string | null, lanAccess?: string | null, desktopProof?: boolean, peerAddress?: string | null }} r
 *   lanAccess = process.env.WORKSHOP_LAN_ACCESS ("0" = desktop app with phone access off, "1" = on, unset = dev / manual run)
 *   peerAddress = the socket address recorded by the server (null / undefined = not known)
 * @returns {"desktop" | "loopback" | "remote"}
 */
export function classifyRequestOrigin({ host, forwardedFor, lanAccess, desktopProof, peerAddress }) {
  if (!isLoopbackHostname(hostnameOf(host))) return "remote";
  if (!isLoopbackAddress(forwardedFor)) return "remote";
  // The socket address seen by the server itself (privacy-peer.ts), when known: a LAN device
  // that types a local X-Forwarded-For is still remote. 【中文】服务器自己看到的连接地址不是本机 → 一定是其他设备。
  if (peerAddress !== undefined && peerAddress !== null && !isLoopbackAddress(peerAddress)) return "remote";
  if (desktopProof === true) return "desktop";
  if (lanAccess === "0") return "desktop";
  return "loopback";
}

/**
 * May the first boss account be created from this request?
 * - "desktop" → yes.
 * - "loopback" on a dev / manual run (start.bat, `npm run dev`; no desktop app) → only with the
 *   one-time setup code printed in the server window. `next dev` listens on every network and
 *   Next.js keeps an X-Forwarded-For header the client sent, so a LAN device can fake both the
 *   Host and the address; only someone at the shop computer can read the server window.
 * - "loopback" while the desktop app has phone / tablet access ON → no ("LAN_ON"): turn it off first.
 * - "remote" → no ("NOT_LOCAL").
 * 【中文】首次设置（创建老板账号）只能在这台电脑上进行。手动运行（start.bat / npm run dev）时，
 * 局域网设备可以伪造本机请求头，所以还要输入服务器窗口里显示的一次性设置码。
 * @param {"desktop" | "loopback" | "remote"} origin
 * @param {string | null | undefined} lanAccess
 * @param {boolean} [setupCodeOk]  the request carried the right setup code
 * @returns {{ ok: true } | { ok: false, code: "NOT_LOCAL" | "LAN_ON" | "NEED_CODE" }}
 */
export function setupDecision(origin, lanAccess, setupCodeOk = false) {
  if (origin === "desktop") return { ok: true };
  if (origin === "loopback") {
    if (lanAccess === "1") return { ok: false, code: "LAN_ON" };
    return setupCodeOk === true ? { ok: true } : { ok: false, code: "NEED_CODE" };
  }
  return { ok: false, code: "NOT_LOCAL" };
}

// ===== One-time setup code (dev / manual runs) =====

/** 32 symbols without 0 / O / 1 / I, so the code is easy to read off the screen; 32 = no bias from `byte & 31`. */
export const SETUP_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
/** 10 symbols = 50 random bits: far too many to guess over the network. */
export const SETUP_CODE_LENGTH = 10;

/**
 * Turns random bytes (at least SETUP_CODE_LENGTH) into a code like "K7Q2M-XH9TD".
 * 【中文】把随机字节变成设置码（例如 K7Q2M-XH9TD）。
 * @param {ArrayLike<number>} bytes
 * @returns {string}
 */
export function setupCodeFromBytes(bytes) {
  if (!bytes || bytes.length < SETUP_CODE_LENGTH) throw new Error("setup code needs more random bytes");
  let out = "";
  for (let i = 0; i < SETUP_CODE_LENGTH; i++) out += SETUP_CODE_ALPHABET[bytes[i] & 31];
  return out.slice(0, 5) + "-" + out.slice(5);
}

/**
 * Code as typed → comparable form: upper-case, spaces and dashes removed.
 * @param {unknown} s
 * @returns {string}
 */
export function normalizeSetupCode(s) {
  return typeof s === "string" ? s.toUpperCase().replace(/[^0-9A-Z]/g, "") : "";
}

/**
 * True when the typed code is the expected one (compared without an early exit).
 * @param {string | null | undefined} expected
 * @param {unknown} given
 * @returns {boolean}
 */
export function setupCodeMatches(expected, given) {
  const a = normalizeSetupCode(expected);
  const b = normalizeSetupCode(given);
  if (a.length !== SETUP_CODE_LENGTH || b.length !== a.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ===== Logout =====

/**
 * Does this logout end the account's sessions on EVERY device? Only when the request body says
 * {"everywhere": true} (a deliberate "Log Out"). The idle logout, and any request without that
 * body, only clears the cookie on the device that sent it: there is no session table, so ending
 * sessions means ending them everywhere, and an idle phone must not kill a work order on the PC.
 * 【中文】这次登出是否结束该账号在所有设备上的登录？只有请求里带 {"everywhere": true}（用户主动登出）才会；
 * 闲置自动登出只清除本设备的 cookie，免得口袋里的手机醒来把电脑上正在填写的工单登出。
 * @param {unknown} body  parsed JSON body (or null when there was none)
 * @returns {boolean}
 */
export function logoutEndsAllSessions(body) {
  return !!body && typeof body === "object" && /** @type {{ everywhere?: unknown }} */ (body).everywhere === true;
}

// ===== Session lifetime and cookie flags =====

/** Login on the shop computer itself: 7 days. */
export const SESSION_SECONDS_SHOP_COMPUTER = 7 * 24 * 60 * 60;
/**
 * Login from a phone, tablet or another PC on the shop Wi-Fi: 12 hours. The app runs over plain
 * HTTP there (no certificate), so a copied login cookie stops working the same day.
 */
export const SESSION_SECONDS_LAN_DEVICE = 12 * 60 * 60;

/**
 * How long a new login lasts, by where the request comes from (classifyRequestOrigin): another
 * device on the network ("remote") gets the short lifetime; the shop computer the long one.
 * 【中文】登录有效期：手机、平板或其他电脑（经店里 Wi-Fi，明文 HTTP）12 小时；店里电脑本机 7 天。
 * @param {"desktop" | "loopback" | "remote"} origin
 * @returns {number} seconds
 */
export function sessionMaxAgeSeconds(origin) {
  return origin === "desktop" || origin === "loopback" ? SESSION_SECONDS_SHOP_COMPUTER : SESSION_SECONDS_LAN_DEVICE;
}

/**
 * Secure cookie flag: on when the request came over HTTPS (or COOKIE_SECURE=1). Over plain HTTP a
 * Secure cookie would never be stored, so it stays off there.
 * 【中文】只有 HTTPS 请求（或设置 COOKIE_SECURE=1）才加 Secure 标记；明文 HTTP 下加了浏览器会不保存 cookie。
 * @param {{ forwardedProto?: string | null, urlProtocol?: string | null, force?: string | null }} r
 * @returns {boolean}
 */
export function cookieShouldBeSecure({ forwardedProto, urlProtocol, force }) {
  if (force === "1") return true;
  const proto = String(forwardedProto ?? "").split(",")[0].trim().toLowerCase();
  return proto === "https" || String(urlProtocol ?? "").toLowerCase() === "https:";
}

// ===== Session fingerprint =====

/**
 * Text that is signed into every login cookie: the password hash plus the account's updatedAt.
 * Changing either (password reset, a "log out everywhere", disable, role change…) ends all old sessions.
 * @param {string} passwordHash
 * @param {number} updatedAtMs
 * @returns {string}
 */
export function sessionFingerprintInput(passwordHash, updatedAtMs) {
  return `pw:${passwordHash}|u:${Number(updatedAtMs)}`;
}

// ===== Boss changes to an account =====

/**
 * Checks a boss's change to an account (role and / or disabled). Returns an English error, or "" when allowed.
 * There must always be at least one Boss account that can still sign in.
 * 【中文】检查老板对账号的修改：不能停用自己、不能取消自己的老板权限、必须至少留一个能登录的老板账号。
 * @param {{ isSelf: boolean, currentRole: string, currentlyDisabled: boolean,
 *           nextRole?: string, nextDisabled?: boolean, otherActiveOwners: number }} c
 * @returns {string}
 */
export function accountChangeError({ isSelf, currentRole, currentlyDisabled, nextRole, nextDisabled, otherActiveOwners }) {
  if (isSelf && nextDisabled === true) return "You cannot disable your own account";
  if (isSelf && nextRole !== undefined && nextRole !== "OWNER") return "You cannot remove your own boss access";
  const role = nextRole ?? currentRole;
  const disabled = nextDisabled ?? currentlyDisabled;
  const wasActiveOwner = currentRole === "OWNER" && !currentlyDisabled;
  const staysActiveOwner = role === "OWNER" && !disabled;
  if (wasActiveOwner && !staysActiveOwner && otherActiveOwners < 1) {
    return "At least one active Boss account is needed";
  }
  return "";
}

// ===== In-page prompt dialog =====

/**
 * Checks what was typed into a PromptDialog. Returns an English error, or "" when fine.
 * @param {{ value: string, required?: boolean, minLength?: number, confirm?: boolean, confirmValue?: string }} v
 * @returns {string}
 */
export function promptValueError({ value, required, minLength, confirm, confirmValue }) {
  const s = String(value ?? "");
  if (required && !s.trim()) return "Please fill this in";
  if (minLength && s.length < minLength) return `Must be at least ${minLength} characters`;
  if (confirm && s !== String(confirmValue ?? "")) return "The two passwords do not match";
  return "";
}
