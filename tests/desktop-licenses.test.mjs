import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, OUT_DIR, INDEX_FILE, FIXED_FILES, LIBVIPS_FILE, collectPackages, fileNameFor } from "../scripts/collect-licenses.mjs";

// Structural invariants for licence compliance: the installer must carry the licence texts of
// what it bundles (MIT / BSD / ISC / Apache notices, and the GPL + LGPL texts for libvips).
const REGEN = "licenses/ is out of date: run `node scripts/collect-licenses.mjs`";
const hasNodeModules = fs.existsSync(path.join(ROOT, "node_modules", "next", "package.json"));
// A Windows checkout (git core.autocrlf=true) may write CRLF; compare with LF line endings.
// 【中文】Windows 上 git 可能把换行改成 CRLF，这里统一成 LF 再比较。
const lf = (s) => s.replace(/\r\n/g, "\n");
const read = (...p) => lf(fs.readFileSync(path.join(...p), "utf8"));

/** Rows of licenses/README.md: Map name → { version, licence, file } (several versions → array). */
function indexRows() {
  const rows = new Map();
  for (const line of read(OUT_DIR, INDEX_FILE).split("\n")) {
    const m = /^\| (\S+) \| (\S+) \| (.+) \| (\S+) \|$/.exec(line);
    if (!m || m[1] === "Package") continue;
    rows.set(m[1] + "@" + m[2], { licence: m[3], file: m[4] });
  }
  return rows;
}

test("every shipped package is listed with its version and has its licence text in licenses/", { skip: !hasNodeModules && "node_modules not installed" }, () => {
  const rows = indexRows();
  const pkgs = collectPackages();
  for (const name of ["next", "react", "react-dom", "@prisma/client", "electron", "sharp", "bcryptjs", "qrcode", "lucide-react"]) {
    assert.ok(pkgs.some((p) => p.name === name), name + " is collected");
  }
  for (const p of pkgs) {
    const row = rows.get(p.name + "@" + p.version);
    assert.ok(row, `${p.name}@${p.version} missing from licenses/${INDEX_FILE} — ${REGEN}`);
    assert.equal(row.file, fileNameFor(p, pkgs));
    const text = read(OUT_DIR, row.file);
    // The package's own licence text, copyright lines included, is in the file.
    for (const f of p.files) {
      const original = lf(fs.readFileSync(path.join(p.dir, f), "utf8")).trim();
      assert.ok(text.includes(original), `${row.file} does not contain ${p.name}/${f} — ${REGEN}`);
    }
  }
});

test("the full GNU GPL v3 and LGPL v3 texts are included (libvips is LGPL-3.0-or-later)", () => {
  assert.deepEqual(FIXED_FILES, ["GPL-3.0.txt", "LGPL-3.0.txt"]);
  const gpl = read(OUT_DIR, "GPL-3.0.txt");
  assert.match(gpl, /GNU GENERAL PUBLIC LICENSE\s+Version 3, 29 June 2007/);
  assert.match(gpl, /END OF TERMS AND CONDITIONS/);
  assert.ok(gpl.length > 30000, "the whole GPL text, not a link");
  const lgpl = read(OUT_DIR, "LGPL-3.0.txt");
  assert.match(lgpl, /GNU LESSER GENERAL PUBLIC LICENSE\s+Version 3, 29 June 2007/);
  assert.match(lgpl, /Revised Versions of the GNU Lesser General Public License/);
});

test("both installers ship THIRD-PARTY-NOTICES.md and the licenses folder", () => {
  for (const yml of ["electron-builder.yml", "electron-builder-demo.yml"]) {
    const s = read(ROOT, yml);
    assert.match(s, /- from: THIRD-PARTY-NOTICES\.md\s*\n\s*to: THIRD-PARTY-NOTICES\.md/, yml);
    assert.match(s, /- from: licenses\s*\n\s*to: licenses\s*\n/, yml);
  }
});

test("the notice points at the shipped licence files and states the libvips version", () => {
  const notice = read(ROOT, "THIRD-PARTY-NOTICES.md");
  // The Next standalone build contains no LICENSE / README.md / versions.json files: never point there.
  assert.doesNotMatch(notice, /node_modules\/<package>|versions\.json|LICENSE` file inside/);
  assert.match(notice, /resources\/licenses\//);
  for (const m of notice.matchAll(/licenses\/([\w.@-]+\.(?:txt|md))/g)) {
    assert.ok(fs.existsSync(path.join(OUT_DIR, m[1])), "notice names licenses/" + m[1]);
  }
  const vipsDoc = read(OUT_DIR, LIBVIPS_FILE);
  const vips = /libvips (\d+\.\d+\.\d+) is licensed/.exec(vipsDoc);
  assert.ok(vips, "licenses/libvips.md states the libvips version");
  assert.ok(notice.includes("libvips " + vips[1]), "the notice states libvips " + vips[1]);
  if (hasNodeModules && fs.existsSync(path.join(ROOT, "node_modules", "sharp", "package.json"))) {
    const sharp = JSON.parse(read(ROOT, "node_modules", "sharp", "package.json"));
    assert.ok(String(sharp.config.libvips).includes(vips[1]), `sharp ${sharp.version} needs libvips ${sharp.config.libvips} — ${REGEN} and update THIRD-PARTY-NOTICES.md`);
  }
});
