import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import {
  buildDictionary,
  dictionaryProblems,
  normText,
  printedDocumentRule,
  translateWith,
} from "../src/lib/ux-i18n-core.mjs";

// The dictionaries src/lib/i18n.ts uses, loaded the same way the app gets them (TypeScript → JS).
// 【中文】按 i18n.ts 的 import 载入全部词典，检查重复、空白和占位符。
const LIB = path.join(import.meta.dirname, "..", "src", "lib");

async function loadTsModule(file) {
  const src = fs.readFileSync(file, "utf8");
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
}

async function loadAppDictionaries() {
  const i18n = fs.readFileSync(path.join(LIB, "i18n.ts"), "utf8");
  const names = [...i18n.matchAll(/from "\.\/(i18n-dict[\w-]*)"/g)].map((m) => m[1]);
  const named = [];
  for (const name of names) named.push({ name, rows: (await loadTsModule(path.join(LIB, name + ".ts"))).ROWS });
  return named;
}

const named = await loadAppDictionaries();
const appDict = buildDictionary(named.map((n) => n.rows));
const tr = (text, lang) => translateWith(appDict, text, lang);

test("every dictionary used by i18n.ts loads", () => {
  assert.ok(named.length >= 8, `found ${named.map((n) => n.name).join(", ")}`);
  for (const n of named) assert.ok(Array.isArray(n.rows), `${n.name} exports ROWS`);
  assert.ok(appDict.exact.size > 1000);
});

test("no conflicting duplicates, empty translations, Malay copied from Chinese or placeholder mistakes", () => {
  assert.deepEqual(dictionaryProblems(named), []);
});

test("the dictionary check itself catches each kind of mistake", () => {
  const problems = dictionaryProblems([
    { name: "a", rows: [["Save", "保存", "Simpan"], ["Overdue", "已逾期", "已逾期"], ["Paid {n}", "已付 {n}", "Dibayar"]] },
    { name: "b", rows: [["Save", "存", "Simpan"], ["Save", "保存", "Simpan"], ["Empty", "", "Kosong"], ["bad"]] },
  ]);
  assert.equal(problems.length, 5, problems.join("\n"));
  assert.ok(problems.some((p) => p.includes("Malay column is the Chinese text")));
  assert.ok(problems.some((p) => p.includes("ms placeholders")));
  assert.ok(problems.some((p) => p.includes('"Save" is also in a[0] with a different translation')));
  assert.ok(problems.some((p) => p.includes("empty text")));
  assert.ok(problems.some((p) => p.includes("must be [English")));
});

test("whole-text matching keeps the surrounding spaces and leaves unknown text alone", () => {
  const d = buildDictionary([[["Stay Logged In", "保持登录", "Kekal Log Masuk"]]]);
  assert.equal(translateWith(d, "  Stay   Logged\n In ", "zh"), "  保持登录 ");
  assert.equal(translateWith(d, "Stay Logged In", "ms"), "Kekal Log Masuk");
  assert.equal(translateWith(d, "Stay Logged In", "en"), "Stay Logged In");
  assert.equal(translateWith(d, "Stay Logged In now", "zh"), "Stay Logged In now");
  assert.equal(translateWith(d, "", "zh"), "");
  assert.equal(normText("  a \n\t b "), "a b");
});

test("{placeholder} rows translate messages with numbers and names, most specific first", () => {
  const d = buildDictionary([
    [
      ["LHDN status: {status}", "LHDN 状态：{status}", "Status LHDN: {status}"],
      ["LHDN status: {status} · Long ID received", "LHDN 状态：{status} · 已收到 Long ID", "Status LHDN: {status} · Long ID diterima"],
      ["Payment amount RM {amount} cannot exceed remaining balance RM {balance}", "付款金额 RM {amount} 不能超过剩余余额 RM {balance}", "Jumlah bayaran RM {amount} tidak boleh melebihi baki RM {balance}"],
      ["Paid", "已付", "Dibayar"],
    ],
  ]);
  assert.equal(
    translateWith(d, "Payment amount RM 50.00 cannot exceed remaining balance RM 20.00", "zh"),
    "付款金额 RM 50.00 不能超过剩余余额 RM 20.00"
  );
  assert.equal(translateWith(d, "LHDN status: valid · Long ID received", "ms"), "Status LHDN: valid · Long ID diterima");
  assert.equal(translateWith(d, "LHDN status: submitted", "zh"), "LHDN 状态：submitted");
  // Exact rows still win, and a placeholder never matches an empty value.
  assert.equal(translateWith(d, "Paid", "zh"), "已付");
  assert.equal(translateWith(d, "LHDN status: ", "zh"), "LHDN status: ");
  // A message shown over several lines is not squeezed onto one line by a pattern.
  assert.equal(translateWith(d, "LHDN status: invalid\nLHDN: CF410", "zh"), "LHDN status: invalid\nLHDN: CF410");
  // Regex characters in the English text are literal.
  const r = buildDictionary([[["Total (RM {x}) ok?", "合计（RM {x}）可以吗？", "Jumlah (RM {x}) ok?"]]]);
  assert.equal(translateWith(r, "Total (RM 1.50) ok?", "zh"), "合计（RM 1.50）可以吗？");
  assert.equal(translateWith(r, "Total xRM 1.50) ok?", "zh"), "Total xRM 1.50) ok?");
});

test("the app dictionary covers the idle-logout draft note, document pages and server errors", () => {
  assert.equal(tr("Restore draft", "zh"), "恢复草稿");
  assert.equal(tr("Discard draft", "ms"), "Buang draf");
  assert.match(
    tr("Your unsaved new work order is kept as a draft on this computer. After signing in again, open New Work Order and choose Restore draft.", "zh"),
    /草稿/
  );
  assert.equal(tr("Invoice Preview", "zh"), "发票预览");
  assert.equal(tr("Print / Export PDF", "ms"), "Cetak / Eksport PDF");
  assert.equal(tr("The counter is closed. Open the counter first (Counter page), then take payment.", "zh"), "柜台已关。请先开柜（柜台页面）再收款。");
  assert.equal(tr("Found existing vehicle:", "zh"), "找到已有车辆：");
  assert.equal(tr("Too many failed attempts. Try again in 3 minute(s).", "zh"), "失败次数太多，请 3 分钟后再试。");
  assert.equal(
    tr("Cash received (RM 10.00) is less than the cash payment (RM 12.50)", "ms"),
    "Tunai diterima (RM 10.00) kurang daripada bayaran tunai (RM 12.50)"
  );
  assert.equal(tr("Overdue", "ms"), "Tertunggak");
});

test("printed documents stay in English; the rest of those pages is translated", () => {
  for (const p of ["/work-orders/abc/invoice", "/work-orders/abc/quotation", "/work-orders/abc/receipt/", "/work-orders/abc/credit-notes/cn1"]) {
    assert.deepEqual(printedDocumentRule(p), { printArea: true, mainBody: false }, p);
  }
  assert.deepEqual(printedDocumentRule("/payment-vouchers/v1"), { printArea: true, mainBody: true });
  // Once the voucher's printed body is marked .print-area, only that area stays English
  // (the VOID note and buttons around it are translated).
  assert.deepEqual(printedDocumentRule("/payment-vouchers/v1", true), { printArea: true, mainBody: false });
  assert.deepEqual(printedDocumentRule("/work-orders/abc/invoice", true), { printArea: true, mainBody: false });
  for (const p of ["/work-orders", "/work-orders/abc", "/work-orders/new", "/payment-vouchers", "/counter/s1", "/einvoice", "/settings", ""]) {
    assert.deepEqual(printedDocumentRule(p), { printArea: false, mainBody: false }, p);
  }
});

test("messages the screens show are translated, and the Malay names match the menu", () => {
  assert.equal(tr("Work Order", "zh"), "工单");
  assert.equal(tr("Invalid rounded payment amount", "zh"), "四舍五入后的付款金额无效");
  assert.equal(tr("Unknown export type", "ms"), "Jenis eksport tidak diketahui");
  assert.equal(tr("Backed up to backups/workshop-2026-11-14.db", "zh"), "已备份到 backups/workshop-2026-11-14.db");
  assert.equal(tr("VOID since 14/11/2026", "zh"), "14/11/2026 起已作废");
  // A Malay screen never shows the Chinese paper-size hint.
  assert.equal(tr("A5 Landscape (横向)", "ms"), "A5 Landskap");
  assert.equal(tr("A5 Portrait (直向)", "ms"), "A5 Potret");
  assert.equal(tr("Replace what you typed with the saved draft?", "ms"), "Gantikan apa yang anda taip dengan draf yang disimpan?");
  // The idle-logout note names the page and button exactly as the menu and the button show them.
  const note = "Your unsaved new work order is kept as a draft on this computer. After signing in again, open New Work Order and choose Restore draft.";
  for (const lang of ["zh", "ms"]) {
    const text = tr(note, lang);
    assert.ok(text.includes(tr("New Work Order", lang)), `${lang}: ${text}`);
    assert.ok(text.includes(tr("Restore draft", lang)), `${lang}: ${text}`);
  }
  assert.ok(tr("Back to Work Order", "ms").endsWith(tr("Work Orders", "ms")));
});
