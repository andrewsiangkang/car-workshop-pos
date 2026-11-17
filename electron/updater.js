// Update check and verified download of the new installer (GitHub Releases).
// No Electron imports (the dialogs and starting the installer stay in main.js), so the download
// and the checksum refusal can be tested with a local server (`get` / `allow` are injectable).
// Flow: read the release → fetch the checksum CI published with it (refuse at once when there is
// none) → download the installer into the app's own data folder while hashing it → keep it only
// when the SHA-256 (and size) match → main.js checks it once more right before starting it.
// 【中文】检查新版本并下载安装程序：先取得发布时附带的校验值（没有就拒绝），下载时同时计算 SHA-256，
// 一致才保留；启动安装程序前 main.js 会再核对一次。
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const https = require("https");
const crypto = require("crypto");
const { Transform } = require("stream");
const { pipeline } = require("stream/promises");
const verify = require("./update-verify");

function codeError(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

/** Compare version numbers ("0.1.10" > "0.1.9"). 【中文】比较版本号大小。 */
function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0, nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

function hostOf(url) {
  try { return new URL(url).host; } catch { return "?"; }
}

/**
 * GET that follows redirects; the first URL and every redirect must pass `allow` (https on
 * GitHub's hosts by default). Resolves the 200 response stream.
 * net: { get, allow, headers, timeoutMs, maxRedirects }
 */
function getFollow(url, net = {}) {
  const get = net.get || https.get;
  const allow = net.allow || verify.isAllowedDownloadUrl;
  const timeoutMs = net.timeoutMs || 30000;
  return new Promise((resolve, reject) => {
    const hop = (u, left) => {
      if (!allow(u)) return reject(codeError("BLOCKED_URL", "download address not allowed: " + hostOf(u)));
      let req;
      try {
        req = get(u, { headers: net.headers || {}, timeout: timeoutMs }, (res) => {
          const s = res.statusCode;
          if (s >= 300 && s < 400 && res.headers.location) {
            res.resume();
            if (left <= 0) return reject(codeError("DOWNLOAD_FAILED", "too many redirects"));
            return hop(new URL(res.headers.location, u).toString(), left - 1);
          }
          if (s !== 200) {
            res.resume();
            return reject(codeError("DOWNLOAD_FAILED", "HTTP " + s + " from " + hostOf(u)));
          }
          resolve(res);
        });
      } catch (e) {
        return reject(codeError("DOWNLOAD_FAILED", e.message));
      }
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.on("error", (e) => reject(codeError("DOWNLOAD_FAILED", e.message)));
    };
    hop(url, net.maxRedirects ?? 5);
  });
}

/** Small text file (checksum, release JSON): at most net.maxBytes (default MAX_TEXT_BYTES). */
async function fetchText(url, net = {}) {
  const max = net.maxBytes || verify.MAX_TEXT_BYTES;
  const res = await getFollow(url, net);
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts = [];
    res.on("data", (c) => {
      size += c.length;
      if (size > max) {
        res.destroy();
        reject(codeError("DOWNLOAD_FAILED", "answer too large"));
        return;
      }
      parts.push(c);
    });
    res.on("end", () => resolve(Buffer.concat(parts).toString("utf8")));
    res.on("error", (e) => reject(codeError("DOWNLOAD_FAILED", e.message)));
  });
}

/**
 * Stream `url` into `dest`, hashing on the way. Resolves { sha256, size }. dest is removed on error.
 * opts: { maxBytes, onProgress(received, total), ...net }
 */
async function downloadToFile(url, dest, opts = {}) {
  const maxBytes = opts.maxBytes || verify.MAX_INSTALLER_BYTES;
  const res = await getFollow(url, opts);
  const total = Number(res.headers["content-length"]) || null;
  if (total && total > maxBytes) {
    res.resume();
    throw codeError("TOO_LARGE", "the download is larger than expected");
  }
  const h = crypto.createHash("sha256");
  let size = 0;
  const meter = new Transform({
    transform(chunk, _enc, cb) {
      size += chunk.length;
      if (size > maxBytes) return cb(codeError("TOO_LARGE", "the download is larger than expected"));
      h.update(chunk);
      if (opts.onProgress) {
        try { opts.onProgress(size, total); } catch {}
      }
      cb(null, chunk);
    },
  });
  try {
    await fsp.rm(dest, { force: true });
    await pipeline(res, meter, fs.createWriteStream(dest, { mode: 0o600 }));
  } catch (e) {
    await fsp.rm(dest, { force: true }).catch(() => {});
    throw e.code ? e : codeError("DOWNLOAD_FAILED", e.message);
  }
  return { sha256: h.digest("hex"), size };
}

/**
 * Latest release: { current, latest, hasUpdate, pageUrl, installer } or { current, error }.
 * `installer` is pickReleaseAssets() of the release (null when it has no installer).
 */
async function getLatestRelease(repo, current, net = {}) {
  if (!repo) return { current, error: "update source not configured" };
  try {
    const text = await fetchText("https://api.github.com/repos/" + repo + "/releases/latest", {
      ...net,
      headers: { "User-Agent": "WorkshopPOS/" + current, Accept: "application/vnd.github+json", ...(net.headers || {}) },
      timeoutMs: net.timeoutMs || 10000,
      maxBytes: 2 * 1024 * 1024, // release notes can be long
    });
    const data = JSON.parse(text);
    const latest = data.tag_name || data.name;
    if (!latest) return { current, error: "no release found" };
    const pageUrl = typeof data.html_url === "string" ? data.html_url : null;
    return {
      current,
      latest: String(latest).replace(/^v/, ""),
      pageUrl,
      hasUpdate: compareVersions(latest, current) > 0,
      installer: verify.pickReleaseAssets(data),
    };
  } catch (e) {
    return { current, error: e.message };
  }
}

/**
 * Download the release installer into `dir` and keep it only when it matches the published
 * SHA-256. Resolves { ok: true, file, sha256, size } or { ok: false, error, detail }.
 * error: NO_INSTALLER | NO_CHECKSUM | CHECKSUM_CONFLICT | CHECKSUM_MISMATCH | TOO_LARGE | BLOCKED_URL | DOWNLOAD_FAILED
 * 【中文】下载安装程序并核对 SHA-256：没有校验值、校验值互相矛盾或不一致都拒绝，不会留下文件。
 */
async function downloadVerifiedInstaller(installer, dir, opts = {}) {
  if (!installer || !/^[\w.-]+\.exe$/i.test(String(installer.name || ""))) return { ok: false, error: "NO_INSTALLER" };
  const net = { ...opts };
  delete net.onProgress;
  delete net.maxBytes;
  // Checksums first: nothing is downloaded when the release has none.
  const checksumText = installer.checksumUrl ? await fetchText(installer.checksumUrl, net).catch(() => null) : null;
  const latestJsonText = installer.latestJsonUrl ? await fetchText(installer.latestJsonUrl, net).catch(() => null) : null;
  const want = verify.expectedHash({ fileName: installer.name, checksumText, latestJsonText, apiDigest: installer.apiDigest });
  if (!want.ok) return want;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, installer.name);
  const partial = file + ".partial";
  try {
    const got = await downloadToFile(installer.url, partial, { ...net, onProgress: opts.onProgress });
    if ((want.size && got.size !== want.size) || !verify.hashesEqual(got.sha256, want.sha256)) {
      await fsp.rm(partial, { force: true });
      return { ok: false, error: "CHECKSUM_MISMATCH", detail: "expected " + want.sha256 + ", got " + got.sha256 };
    }
    await fsp.rm(file, { force: true });
    await fsp.rename(partial, file);
    return { ok: true, file, sha256: want.sha256, size: got.size };
  } catch (e) {
    await fsp.rm(partial, { force: true }).catch(() => {});
    return { ok: false, error: e.code && /^[A-Z_]+$/.test(e.code) ? e.code : "DOWNLOAD_FAILED", detail: e.message };
  }
}

/** The saved installer still has the verified hash (checked again right before it is started). */
async function recheckInstaller(file, sha256) {
  try {
    return verify.hashesEqual(await verify.sha256File(file), sha256);
  } catch {
    return false;
  }
}

/** Remove installers left from an earlier update (the folder only ever holds the current one). */
function cleanUpdateDir(dir) {
  try {
    for (const f of fs.readdirSync(dir)) {
      if (/\.exe(\.partial)?$/i.test(f)) fs.rmSync(path.join(dir, f), { force: true });
    }
  } catch {}
}

module.exports = {
  compareVersions,
  getFollow,
  fetchText,
  downloadToFile,
  getLatestRelease,
  downloadVerifiedInstaller,
  recheckInstaller,
  cleanUpdateDir,
};
