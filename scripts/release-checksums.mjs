// Writes the checksums the desktop app's updater checks before it runs a new installer
// (electron/update-verify.js): for every installer in <dir>,
//   <installer>.exe.sha256   "<sha256 hex>  <installer>.exe"   (sha256sum format)
// and one latest.json { version, files: [{ name, sha256, size }] }.
// CI runs it after electron-builder and publishes the files with the release:
//     node scripts/release-checksums.mjs dist
// 【中文】为安装程序生成 SHA-256 校验文件（.sha256 和 latest.json），随发布一起上传；程序更新时会核对。
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

/** SHA-256 hex of a file (streamed). */
export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    fs.createReadStream(file)
      .on("error", reject)
      .on("data", (c) => h.update(c))
      .on("end", () => resolve(h.digest("hex")));
  });
}

/**
 * Write <name>.sha256 for each .exe in `dir` and latest.json. Returns the latest.json object.
 * @param {string} dir
 * @param {string} version
 */
export async function writeChecksums(dir, version) {
  const exes = fs.readdirSync(dir).filter((f) => /\.exe$/i.test(f) && fs.statSync(path.join(dir, f)).isFile()).sort();
  if (!exes.length) throw new Error("no .exe installer in " + dir);
  const files = [];
  for (const name of exes) {
    const full = path.join(dir, name);
    const sha256 = await sha256File(full);
    const size = fs.statSync(full).size;
    fs.writeFileSync(full + ".sha256", `${sha256}  ${name}\n`);
    files.push({ name, sha256, size });
  }
  const latest = { version, files };
  fs.writeFileSync(path.join(dir, "latest.json"), JSON.stringify(latest, null, 2) + "\n");
  return latest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = path.resolve(process.argv[2] || "dist");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
  writeChecksums(dir, version)
    .then((r) => {
      for (const f of r.files) console.log(`${f.sha256}  ${f.name}  (${f.size} bytes)`);
    })
    .catch((e) => {
      console.error("release-checksums: " + e.message);
      process.exit(1);
    });
}
