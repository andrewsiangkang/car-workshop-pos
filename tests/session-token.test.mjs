import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

process.env.AUTH_SECRET = "test-secret-0123456789abcdef0123456789";
const { verifySessionSignature } = await import("../src/lib/session-token.mjs");

// Builds a cookie exactly the way createSessionToken() in src/lib/auth.ts does.
function makeToken({ userId = "user_1", expiry = Date.now() + 60_000, fp = "abcdef0123456789", secret = process.env.AUTH_SECRET } = {}) {
  const payload = `${userId}|${expiry}|${fp}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return Buffer.from(`${payload}|${sig}`).toString("base64url");
}

test("accepts a cookie signed by auth.ts with this installation's secret", async () => {
  assert.equal(await verifySessionSignature(makeToken()), true);
});

test("rejects a cookie signed with a different secret", async () => {
  assert.equal(await verifySessionSignature(makeToken({ secret: "some-other-secret-0123456789" })), false);
});

test("rejects a cookie whose user id was edited after signing", async () => {
  const decoded = Buffer.from(makeToken(), "base64url").toString();
  const forged = Buffer.from(decoded.replace(/^user_1\|/, "owner_1|")).toString("base64url");
  assert.equal(await verifySessionSignature(forged), false);
});

test("rejects an expired cookie", async () => {
  assert.equal(await verifySessionSignature(makeToken({ expiry: Date.now() - 1 })), false);
});

test("rejects made-up and malformed cookies", async () => {
  for (const bad of ["", "x", "anything", Buffer.from("a|b|c").toString("base64url"), Buffer.from("a|1|c|zz").toString("base64url")]) {
    assert.equal(await verifySessionSignature(bad), false, `should reject ${JSON.stringify(bad)}`);
  }
});

test("getConfiguredAuthSecret never falls back to the public development secret", async () => {
  const { getConfiguredAuthSecret, getAuthSecret } = await import("../src/lib/session-token.mjs");
  const saved = { secret: process.env.AUTH_SECRET, env: process.env.NODE_ENV };
  try {
    assert.equal(getConfiguredAuthSecret(), saved.secret);
    delete process.env.AUTH_SECRET;
    process.env.NODE_ENV = "development";
    // getAuthSecret() still works for dev sessions, but the configured-only helper refuses
    assert.equal(typeof getAuthSecret(), "string");
    assert.equal(getConfiguredAuthSecret(), null);
    process.env.AUTH_SECRET = "short";
    assert.equal(getConfiguredAuthSecret(), null);
  } finally {
    process.env.AUTH_SECRET = saved.secret;
    if (saved.env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = saved.env;
  }
});
