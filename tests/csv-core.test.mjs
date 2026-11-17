import test from "node:test";
import assert from "node:assert/strict";
import { toCsv, csvText, formatDate } from "../src/lib/csv-core.mjs";

test("starts with a UTF-8 BOM so Excel reads Chinese correctly", () => {
  const out = toCsv([{ key: "a", header: "名称" }], [{ a: "机油" }]);
  assert.equal(out.charCodeAt(0), 0xfeff);
  assert.ok(out.includes("名称\r\n机油\r\n"));
});

test("quotes commas, quotes and line breaks", () => {
  assert.equal(csvText('a,b'), '"a,b"');
  assert.equal(csvText('say "hi"'), '"say ""hi"""');
  assert.equal(csvText("line1\nline2"), '"line1\nline2"');
});

test("neutralises spreadsheet formula injection in text", () => {
  assert.equal(csvText("=HYPERLINK(\"x\")").startsWith("\"'="), true);
  assert.equal(csvText("+601234"), "'+601234");
  assert.equal(csvText("-cmd"), "'-cmd");
  assert.equal(csvText("@SUM(A1)"), "'@SUM(A1)");
});

test("money columns keep two decimals and negative numbers stay numeric", () => {
  const out = toCsv([{ key: "m", header: "Amt", type: "money" }], [{ m: -5 }, { m: 12.3 }, { m: null }]);
  assert.ok(out.endsWith("Amt\r\n-5.00\r\n12.30\r\n\r\n"));
});

test("formats dates as local YYYY-MM-DD and tolerates empty values", () => {
  assert.equal(formatDate(new Date(2026, 10, 3, 14, 5)), "2026-11-03");
  assert.equal(formatDate(null), "");
  assert.equal(formatDate("not a date"), "");
});

test("empty rows still produce a header line", () => {
  const out = toCsv([{ key: "a", header: "A" }, { key: "b", header: "B" }], []);
  assert.equal(out, "\uFEFFA,B\r\n");
});
