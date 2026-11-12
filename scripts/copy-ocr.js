// 【中文】把离线 OCR（识别发票文字）需要的文件复制到 public/ocr，打包时一起带进安装包，这样不用联网也能扫描。
// 在 npm run build 之前自动运行（package.json 里的 prebuild）。
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const out = path.join(root, "public", "ocr");
fs.mkdirSync(path.join(out, "lang"), { recursive: true });

function copy(from, to) {
  fs.copyFileSync(from, to);
  console.log("[ocr] copied", path.basename(to));
}
let ok = true;
try {
  copy(path.join(root, "node_modules/tesseract.js/dist/worker.min.js"), path.join(out, "worker.min.js"));
  const coreDir = path.join(root, "node_modules/tesseract.js-core");
  const cores = fs.readdirSync(coreDir).filter((f) => /^tesseract-core.*lstm.*\.(wasm\.js|wasm)$/.test(f));
  if (cores.length === 0) throw new Error("no tesseract core files found");
  for (const f of cores) copy(path.join(coreDir, f), path.join(out, f));
  copy(
    path.join(root, "node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz"),
    path.join(out, "lang", "eng.traineddata.gz")
  );
} catch (e) {
  ok = false;
  console.warn("[ocr] WARNING: could not prepare offline OCR files:", e.message);
}
if (!ok) console.warn("[ocr] Scanning supplier invoices will not work in this build (manual entry still works).");
