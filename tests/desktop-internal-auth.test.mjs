import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  checkInternalToken,
  isLoopbackAddress,
  isLoopbackHost,
  makeInternalToken,
  MAX_SKEW_MS,
} from "../src/lib/internal-auth.mjs";

const require = createRequire(import.meta.url);
const electronSide = require("../electron/internal-auth.js");
const SECRET = "test-secret-0123456789abcdef0123456789";

test("the server accepts the token the desktop app makes (both sides agree)", () => {
  const now = Date.now();
  assert.equal(checkInternalToken(electronSide.makeInternalToken(SECRET, now), SECRET, now), true);
  assert.equal(electronSide.makeInternalToken(SECRET, now), makeInternalToken(SECRET, now));
  assert.equal(electronSide.INTERNAL_HEADER, "x-workshop-internal");
});

test("a token made with another installation's secret is refused", () => {
  const now = Date.now();
  assert.equal(checkInternalToken(makeInternalToken("another-secret-0123456789abcdef", now), SECRET, now), false);
});

test("an old or future token is refused (replay window)", () => {
  const now = Date.now();
  assert.equal(checkInternalToken(makeInternalToken(SECRET, now - MAX_SKEW_MS - 1), SECRET, now), false);
  assert.equal(checkInternalToken(makeInternalToken(SECRET, now + MAX_SKEW_MS + 1), SECRET, now), false);
  assert.equal(checkInternalToken(makeInternalToken(SECRET, now - 60_000), SECRET, now), true);
});

test("an edited timestamp or malformed header is refused", () => {
  const now = Date.now();
  const [, sig] = makeInternalToken(SECRET, now).split(".");
  assert.equal(checkInternalToken(`${now + 1}.${sig}`, SECRET, now), false);
  for (const bad of [null, undefined, "", "abc", `${now}`, `${now}.`, `${now}.xyz`, `${now}.${sig}x`, 42]) {
    assert.equal(checkInternalToken(bad, SECRET, now), false, String(bad));
  }
  assert.equal(checkInternalToken(makeInternalToken(SECRET, now), "", now), false);
});

test("loopback checks: only this computer", () => {
  for (const a of ["127.0.0.1", "::1", "::ffff:127.0.0.1", "127.0.0.1, 10.0.0.5"]) assert.equal(isLoopbackAddress(a), true, a);
  for (const a of ["192.168.1.20", "::ffff:192.168.1.20", "", null, "127.0.0.1.evil.com"]) assert.equal(isLoopbackAddress(a), false, String(a));
  for (const h of ["127.0.0.1:3210", "localhost:3211", "[::1]:3210", "127.0.0.1"]) assert.equal(isLoopbackHost(h), true, h);
  for (const h of ["evil.example:3210", "192.168.1.20:3210", "127.0.0.1.nip.io:3210", "", null]) assert.equal(isLoopbackHost(h), false, String(h));
});
