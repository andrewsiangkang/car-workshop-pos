// Collects the licence texts (with their copyright lines) of every open-source package that
// ships in the Windows installer into licenses/, which electron-builder installs as
// resources/licenses/ next to THIRD-PARTY-NOTICES.md.
// Run it after `npm ci` and again whenever dependencies change (tests/desktop-licenses.test.mjs
// fails when licenses/ no longer matches node_modules):
//     node scripts/collect-licenses.mjs
// Shipped = the production dependencies in package.json with everything they need, every package
// Next.js copies into .next/standalone/node_modules (when a build exists), Electron itself, and
// Tailwind CSS / the Prisma engines (their output is part of the app).
// GPL-3.0.txt and LGPL-3.0.txt (required by the LGPL for libvips) are fixed texts and are kept.
// 【中文】把安装包里所有开源组件的授权文本（含版权声明）收集到 licenses/ 文件夹，打包时装到 resources/licenses/。
// 更新依赖后请重新运行：node scripts/collect-licenses.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const OUT_DIR = path.join(ROOT, "licenses");
export const INDEX_FILE = "README.md";
export const LIBVIPS_FILE = "libvips.md";
/** Fixed licence texts, never rewritten by this script. */
export const FIXED_FILES = ["GPL-3.0.txt", "LGPL-3.0.txt"];
/** Shipped although they are not runtime dependencies of the server (their own dependencies are not). */
export const EXTRA_PACKAGES = ["electron", "tailwindcss", "@prisma/engines"];
/**
 * Not collected per package: Next's build-time compiler, and the per-platform sharp / libvips
 * binaries (the build PC's platform decides which one is installed). They are covered by
 * sharp's licence, libvips.md, LGPL-3.0.txt and GPL-3.0.txt.
 */
export const SKIP = [/^@next\/swc-/, /^@img\/sharp-/];
const LICENCE_FILE = /^(licen[cs]e|copying|notice|thirdpartynotice)/i;

function readPkg(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
}

/** Node's lookup: <from>/node_modules/<name>, then each parent folder up to the project root. */
function resolveFrom(from, name) {
  for (let d = from; d.startsWith(ROOT); d = path.dirname(d)) {
    const c = path.join(d, "node_modules", name);
    if (fs.existsSync(path.join(c, "package.json"))) return c;
    if (d === ROOT) break;
  }
  return null;
}

function standaloneNames() {
  const dir = path.join(ROOT, ".next", "standalone", "node_modules");
  if (!fs.existsSync(dir)) return [];
  const names = [];
  for (const e of fs.readdirSync(dir)) {
    if (e.startsWith(".")) continue;
    if (e.startsWith("@")) for (const s of fs.readdirSync(path.join(dir, e))) names.push(e + "/" + s);
    else names.push(e);
  }
  return names;
}

/**
 * Every shipped package: [{ name, version, license, dir, files }], sorted by name.
 * 【中文】找出安装包里的所有组件（生产依赖及其依赖、Next 打包进去的、Electron 等）。
 */
export function collectPackages() {
  const rootPkg = readPkg(ROOT);
  const queue = [];
  const seen = new Map();
  const skip = (name) => SKIP.some((re) => re.test(name));
  for (const name of [...Object.keys(rootPkg.dependencies || {}), ...EXTRA_PACKAGES, ...standaloneNames()]) {
    if (skip(name)) continue;
    const dir = resolveFrom(ROOT, name);
    if (dir) queue.push(dir);
  }
  while (queue.length) {
    const dir = queue.shift();
    const p = readPkg(dir);
    const key = p.name + "@" + p.version;
    if (seen.has(key) || skip(p.name)) continue;
    const license = typeof p.license === "string" ? p.license : (p.licenses || []).map((l) => l.type || l).join(" OR ") || "UNKNOWN";
    const files = fs.readdirSync(dir).filter((f) => LICENCE_FILE.test(f) && fs.statSync(path.join(dir, f)).isFile()).sort();
    seen.set(key, { name: p.name, version: p.version, license, dir, files, pkg: p });
    // Only the package itself ships (e.g. Electron's own dependencies just download it at build time).
    if (EXTRA_PACKAGES.includes(p.name)) continue;
    for (const dep of Object.keys({ ...p.dependencies, ...p.optionalDependencies })) {
      const d = resolveFrom(dir, dep);
      if (d) queue.push(d);
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

/** licenses/<file name> for a package (the version is added only when two versions ship). */
export function fileNameFor(pkg, all) {
  const safe = pkg.name.replace(/\//g, "__");
  const dupe = all.filter((p) => p.name === pkg.name).length > 1;
  return safe + (dupe ? "@" + pkg.version : "") + ".txt";
}

function source(p) {
  const repo = typeof p.repository === "string" ? p.repository : p.repository && p.repository.url;
  return p.homepage || repo || "";
}

function author(p) {
  const a = p.author;
  return typeof a === "string" ? a : a && a.name ? a.name : "";
}

function licenceText(pkg) {
  const head = [
    pkg.name + " " + pkg.version,
    "Licence: " + pkg.license,
    ...(source(pkg.pkg) ? ["Source: " + source(pkg.pkg)] : []),
    "=".repeat(78),
    "",
  ];
  if (!pkg.files.length) {
    return head.concat([
      "This package does not include a licence file. Its package.json declares the licence above" +
        (author(pkg.pkg) ? " (author: " + author(pkg.pkg) + ")." : "."),
      "",
    ]).join("\n");
  }
  const parts = pkg.files.map((f) => "----- " + f + " -----\n\n" + fs.readFileSync(path.join(pkg.dir, f), "utf8").trimEnd() + "\n");
  return head.join("\n") + parts.join("\n");
}

/** libvips version and bundled-library table, from the installed sharp / libvips packages. */
function libvipsText() {
  const sharpDir = resolveFrom(ROOT, "sharp");
  if (!sharpDir) return null;
  const sharp = readPkg(sharpDir);
  const imgDir = path.join(ROOT, "node_modules", "@img");
  const pkgs = fs.existsSync(imgDir) ? fs.readdirSync(imgDir).filter((d) => /^sharp-libvips-/.test(d)) : [];
  const libDir = pkgs.map((d) => path.join(imgDir, d)).find((d) => fs.existsSync(path.join(d, "versions.json")));
  const versions = libDir ? JSON.parse(fs.readFileSync(path.join(libDir, "versions.json"), "utf8")) : null;
  const libPkg = libDir ? readPkg(libDir) : null;
  const readme = libDir && fs.existsSync(path.join(libDir, "README.md")) ? fs.readFileSync(path.join(libDir, "README.md"), "utf8") : "";
  const licensing = readme.includes("## Licensing") ? readme.slice(readme.indexOf("## Licensing")).trimEnd() : "";
  const vips = (versions && versions.vips) || String((sharp.config && sharp.config.libvips) || "").replace(/^[^\d]*/, "");
  const lines = [
    "# libvips (used by sharp " + sharp.version + ")",
    "",
    "libvips " + vips + " is licensed under the GNU Lesser General Public License v3 or later",
    "(LGPL-3.0-or-later): see LGPL-3.0.txt and GPL-3.0.txt in this folder.",
    "",
    "It is built by the sharp-libvips project" + (libPkg ? " (package version " + libPkg.version + ")" : "") +
      ": https://github.com/lovell/sharp-libvips",
    "Source code: https://github.com/libvips/libvips (tag v" + vips + ") and the build scripts and",
    "library sources at https://github.com/lovell/sharp-libvips.",
    "",
  ];
  if (versions) {
    lines.push("## Versions of the bundled libraries", "", "| Library | Version |", "|---|---|");
    for (const [k, v] of Object.entries(versions)) lines.push("| " + k + " | " + v + " |");
    lines.push("");
  }
  if (licensing) lines.push(licensing, "");
  return lines.join("\n");
}

function indexText(pkgs) {
  const lines = [
    "# Licences of the open-source components",
    "",
    "Workshop POS ships the packages below. Each file in this folder holds the licence text(s) the",
    "package itself includes (with its copyright lines). libvips (image processing, used by sharp)",
    "is described in " + LIBVIPS_FILE + "; the full GNU LGPL v3 and GNU GPL v3 texts are in",
    FIXED_FILES.join(" and ") + ". See also THIRD-PARTY-NOTICES.md.",
    "",
    "Generated by scripts/collect-licenses.mjs.",
    "",
    "| Package | Version | Licence | File |",
    "|---|---|---|---|",
  ];
  for (const p of pkgs) lines.push("| " + p.name + " | " + p.version + " | " + p.license + " | " + fileNameFor(p, pkgs) + " |");
  lines.push("");
  return lines.join("\n");
}

// 【中文】重新生成 licenses/ 文件夹（固定的 GPL / LGPL 文本保留不动）。
export function main() {
  const pkgs = collectPackages();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const keep = new Set(FIXED_FILES);
  const vips = libvipsText();
  if (!vips) keep.add(LIBVIPS_FILE); // sharp not installed here: keep the last generated one
  for (const f of fs.readdirSync(OUT_DIR)) if (!keep.has(f)) fs.rmSync(path.join(OUT_DIR, f));
  for (const p of pkgs) fs.writeFileSync(path.join(OUT_DIR, fileNameFor(p, pkgs)), licenceText(p));
  if (vips) fs.writeFileSync(path.join(OUT_DIR, LIBVIPS_FILE), vips);
  fs.writeFileSync(path.join(OUT_DIR, INDEX_FILE), indexText(pkgs));
  for (const f of FIXED_FILES) {
    if (!fs.existsSync(path.join(OUT_DIR, f))) console.warn("[licenses] missing " + f + ": add the official text from gnu.org");
  }
  const none = pkgs.filter((p) => !p.files.length).map((p) => p.name);
  console.log("[licenses] " + pkgs.length + " packages written to licenses/" + (none.length ? " (no licence file in: " + none.join(", ") + ")" : ""));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
