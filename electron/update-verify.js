// Integrity rules for the in-app updater (electron/updater.js). No Electron imports: unit-tested.
// A release is installed only when the downloaded installer's SHA-256 equals the value CI
// published with the release (scripts/release-checksums.mjs writes "<installer>.sha256" and
// latest.json). When GitHub also reports a digest for the asset, it must agree as well.
// The installer is not code-signed yet (that needs a certificate, see README), so this check is
// what stops a damaged or swapped download from being run.
// 【中文】自动更新的完整性规则：下载的安装程序的 SHA-256 必须和发布时 CI 生成的校验值一致才会运行；
// GitHub 也提供校验值时两者必须相同。安装程序目前没有数字签名，所以这个检查很重要。
const crypto = require("crypto");
const fs = require("fs");

/** An installer bigger than this is refused (the real one is about 150-250 MB). */
const MAX_INSTALLER_BYTES = 800 * 1024 * 1024;
/** Checksum files are tiny. */
const MAX_TEXT_BYTES = 64 * 1024;
/** Where GitHub release downloads may come from (the first URL and every redirect). */
const ALLOWED_HOSTS = new Set([
  "github.com",
  "api.github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "github-releases.githubusercontent.com",
]);
const HEX64 = /^[0-9a-f]{64}$/;

/** True for an https URL on one of GitHub's release download hosts. */
function isAllowedDownloadUrl(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === "https:" && ALLOWED_HOSTS.has(u.hostname.toLowerCase()) && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** "sha256:<hex>" (GitHub API asset digest) → lower-case hex, else null. */
function parseDigest(digest) {
  const m = /^sha256:([0-9a-f]{64})$/i.exec(String(digest || "").trim());
  return m ? m[1].toLowerCase() : null;
}

/**
 * The installer and its checksum files in a GitHub release (REST API JSON).
 * The demo installer is never picked. Returns null when the release has no installer.
 */
function pickReleaseAssets(release) {
  const assets = Array.isArray(release && release.assets) ? release.assets : [];
  const isExe = (a) => a && typeof a.name === "string" && /\.exe$/i.test(a.name) && !/demo/i.test(a.name);
  const exe = assets.find((a) => isExe(a) && /^WorkshopPOS-Setup-/i.test(a.name)) || assets.find(isExe);
  if (!exe || typeof exe.browser_download_url !== "string") return null;
  const byName = (n) => assets.find((a) => a && a.name === n && typeof a.browser_download_url === "string") || null;
  const sha = byName(exe.name + ".sha256");
  const latest = byName("latest.json");
  return {
    name: exe.name,
    url: exe.browser_download_url,
    size: Number(exe.size) || null,
    apiDigest: parseDigest(exe.digest),
    checksumUrl: sha ? sha.browser_download_url : null,
    latestJsonUrl: latest ? latest.browser_download_url : null,
  };
}

/** Expected hash for `fileName` from a sha256sum-style file ("<hex>  <name>" per line). */
function parseChecksumFile(text, fileName) {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const m = /^([0-9a-fA-F]{64})(?:\s+\*?(.+))?$/.exec(line);
    if (!m) continue;
    if (!m[2] ? lines.length === 1 : m[2].trim() === fileName) return m[1].toLowerCase();
  }
  return null;
}

/** { sha256, size } for `fileName` from latest.json ({ version, files: [{ name, sha256, size }] }). */
function parseLatestJson(text, fileName) {
  try {
    const j = JSON.parse(String(text || ""));
    const f = (Array.isArray(j && j.files) ? j.files : []).find((x) => x && x.name === fileName);
    if (!f || typeof f.sha256 !== "string" || !HEX64.test(f.sha256.toLowerCase())) return null;
    return { sha256: f.sha256.toLowerCase(), size: Number.isSafeInteger(f.size) && f.size > 0 ? f.size : null };
  } catch {
    return null;
  }
}

/**
 * The hash the download must have. At least one value published by CI (.sha256 or latest.json)
 * is required; every value that is present (including GitHub's own digest) must agree.
 * @returns {{ ok: true, sha256: string, size: number | null } | { ok: false, error: "NO_CHECKSUM" | "CHECKSUM_CONFLICT" }}
 */
function expectedHash({ fileName, checksumText, latestJsonText, apiDigest }) {
  const fromFile = checksumText != null ? parseChecksumFile(checksumText, fileName) : null;
  const fromJson = latestJsonText != null ? parseLatestJson(latestJsonText, fileName) : null;
  const published = [fromFile, fromJson && fromJson.sha256].filter(Boolean);
  if (!published.length) return { ok: false, error: "NO_CHECKSUM" };
  const all = apiDigest ? published.concat(String(apiDigest).toLowerCase()) : published;
  if (all.some((h) => h !== all[0])) return { ok: false, error: "CHECKSUM_CONFLICT" };
  return { ok: true, sha256: all[0], size: fromJson ? fromJson.size : null };
}

/** Constant-time comparison of two hex hashes. */
function hashesEqual(a, b) {
  const x = String(a || "").toLowerCase();
  const y = String(b || "").toLowerCase();
  if (!HEX64.test(x) || !HEX64.test(y)) return false;
  return crypto.timingSafeEqual(Buffer.from(x, "hex"), Buffer.from(y, "hex"));
}

/** SHA-256 (hex) of a file, streamed. */
function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    fs.createReadStream(file)
      .on("error", reject)
      .on("data", (c) => h.update(c))
      .on("end", () => resolve(h.digest("hex")));
  });
}

module.exports = {
  MAX_INSTALLER_BYTES,
  MAX_TEXT_BYTES,
  isAllowedDownloadUrl,
  parseDigest,
  pickReleaseAssets,
  parseChecksumFile,
  parseLatestJson,
  expectedHash,
  hashesEqual,
  sha256File,
};
