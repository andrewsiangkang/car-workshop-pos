import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { writeChecksums } from "../scripts/release-checksums.mjs";

// The in-app updater only installs an installer whose SHA-256 matches the value CI published with
// the release. Behavioural tests of electron/update-verify.js, electron/updater.js (against a local
// stand-in for GitHub) and scripts/release-checksums.mjs (what CI publishes).
const require = createRequire(import.meta.url);
const v = require("../electron/update-verify.js");
const updater = require("../electron/updater.js");

const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ops-update-"));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("downloads may only come from GitHub over https", () => {
  assert.equal(v.isAllowedDownloadUrl("https://github.com/o/r/releases/download/v1/a.exe"), true);
  assert.equal(v.isAllowedDownloadUrl("https://release-assets.githubusercontent.com/x"), true);
  assert.equal(v.isAllowedDownloadUrl("https://objects.githubusercontent.com/x"), true);
  assert.equal(v.isAllowedDownloadUrl("http://github.com/o/r/a.exe"), false, "plain http");
  assert.equal(v.isAllowedDownloadUrl("https://github.com.evil.example/a.exe"), false);
  assert.equal(v.isAllowedDownloadUrl("https://user:pw@github.com/a.exe"), false);
  assert.equal(v.isAllowedDownloadUrl("file:///C:/a.exe"), false);
  assert.equal(v.isAllowedDownloadUrl("not a url"), false);
});

test("the shop installer and its checksum files are picked from the release, never the demo", () => {
  const hex = "a".repeat(64);
  const rel = {
    assets: [
      { name: "WorkshopPOS-DEMO-Setup-0.4.0.exe", browser_download_url: "https://github.com/o/r/releases/download/v0.4.0/demo.exe" },
      { name: "WorkshopPOS-Setup-0.4.0.exe", browser_download_url: "https://github.com/o/r/releases/download/v0.4.0/WorkshopPOS-Setup-0.4.0.exe", size: 123, digest: "sha256:" + hex.toUpperCase() },
      { name: "WorkshopPOS-Setup-0.4.0.exe.sha256", browser_download_url: "https://github.com/o/r/releases/download/v0.4.0/WorkshopPOS-Setup-0.4.0.exe.sha256" },
      { name: "latest.json", browser_download_url: "https://github.com/o/r/releases/download/v0.4.0/latest.json" },
    ],
  };
  const a = v.pickReleaseAssets(rel);
  assert.equal(a.name, "WorkshopPOS-Setup-0.4.0.exe");
  assert.equal(a.size, 123);
  assert.equal(a.apiDigest, hex);
  assert.match(a.checksumUrl, /\.exe\.sha256$/);
  assert.match(a.latestJsonUrl, /latest\.json$/);
  assert.equal(v.pickReleaseAssets({ assets: [rel.assets[0]] }), null, "a release with only the demo has no installer for the shop");
  assert.equal(v.pickReleaseAssets({}), null);
  assert.equal(v.pickReleaseAssets({ assets: [rel.assets[1]] }).checksumUrl, null);
});

test("the expected hash needs a published checksum, and every source must agree", () => {
  const h1 = sha("one");
  const h2 = sha("two");
  const name = "WorkshopPOS-Setup-1.0.0.exe";
  assert.equal(v.parseChecksumFile(`${h1}  ${name}\n`, name), h1);
  assert.equal(v.parseChecksumFile(`${h1} *${name}\r\n`, name), h1, "binary-mode marker and CRLF");
  assert.equal(v.parseChecksumFile(`${h1}  other.exe\n`, name), null);
  assert.equal(v.parseChecksumFile(`${h1.toUpperCase()}\n`, name), h1, "a lone hash");
  assert.equal(v.parseChecksumFile(`not a checksum`, name), null);

  assert.deepEqual(v.expectedHash({ fileName: name }), { ok: false, error: "NO_CHECKSUM" });
  assert.deepEqual(v.expectedHash({ fileName: name, apiDigest: h1 }), { ok: false, error: "NO_CHECKSUM" }, "GitHub's digest alone is not enough");
  assert.deepEqual(v.expectedHash({ fileName: name, checksumText: "<html>404</html>" }), { ok: false, error: "NO_CHECKSUM" });
  const latest = JSON.stringify({ version: "1.0.0", files: [{ name, sha256: h1, size: 3 }] });
  assert.deepEqual(v.expectedHash({ fileName: name, checksumText: `${h1}  ${name}`, latestJsonText: latest, apiDigest: h1 }), { ok: true, sha256: h1, size: 3 });
  assert.deepEqual(v.expectedHash({ fileName: name, checksumText: `${h1}  ${name}`, apiDigest: h2 }), { ok: false, error: "CHECKSUM_CONFLICT" });
  assert.deepEqual(v.expectedHash({ fileName: name, checksumText: `${h2}  ${name}`, latestJsonText: latest }), { ok: false, error: "CHECKSUM_CONFLICT" });
  assert.equal(v.hashesEqual(h1, h1.toUpperCase()), true);
  assert.equal(v.hashesEqual(h1, h2), false);
  assert.equal(v.hashesEqual("", ""), false);
});

test("CI's checksum files are read back by the updater", async () => {
  const dir = path.join(tmp, "dist");
  fs.mkdirSync(dir);
  const exe = Buffer.from("MZ installer bytes " + "x".repeat(5000));
  fs.writeFileSync(path.join(dir, "WorkshopPOS-Setup-9.9.9.exe"), exe);
  fs.writeFileSync(path.join(dir, "builder-debug.yml"), "not an installer");
  const latest = await writeChecksums(dir, "9.9.9");
  assert.deepEqual(latest, { version: "9.9.9", files: [{ name: "WorkshopPOS-Setup-9.9.9.exe", sha256: sha(exe), size: exe.length }] });
  const want = v.expectedHash({
    fileName: "WorkshopPOS-Setup-9.9.9.exe",
    checksumText: fs.readFileSync(path.join(dir, "WorkshopPOS-Setup-9.9.9.exe.sha256"), "utf8"),
    latestJsonText: fs.readFileSync(path.join(dir, "latest.json"), "utf8"),
  });
  assert.deepEqual(want, { ok: true, sha256: sha(exe), size: exe.length });
  assert.equal(await v.sha256File(path.join(dir, "WorkshopPOS-Setup-9.9.9.exe")), sha(exe));
  const empty = path.join(tmp, "empty");
  fs.mkdirSync(empty);
  await assert.rejects(writeChecksums(empty, "1.0.0"), /no \.exe installer/);
});

// ---- a local stand-in for GitHub (api.github.com + release downloads with a redirect) ----
const files = new Map(); // path → Buffer
const hits = new Map(); // path → count
const server = http.createServer((req, res) => {
  const p = req.url.split("?")[0];
  hits.set(p, (hits.get(p) || 0) + 1);
  if (p.includes("/redirect/")) {
    res.writeHead(302, { Location: "https://release-assets.githubusercontent.com/" + p.split("/redirect/")[1] });
    return res.end();
  }
  const body = files.get(p);
  if (!body) {
    res.writeHead(404);
    return res.end("not found");
  }
  res.writeHead(200, { "Content-Length": body.length });
  res.end(body);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
test.after(() => server.close());
/** Every https URL (GitHub hosts) is answered by the local server, keeping the path. */
const net = {
  get: (u, opts, cb) => http.get("http://127.0.0.1:" + port + new URL(u).pathname, opts, cb),
};

function publish(version, installer, { checksum = true, latestJson = true, tamper = null, digest = null } = {}) {
  const name = `WorkshopPOS-Setup-${version}.exe`;
  const real = sha(installer);
  files.set(`/assets/${name}`, tamper || installer);
  if (checksum) files.set(`/assets/${name}.sha256`, Buffer.from(`${real}  ${name}\n`));
  if (latestJson) files.set(`/assets/latest-${version}.json`, Buffer.from(JSON.stringify({ version, files: [{ name, sha256: real, size: installer.length }] })));
  const assets = [
    { name, browser_download_url: `https://github.com/o/r/releases/download/v${version}/redirect/assets/${name}`, size: installer.length, ...(digest ? { digest } : {}) },
  ];
  if (checksum) assets.push({ name: name + ".sha256", browser_download_url: `https://github.com/o/r/releases/download/redirect/assets/${name}.sha256` });
  if (latestJson) assets.push({ name: "latest.json", browser_download_url: `https://github.com/o/r/releases/download/redirect/assets/latest-${version}.json` });
  files.set("/repos/o/r/releases/latest", Buffer.from(JSON.stringify({ tag_name: "v" + version, html_url: `https://github.com/o/r/releases/tag/v${version}`, assets })));
  return name;
}
const redirectedPaths = (u) => "/assets/" + u.split("/assets/")[1];

test("a matching installer is downloaded and kept; the release page and version come from GitHub", async () => {
  const installer = Buffer.from("MZ good installer " + "g".repeat(100000));
  const name = publish("1.2.0", installer);
  const rel = await updater.getLatestRelease("o/r", "1.1.9", net);
  assert.equal(rel.latest, "1.2.0");
  assert.equal(rel.hasUpdate, true);
  assert.equal(rel.pageUrl, "https://github.com/o/r/releases/tag/v1.2.0");
  assert.equal(rel.installer.name, name);
  assert.equal((await updater.getLatestRelease("o/r", "1.2.0", net)).hasUpdate, false);

  const dir = path.join(tmp, "updates-ok");
  const seen = [];
  const r = await updater.downloadVerifiedInstaller(rel.installer, dir, { ...net, onProgress: (n, total) => seen.push([n, total]) });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.sha256, sha(installer));
  assert.deepEqual(fs.readFileSync(r.file), installer);
  assert.deepEqual(fs.readdirSync(dir), [name], "no .partial left behind");
  assert.ok(seen.length > 0 && seen.at(-1)[0] === installer.length && seen.at(-1)[1] === installer.length);
  // Checked again right before it is started: a file changed on disk is not run.
  assert.equal(await updater.recheckInstaller(r.file, r.sha256), true);
  fs.appendFileSync(r.file, "x");
  assert.equal(await updater.recheckInstaller(r.file, r.sha256), false);
  updater.cleanUpdateDir(dir);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test("a swapped or damaged installer is refused and deleted", async () => {
  const installer = Buffer.from("MZ real installer " + "r".repeat(5000));
  publish("1.3.0", installer, { tamper: Buffer.from("MZ evil installer " + "e".repeat(5000)) });
  const rel = await updater.getLatestRelease("o/r", "1.0.0", net);
  const dir = path.join(tmp, "updates-bad");
  const r = await updater.downloadVerifiedInstaller(rel.installer, dir, net);
  assert.equal(r.ok, false);
  assert.equal(r.error, "CHECKSUM_MISMATCH");
  assert.deepEqual(fs.readdirSync(dir), [], "nothing is kept");
});

test("a release without a published checksum is refused before the installer is downloaded", async () => {
  const installer = Buffer.from("MZ unsigned " + "u".repeat(5000));
  const name = publish("1.4.0", installer, { checksum: false, latestJson: false, digest: "sha256:" + sha(installer) });
  const rel = await updater.getLatestRelease("o/r", "1.0.0", net);
  const before = hits.get(`/assets/${name}`) || 0;
  const r = await updater.downloadVerifiedInstaller(rel.installer, path.join(tmp, "updates-none"), net);
  assert.deepEqual(r, { ok: false, error: "NO_CHECKSUM" });
  assert.equal(hits.get(`/assets/${name}`) || 0, before, "the installer itself was never fetched");
});

test("GitHub's own digest must agree with the published checksum", async () => {
  const installer = Buffer.from("MZ digest " + "d".repeat(5000));
  publish("1.5.0", installer, { digest: "sha256:" + sha("something else") });
  const rel = await updater.getLatestRelease("o/r", "1.0.0", net);
  const r = await updater.downloadVerifiedInstaller(rel.installer, path.join(tmp, "updates-conflict"), net);
  assert.deepEqual(r, { ok: false, error: "CHECKSUM_CONFLICT" });
});

test("downloads never follow a redirect to a host that is not GitHub, and oversize downloads stop", async () => {
  // Default rules: the local server's redirect target is a GitHub host, but the first URL is plain http.
  await assert.rejects(updater.fetchText("http://127.0.0.1:" + port + "/assets/x"), (e) => e.code === "BLOCKED_URL");
  const evil = { ...net, allow: (u) => !u.includes("release-assets") };
  await assert.rejects(updater.fetchText("https://github.com/o/r/releases/download/redirect/assets/x", evil), (e) => e.code === "BLOCKED_URL");
  const installer = Buffer.from("MZ big " + "b".repeat(20000));
  publish("1.6.0", installer);
  const rel = await updater.getLatestRelease("o/r", "1.0.0", net);
  const dest = path.join(tmp, "big.partial");
  await assert.rejects(updater.downloadToFile(rel.installer.url, dest, { ...net, maxBytes: 1000 }), (e) => e.code === "TOO_LARGE");
  assert.equal(fs.existsSync(dest), false);
  assert.ok(redirectedPaths(rel.installer.url).startsWith("/assets/"));
});

test("version comparison", () => {
  assert.equal(updater.compareVersions("0.3.10", "0.3.9"), 1);
  assert.equal(updater.compareVersions("v0.4.0", "0.4.0"), 0);
  assert.equal(updater.compareVersions("0.3.29", "0.3.30"), -1);
});
