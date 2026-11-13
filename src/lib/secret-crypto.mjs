import crypto from "node:crypto";

const PREFIX = "enc:v1:";
const SALT = Buffer.from("car-workshop-pos:myinvois-secret:v1", "utf8");

function keyFromEnv() {
  const source = process.env.MYINVOIS_ENCRYPTION_KEY || process.env.AUTH_SECRET;
  if (!source || source.length < 16) {
    throw new Error("Set MYINVOIS_ENCRYPTION_KEY or a strong AUTH_SECRET (at least 16 characters) before saving/reading encrypted MyInvois credentials");
  }
  return Buffer.from(crypto.hkdfSync("sha256", Buffer.from(source, "utf8"), SALT, Buffer.from("aes-256-gcm"), 32));
}

export function isEncryptedSecret(value) {
  return typeof value === "string" && value.startsWith(PREFIX);
}

export function encryptSecret(value) {
  if (value == null || value === "") return null;
  if (isEncryptedSecret(value)) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyFromEnv(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptSecret(value) {
  if (value == null || value === "") return null;
  if (!isEncryptedSecret(value)) return String(value); // legacy plaintext; caller should migrate it.
  const parts = String(value).slice(PREFIX.length).split(":");
  if (parts.length !== 3) throw new Error("Stored MyInvois secret has an invalid encrypted format");
  const [ivText, tagText, dataText] = parts;
  const decipher = crypto.createDecipheriv("aes-256-gcm", keyFromEnv(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataText, "base64url")), decipher.final()]).toString("utf8");
}
