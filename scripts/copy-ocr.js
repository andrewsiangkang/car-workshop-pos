// 【中文】把离线 OCR（识别发票文字）需要的文件复制到 public/ocr，打包时一起带进安装包，这样不用联网也能扫描。
// 在 npm run build 之前自动运行（package.json 里的 prebuild）。
// 打包正式安装程序时（CI，或 --strict）缺少 OCR 文件就让打包失败，不会悄悄发布一个不能扫描的版本。
// Copies the offline OCR files (worker, WebAssembly core, English language data) into public/ocr.
// A developer build only warns when they are missing (manual entry still works), but a release
// build fails: in CI (CI=true), with WORKSHOP_RELEASE=1, or with --strict (electron:dist).
const fs = require("fs");
const path = require("path");

/** Release mode: a missing OCR file must stop the build. */
function isStrict(argv = process.argv, env = process.env) {
  if (argv.includes("--strict")) return true;
  if (env.WORKSHOP_RELEASE === "1") return true;
  const ci = String(env.CI || "").toLowerCase();
  return ci !== "" && ci !== "0" && ci !== "false";
}

/**
 * Copy the OCR files from <root>/node_modules into <out>. Returns { ok, copied, error }.
 * A file is only counted when it exists and is not empty afterwards.
 */
function prepareOcr(root, out) {
  const copied = [];
  try {
    fs.mkdirSync(path.join(out, "lang"), { recursive: true });
    const copy = (from, to) => {
      fs.copyFileSync(from, to);
      if (fs.statSync(to).size === 0) throw new Error(path.basename(to) + " is empty");
      copied.push(path.relative(out, to));
    };
    copy(path.join(root, "node_modules/tesseract.js/dist/worker.min.js"), path.join(out, "worker.min.js"));
    const coreDir = path.join(root, "node_modules/tesseract.js-core");
    const cores = fs.readdirSync(coreDir).filter((f) => /^tesseract-core.*lstm.*\.(wasm\.js|wasm)$/.test(f));
    if (cores.length === 0) throw new Error("no tesseract core files found");
    for (const f of cores) copy(path.join(coreDir, f), path.join(out, f));
    copy(
      path.join(root, "node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz"),
      path.join(out, "lang", "eng.traineddata.gz")
    );
    return { ok: true, copied, error: null };
  } catch (e) {
    return { ok: false, copied, error: e.message };
  }
}

if (require.main === module) {
  const root = path.join(__dirname, "..");
  const strict = isStrict();
  const r = prepareOcr(root, path.join(root, "public", "ocr"));
  for (const f of r.copied) console.log("[ocr] copied", f);
  if (!r.ok) {
    if (strict) {
      console.error("[ocr] ERROR: the offline OCR files could not be prepared: " + r.error);
      console.error("[ocr] A release must include them (supplier invoice scanning). Run `npm ci` and build again.");
      process.exit(1);
    }
    console.warn("[ocr] WARNING: could not prepare offline OCR files:", r.error);
    console.warn("[ocr] Scanning supplier invoices will not work in this build (manual entry still works).");
  }
}

module.exports = { prepareOcr, isStrict };
