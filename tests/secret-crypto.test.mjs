import test from "node:test";
import assert from "node:assert/strict";
import { encryptSecret, decryptSecret, isEncryptedSecret } from "../src/lib/secret-crypto.mjs";

test("MyInvois secret encrypts and decrypts with authenticated AES-GCM", () => {
  process.env.AUTH_SECRET = "test-auth-secret-with-sufficient-length";
  const encrypted = encryptSecret("my-client-secret");
  assert.equal(isEncryptedSecret(encrypted), true);
  assert.notEqual(encrypted, "my-client-secret");
  assert.equal(decryptSecret(encrypted), "my-client-secret");
});

test("legacy plaintext secret remains readable for automatic migration", () => {
  assert.equal(isEncryptedSecret("legacy-plaintext"), false);
  assert.equal(decryptSecret("legacy-plaintext"), "legacy-plaintext");
});

test("AES-GCM detects tampering", () => {
  process.env.AUTH_SECRET = "test-auth-secret-with-sufficient-length";
  const encrypted = encryptSecret("another-secret");
  const tampered = encrypted.slice(0, -1) + (encrypted.endsWith("A") ? "B" : "A");
  assert.throws(() => decryptSecret(tampered));
});
