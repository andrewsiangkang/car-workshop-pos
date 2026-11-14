// Encryption at rest for secrets kept in the database (e.g. the MyInvois client secret).
// AES-256-GCM (secret-box-core.mjs) with a per-install key that is not in the database:
// the desktop app keeps it protected by Windows (safeStorage / DPAPI) and passes it to
// the server as WORKSHOP_DATA_KEY. A copied database or backup alone cannot reveal the secret.
// 【中文】数据库内密钥（如 MyInvois Client Secret）的加密存储；钥匙由桌面程序保管（不在数据库里），备份文件被拿走也看不到密钥。
import { isSealed, parseDataKey, revealWith, sealWith } from "./secret-box-core.mjs";

function dataKey() {
  return parseDataKey(process.env.WORKSHOP_DATA_KEY);
}

/** True when this server has the per-install key (always in the desktop app). */
export function hasDataKey(): boolean {
  return dataKey() !== null;
}

/** True when a stored value is already sealed. */
export function isSealedSecret(stored: string | null | undefined): boolean {
  return isSealed(stored);
}

let warned = false;

/**
 * Value to store in the database for a secret typed in Settings: "enc:v1:…".
 * Without a key (source / dev installs started without the desktop app) the value is
 * stored as before, with one warning in the server log.
 * 【中文】保存前加密；没有钥匙（非桌面版的开发 / 源码安装）时照旧保存并在日志里提醒一次。
 */
export function sealSecret(plain: string | null | undefined): string | null {
  if (plain == null || plain === "") return null;
  const key = dataKey();
  if (!key) {
    if (!warned) {
      warned = true;
      console.warn("[secret-box] WORKSHOP_DATA_KEY is not set: secrets are stored unencrypted");
    }
    return plain;
  }
  return sealWith(plain, key);
}

/**
 * Plain secret from a stored value (sealed or, from older versions, plain). Returns null
 * when a sealed value cannot be opened with this computer's key, so MyInvois reports
 * "not configured" and the boss enters the secret again. Never throws.
 */
export function revealSecret(stored: string | null | undefined): string | null {
  return revealWith(stored, dataKey());
}
