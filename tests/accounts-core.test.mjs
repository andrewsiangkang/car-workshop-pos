import test from "node:test";
import assert from "node:assert/strict";
import {
  MIN_PASSWORD_LENGTH,
  LOGIN_FREE_ATTEMPTS,
  LOGIN_MAX_LOCK_SECONDS,
  LOGIN_RESET_AFTER_MS,
  lockSecondsAfter,
  lockSteps,
  buildReserveAttemptSql,
  waitSecondsUntil,
  lockWaitSeconds,
  reserveLoginWithRetry,
  hostnameOf,
  isLoopbackAddress,
  classifyRequestOrigin,
  setupDecision,
  SETUP_CODE_ALPHABET,
  SETUP_CODE_LENGTH,
  setupCodeFromBytes,
  setupCodeMatches,
  logoutEndsAllSessions,
  sessionFingerprintInput,
  accountChangeError,
  promptValueError,
  sessionMaxAgeSeconds,
  cookieShouldBeSecure,
  SESSION_SECONDS_SHOP_COMPUTER,
  SESSION_SECONDS_LAN_DEVICE,
} from "../src/lib/accounts-core.mjs";

// ===== Login backoff =====

test("first failures are free, then the lock doubles from 30 s and stops at 15 minutes", () => {
  for (let n = 0; n < LOGIN_FREE_ATTEMPTS; n++) assert.equal(lockSecondsAfter(n), 0, `failure ${n}`);
  assert.deepEqual(
    [5, 6, 7, 8, 9, 10, 11, 50, 1e9].map(lockSecondsAfter),
    [30, 60, 120, 240, 480, 900, 900, 900, 900]
  );
  assert.equal(LOGIN_MAX_LOCK_SECONDS, 15 * 60);
  assert.deepEqual(lockSteps(), [[10, 900], [9, 480], [8, 240], [7, 120], [6, 60], [5, 30]]);
});

test("wait message seconds: ISO text, old SQLite datetime text, Date, and never below 1 or above the cap", () => {
  const now = Date.parse("2026-11-14T10:00:00.000Z");
  assert.equal(waitSecondsUntil("2026-11-14T10:00:30.000Z", now), 30);
  assert.equal(waitSecondsUntil("2026-11-14 10:01:00", now), 60); // old rows were UTC without "T…Z"
  assert.equal(waitSecondsUntil(new Date(now + 90_500), now), 91);
  assert.equal(waitSecondsUntil("2026-11-14T09:00:00.000Z", now), 1);
  assert.equal(waitSecondsUntil("2026-11-15T10:00:00.000Z", now), LOGIN_MAX_LOCK_SECONDS);
  assert.equal(waitSecondsUntil("garbage", now), LOGIN_MAX_LOCK_SECONDS);
});

test("lock wait: 0 when the lock is gone (no row, no lock time, already over)", () => {
  const now = Date.parse("2026-11-14T10:00:00.000Z");
  assert.equal(lockWaitSeconds(undefined, now), 0); // row deleted by a correct login
  assert.equal(lockWaitSeconds(null, now), 0);
  assert.equal(lockWaitSeconds("", now), 0);
  assert.equal(lockWaitSeconds("2026-11-14T10:00:00.000Z", now), 0); // ends right now
  assert.equal(lockWaitSeconds("2026-11-14T09:59:59.000Z", now), 0);
  assert.equal(lockWaitSeconds("2026-11-14 09:59:00", now), 0);
  assert.equal(lockWaitSeconds("2026-11-14T10:00:30.000Z", now), 30);
  assert.equal(lockWaitSeconds(new Date(now + 1), now), 1);
  assert.equal(lockWaitSeconds("garbage", now), LOGIN_MAX_LOCK_SECONDS); // unreadable: stay cautious
});

// The reservation statement is run against a real SQLite database (node:sqlite, Node 22.5+),
// with the same table the app creates in src/lib/schema-upgrade.ts.
let sqlite = null;
try {
  sqlite = await import("node:sqlite");
} catch {
  sqlite = null;
}

function throttleDb() {
  const db = new sqlite.DatabaseSync(":memory:");
  db.exec(`CREATE TABLE "LoginThrottle" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "windowStartedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" DATETIME,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  const reserve = (key, nowMs) => {
    const { sql, params } = buildReserveAttemptSql(key, nowMs);
    return Number(db.prepare(sql).run(...params).changes) === 1;
  };
  const row = (key) => db.prepare(`SELECT * FROM "LoginThrottle" WHERE "key" = ?`).get(key);
  return { db, reserve, row };
}

const T0 = Date.parse("2026-11-14T10:00:00.000Z");
const sqliteTest = sqlite ? test : test.skip;

sqliteTest("reservation counts every attempt and locks after the 5th; a locked username changes nothing", () => {
  const { reserve, row } = throttleDb();
  for (let i = 1; i <= 4; i++) {
    assert.equal(reserve("boss", T0), true, `attempt ${i}`);
    assert.equal(row("boss").lockedUntil, null);
  }
  assert.equal(reserve("boss", T0), true, "5th attempt is still checked");
  assert.equal(row("boss").failures, 5);
  assert.equal(row("boss").lockedUntil, new Date(T0 + 30_000).toISOString());
  // While locked: refused, and the count and lock are left alone.
  assert.equal(reserve("boss", T0 + 10_000), false);
  assert.equal(row("boss").failures, 5);
  assert.equal(row("boss").lockedUntil, new Date(T0 + 30_000).toISOString());
});

sqliteTest("parallel guesses cannot slip past the lock: only 5 of 50 simultaneous attempts are let through", () => {
  const { reserve } = throttleDb();
  const allowed = Array.from({ length: 50 }, () => reserve("boss", T0)).filter(Boolean).length;
  assert.equal(allowed, LOGIN_FREE_ATTEMPTS);
});

sqliteTest("each attempt after a lock doubles the next lock, capped at 15 minutes", () => {
  const { reserve, row } = throttleDb();
  let t = T0;
  for (let i = 0; i < 5; i++) reserve("boss", t);
  const seen = [];
  for (let i = 0; i < 7; i++) {
    t = Date.parse(row("boss").lockedUntil) + 1; // wait out the lock, then try again
    assert.equal(reserve("boss", t), true);
    seen.push((Date.parse(row("boss").lockedUntil) - t) / 1000);
  }
  assert.deepEqual(seen, [60, 120, 240, 480, 900, 900, 900]);
});

sqliteTest("an hour without attempts starts the count again; other usernames are not affected", () => {
  const { reserve, row } = throttleDb();
  for (let i = 0; i < 5; i++) reserve("boss", T0);
  assert.equal(reserve("ahmad", T0 + 1000), true);
  assert.equal(row("ahmad").failures, 1);
  const later = T0 + LOGIN_RESET_AFTER_MS + 1000;
  assert.equal(reserve("boss", later), true);
  assert.equal(row("boss").failures, 1);
  assert.equal(row("boss").lockedUntil, null);
});

sqliteTest("rows written by the old throttle (datetime() lock text) do not block or break", () => {
  const { db, reserve, row } = throttleDb();
  db.prepare(
    `INSERT INTO "LoginThrottle" ("key","failures","windowStartedAt","lockedUntil","updatedAt") VALUES (?,?,?,?,?)`
  ).run("boss", 15, new Date(T0 - 60_000).toISOString(), "2026-11-14 10:10:00", new Date(T0 - 60_000).toISOString());
  assert.equal(reserve("boss", T0), true);
  assert.equal(row("boss").failures, 16);
  assert.equal(row("boss").lockedUntil, new Date(T0 + 900_000).toISOString());
});

// reserveLoginWithRetry() with the same statements login-throttle.ts runs.
function throttleIo(db, key, { beforeRead = () => {}, now = () => T0 } = {}) {
  const calls = { reserve: 0, read: 0 };
  return {
    calls,
    io: {
      now,
      reserve: async (nowMs) => {
        calls.reserve++;
        const { sql, params } = buildReserveAttemptSql(key, nowMs);
        return Number(db.prepare(sql).run(...params).changes) > 0;
      },
      readLockedUntil: async () => {
        calls.read++;
        beforeRead(calls.read);
        const r = db.prepare(`SELECT CAST("lockedUntil" AS TEXT) AS "lockedUntil" FROM "LoginThrottle" WHERE "key" = ?`).get(key);
        return r?.lockedUntil ?? null;
      },
    },
  };
}

sqliteTest("locked username: the real time left is reported", async () => {
  const { db, reserve } = throttleDb();
  for (let i = 0; i < 5; i++) reserve("boss", T0);
  const { io, calls } = throttleIo(db, "boss", { now: () => T0 + 10_000 });
  assert.deepEqual(await reserveLoginWithRetry(io), { ok: false, waitSeconds: 20 });
  assert.equal(calls.reserve, 1);
});

sqliteTest("lock cleared between the refusal and the read (a correct login): tries again, no 15-minute answer", async () => {
  const { db, reserve, row } = throttleDb();
  for (let i = 0; i < 5; i++) reserve("boss", T0);
  // The boss logs in correctly at the same moment: clearLoginFailures() deletes the row.
  const { io, calls } = throttleIo(db, "boss", {
    beforeRead: (n) => n === 1 && db.prepare(`DELETE FROM "LoginThrottle" WHERE "key" = ?`).run("boss"),
  });
  assert.deepEqual(await reserveLoginWithRetry(io), { ok: true });
  assert.equal(calls.reserve, 2);
  assert.equal(row("boss").failures, 1, "this attempt is counted on a fresh row");
});

test("refused, but the lock read afterwards is already over: tries again instead of waiting", async () => {
  let reserves = 0;
  const r = await reserveLoginWithRetry({
    now: () => T0,
    reserve: async () => ++reserves > 1, // refused once, then allowed
    readLockedUntil: async () => new Date(T0 - 1000).toISOString(),
  });
  assert.deepEqual(r, { ok: true });
  assert.equal(reserves, 2);
});

test("refused twice with no lock visible: a short wait, never the 15-minute maximum", async () => {
  const r = await reserveLoginWithRetry({ reserve: async () => false, readLockedUntil: async () => undefined, now: () => T0 });
  assert.deepEqual(r, { ok: false, waitSeconds: 1 });
});

// ===== Shop computer detection =====

test("hostnameOf strips the port and handles IPv6 brackets", () => {
  assert.equal(hostnameOf("127.0.0.1:3000"), "127.0.0.1");
  assert.equal(hostnameOf("LOCALHOST:3000"), "localhost");
  assert.equal(hostnameOf("[::1]:51234"), "::1");
  assert.equal(hostnameOf("evil.example:3000"), "evil.example");
  assert.equal(hostnameOf(""), "");
  assert.equal(hostnameOf("a b"), "");
});

test("client address: loopback forms only, and never a proxy chain", () => {
  for (const a of ["127.0.0.1", "::1", "::ffff:127.0.0.1", "127.1.2.3"]) assert.equal(isLoopbackAddress(a), true, a);
  for (const a of ["", null, "192.168.1.20", "10.0.0.5", "127.0.0.1, 192.168.1.20", "::ffff:192.168.1.5", "127.0.0.300"]) {
    assert.equal(isLoopbackAddress(a), false, String(a));
  }
});

test("desktop app with phone access off: local Host + local address = the shop computer", () => {
  assert.equal(classifyRequestOrigin({ host: "127.0.0.1:41234", forwardedFor: "127.0.0.1", lanAccess: "0" }), "desktop");
  assert.equal(classifyRequestOrigin({ host: "localhost:41234", forwardedFor: "::1", lanAccess: "0" }), "desktop");
});

test("DNS rebinding and LAN devices are remote", () => {
  // A web page on evil.example whose DNS was pointed at 127.0.0.1: the browser still sends its own Host.
  assert.equal(classifyRequestOrigin({ host: "evil.example:41234", forwardedFor: "127.0.0.1", lanAccess: "0" }), "remote");
  assert.equal(classifyRequestOrigin({ host: "127.0.0.1.nip.io:41234", forwardedFor: "127.0.0.1", lanAccess: "0" }), "remote");
  // A phone opening http://192.168.1.10:41234
  assert.equal(classifyRequestOrigin({ host: "192.168.1.10:41234", forwardedFor: "192.168.1.33", lanAccess: "1" }), "remote");
  // A LAN tool that fakes Host but not its address
  assert.equal(classifyRequestOrigin({ host: "127.0.0.1:41234", forwardedFor: "192.168.1.33", lanAccess: "1" }), "remote");
});

test("phone access on: faked local headers are only 'loopback' (not trusted) unless the desktop proof matches", () => {
  const faked = { host: "127.0.0.1:41234", forwardedFor: "127.0.0.1", lanAccess: "1" };
  assert.equal(classifyRequestOrigin(faked), "loopback");
  assert.equal(classifyRequestOrigin({ ...faked, desktopProof: true }), "desktop");
  // The proof alone is not enough when the request is plainly from elsewhere.
  assert.equal(classifyRequestOrigin({ ...faked, host: "192.168.1.10:41234", desktopProof: true }), "remote");
});

test("the socket address recorded by the server beats a faked local X-Forwarded-For", () => {
  const faked = { host: "127.0.0.1:41234", forwardedFor: "127.0.0.1", lanAccess: "1" };
  // A LAN device typing local headers: its real socket address gives it away.
  assert.equal(classifyRequestOrigin({ ...faked, peerAddress: "192.168.1.33" }), "remote");
  assert.equal(classifyRequestOrigin({ ...faked, peerAddress: "::ffff:192.168.1.33", desktopProof: true }), "remote");
  // The shop computer itself, over IPv4 or IPv6 loopback.
  assert.equal(classifyRequestOrigin({ ...faked, peerAddress: "::ffff:127.0.0.1" }), "loopback");
  assert.equal(classifyRequestOrigin({ ...faked, lanAccess: "0", peerAddress: "::1", forwardedFor: "::1" }), "desktop");
  // A local proxy that adds the outside client's address is still remote.
  assert.equal(classifyRequestOrigin({ ...faked, forwardedFor: "192.168.1.33", peerAddress: "127.0.0.1" }), "remote");
  // Not known (null): the earlier header rules apply unchanged.
  assert.equal(classifyRequestOrigin({ ...faked, peerAddress: null }), "loopback");
});

test("logins from a phone, tablet or other PC last 12 hours; on the shop computer 7 days", () => {
  assert.equal(SESSION_SECONDS_LAN_DEVICE, 12 * 60 * 60);
  assert.equal(SESSION_SECONDS_SHOP_COMPUTER, 7 * 24 * 60 * 60);
  assert.equal(sessionMaxAgeSeconds("remote"), SESSION_SECONDS_LAN_DEVICE);
  assert.equal(sessionMaxAgeSeconds("desktop"), SESSION_SECONDS_SHOP_COMPUTER);
  assert.equal(sessionMaxAgeSeconds("loopback"), SESSION_SECONDS_SHOP_COMPUTER);
});

test("the login cookie is Secure only over HTTPS (or when forced), never on plain HTTP", () => {
  assert.equal(cookieShouldBeSecure({ forwardedProto: "http", urlProtocol: "http:" }), false);
  assert.equal(cookieShouldBeSecure({ forwardedProto: "https", urlProtocol: "http:" }), true);
  assert.equal(cookieShouldBeSecure({ forwardedProto: "HTTPS, http" }), true);
  assert.equal(cookieShouldBeSecure({ urlProtocol: "https:" }), true);
  assert.equal(cookieShouldBeSecure({ forwardedProto: null, urlProtocol: null, force: "1" }), true);
  assert.equal(cookieShouldBeSecure({ forwardedProto: null, urlProtocol: null, force: "0" }), false);
});

test("first-run setup: shop computer only", () => {
  assert.deepEqual(setupDecision("desktop", "0"), { ok: true });
  assert.deepEqual(setupDecision("desktop", "1"), { ok: true });
  assert.deepEqual(setupDecision("loopback", "1"), { ok: false, code: "LAN_ON" });
  assert.deepEqual(setupDecision("loopback", "1", true), { ok: false, code: "LAN_ON" });
  assert.deepEqual(setupDecision("remote", "0"), { ok: false, code: "NOT_LOCAL" });
  assert.deepEqual(setupDecision("remote", undefined), { ok: false, code: "NOT_LOCAL" });
  assert.deepEqual(setupDecision("remote", undefined, true), { ok: false, code: "NOT_LOCAL" });
});

test("start.bat / npm run dev (no desktop app): a LAN device faking local headers cannot claim the boss account", () => {
  // `next dev` listens on every network and Next.js keeps the client's own X-Forwarded-For,
  // so this is what  curl -H 'Host: localhost:3000' -H 'X-Forwarded-For: 127.0.0.1'  from a phone looks like.
  const spoofed = classifyRequestOrigin({ host: "localhost:3000", forwardedFor: "127.0.0.1", lanAccess: undefined });
  assert.equal(spoofed, "loopback");
  assert.deepEqual(setupDecision(spoofed, undefined), { ok: false, code: "NEED_CODE" });
  assert.deepEqual(setupDecision(spoofed, undefined, false), { ok: false, code: "NEED_CODE" });
  // Only with the code printed in the server window (readable at the shop computer only).
  assert.deepEqual(setupDecision(spoofed, undefined, true), { ok: true });
  // Same for any other value of the variable that is not the desktop app's "0" / "1".
  assert.deepEqual(setupDecision("loopback", "", false), { ok: false, code: "NEED_CODE" });
});

test("setup code: 10 easy-to-read symbols from random bytes, typed in any case or spacing", () => {
  const bytes = Uint8Array.from({ length: SETUP_CODE_LENGTH }, (_, i) => i * 37 + 3);
  const code = setupCodeFromBytes(bytes);
  assert.match(code, /^[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}$/);
  assert.equal(setupCodeFromBytes(bytes), code, "same bytes, same code");
  assert.equal(SETUP_CODE_ALPHABET.length, 32);
  assert.equal(new Set(SETUP_CODE_ALPHABET).size, 32);
  for (const c of "01IO") assert.equal(SETUP_CODE_ALPHABET.includes(c), false, `no ambiguous ${c}`);
  // Every symbol can appear (byte & 31 over 32 symbols: no symbol favoured).
  const seen = new Set();
  for (let b = 0; b < 256; b += SETUP_CODE_LENGTH) {
    const chunk = Uint8Array.from({ length: SETUP_CODE_LENGTH }, (_, i) => (b + i) & 255);
    for (const ch of setupCodeFromBytes(chunk).replace("-", "")) seen.add(ch);
  }
  assert.equal(seen.size, 32);
  assert.throws(() => setupCodeFromBytes([1, 2, 3]));

  assert.equal(setupCodeMatches(code, code), true);
  assert.equal(setupCodeMatches(code, code.toLowerCase()), true);
  assert.equal(setupCodeMatches(code, ` ${code.replace("-", " ")} `), true);
  assert.equal(setupCodeMatches(code, code.replace("-", "")), true);
  const wrong = (code[0] === "2" ? "3" : "2") + code.slice(1);
  assert.equal(setupCodeMatches(code, wrong), false);
  assert.equal(setupCodeMatches(code, code.slice(0, 9)), false);
  for (const g of ["", null, undefined, 12345, {}]) assert.equal(setupCodeMatches(code, g), false, String(g));
  // No code yet (or a broken one) never matches, not even an empty guess.
  assert.equal(setupCodeMatches("", ""), false);
  assert.equal(setupCodeMatches(undefined, ""), false);
});

// ===== Logout =====

test("only a deliberate logout ends the account's sessions on every device", () => {
  assert.equal(logoutEndsAllSessions({ everywhere: true }), true);
  // The idle logout sends no body; anything else is this device only.
  for (const b of [null, undefined, {}, { everywhere: "true" }, { everywhere: 1 }, { reason: "idle" }, "everywhere", [true]]) {
    assert.equal(logoutEndsAllSessions(b), false, JSON.stringify(b));
  }
});

// ===== Sessions =====

test("session fingerprint changes when the password or the account's updatedAt changes", () => {
  const a = sessionFingerprintInput("$2a$10$hash", 1_794_619_928_470);
  assert.notEqual(a, sessionFingerprintInput("$2a$10$hash", 1_794_619_928_471)); // logout / disable / role change
  assert.notEqual(a, sessionFingerprintInput("$2a$10$other", 1_794_619_928_470)); // password reset
  assert.equal(a, sessionFingerprintInput("$2a$10$hash", 1_794_619_928_470));
});

// ===== Account changes =====

const base = { isSelf: false, currentRole: "STAFF", currentlyDisabled: false, otherActiveOwners: 1 };

test("the boss cannot disable or demote themselves", () => {
  assert.equal(accountChangeError({ ...base, isSelf: true, currentRole: "OWNER", nextDisabled: true }), "You cannot disable your own account");
  assert.equal(accountChangeError({ ...base, isSelf: true, currentRole: "OWNER", nextRole: "STAFF" }), "You cannot remove your own boss access");
  assert.equal(accountChangeError({ ...base, isSelf: true, currentRole: "OWNER", nextRole: "OWNER" }), "");
});

test("the last active Boss account cannot be disabled or demoted", () => {
  const lastOwner = { ...base, currentRole: "OWNER", otherActiveOwners: 0 };
  assert.equal(accountChangeError({ ...lastOwner, nextDisabled: true }), "At least one active Boss account is needed");
  assert.equal(accountChangeError({ ...lastOwner, nextRole: "STAFF" }), "At least one active Boss account is needed");
  assert.equal(accountChangeError({ ...lastOwner, currentRole: "OWNER", otherActiveOwners: 1, nextDisabled: true }), "");
});

test("staff can be disabled, enabled and promoted; a disabled boss can be enabled", () => {
  assert.equal(accountChangeError({ ...base, nextDisabled: true }), "");
  assert.equal(accountChangeError({ ...base, currentlyDisabled: true, nextDisabled: false }), "");
  assert.equal(accountChangeError({ ...base, nextRole: "OWNER" }), "");
  assert.equal(accountChangeError({ ...base, currentRole: "OWNER", currentlyDisabled: true, otherActiveOwners: 0, nextDisabled: false }), "");
});

// ===== Prompt dialog =====

test("prompt dialog checks: required, minimum length, matching confirmation", () => {
  assert.equal(promptValueError({ value: "   ", required: true }), "Please fill this in");
  assert.equal(promptValueError({ value: "wrong entry", required: true }), "");
  assert.equal(promptValueError({ value: "short", minLength: MIN_PASSWORD_LENGTH }), "Must be at least 8 characters");
  assert.equal(promptValueError({ value: "longenough", minLength: 8, confirm: true, confirmValue: "longenougH" }), "The two passwords do not match");
  assert.equal(promptValueError({ value: "longenough", minLength: 8, confirm: true, confirmValue: "longenough" }), "");
});
