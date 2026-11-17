import test from "node:test";
import assert from "node:assert/strict";
import { SEAL_PREFIX, isSealed, parseDataKey, revealWith, sealWith } from "../src/lib/secret-box-core.mjs";

// Fixed test keys (never used by a real install: the desktop app makes a random one).
const KEY_HEX = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
const KEY = parseDataKey(KEY_HEX);
const OTHER = parseDataKey("ff".repeat(32));

test("parseDataKey accepts 64 hex characters or 32-byte base64, rejects anything else", () => {
  assert.equal(KEY.length, 32);
  assert.deepEqual(parseDataKey(Buffer.from(KEY_HEX, "hex").toString("base64")), KEY);
  for (const bad of [undefined, null, "", "abc", "zz".repeat(32), KEY_HEX.slice(2), 123]) {
    assert.equal(parseDataKey(bad), null, String(bad));
  }
});

test("sealWith gives enc:v1:<base64>, never the plain text, and a fresh IV each time", () => {
  const a = sealWith("my-client-secret", KEY);
  const b = sealWith("my-client-secret", KEY);
  assert.ok(a.startsWith(SEAL_PREFIX));
  assert.ok(isSealed(a));
  assert.ok(!a.includes("my-client-secret"));
  assert.notEqual(a, b, "same secret must not produce the same stored value");
  assert.match(a.slice(SEAL_PREFIX.length), /^[A-Za-z0-9+/]+=*$/);
});

test("revealWith opens what sealWith stored (including non-ASCII text)", () => {
  for (const s of ["my-client-secret", "密钥 rahsia ✓", "x"]) {
    assert.equal(revealWith(sealWith(s, KEY), KEY), s);
  }
});

test("plain values from older versions pass through unchanged", () => {
  assert.equal(revealWith("legacy-plain-secret", KEY), "legacy-plain-secret");
  assert.equal(revealWith("legacy-plain-secret", null), "legacy-plain-secret");
  assert.equal(revealWith(null, KEY), null);
  assert.equal(revealWith(undefined, KEY), null);
  assert.equal(isSealed("legacy-plain-secret"), false);
});

test("a sealed value with a missing or wrong key gives null (never throws)", () => {
  const sealed = sealWith("my-client-secret", KEY);
  assert.equal(revealWith(sealed, null), null);
  assert.equal(revealWith(sealed, undefined), null);
  assert.equal(revealWith(sealed, OTHER), null);
  assert.equal(revealWith(sealed, Buffer.alloc(16)), null);
});

test("a damaged or altered sealed value gives null", () => {
  const sealed = sealWith("my-client-secret", KEY);
  const raw = Buffer.from(sealed.slice(SEAL_PREFIX.length), "base64");
  raw[raw.length - 1] ^= 1; // flip one bit of the ciphertext
  assert.equal(revealWith(SEAL_PREFIX + raw.toString("base64"), KEY), null);
  assert.equal(revealWith(SEAL_PREFIX + "not-base64!!", KEY), null);
  assert.equal(revealWith(SEAL_PREFIX, KEY), null);
  assert.equal(revealWith(sealed.slice(0, 20), KEY), null);
});

test("sealWith refuses to run without a proper key", () => {
  assert.throws(() => sealWith("x", null));
  assert.throws(() => sealWith("x", Buffer.alloc(16)));
});
