// 【中文】CSV 核心（纯函数）：把数据转成 Excel 能直接打开的 CSV。
// - 开头加 UTF-8 BOM，中文/马来文在 Excel 里不会乱码。
// - 防 CSV 公式注入：文字以 = + - @ 开头时前面补一个单引号。
// - 数字（含金额）不走上面的处理，所以负数仍是 -5.00。

const BOM = "\uFEFF";
const FORMULA_START = /^[=+\-@\t\r]/;

/** Format a Date as local "YYYY-MM-DD" (the shop's own timezone). */
export function formatDate(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Escape one text cell for CSV. */
export function csvText(value) {
  let s = String(value ?? "");
  if (FORMULA_START.test(s)) s = "'" + s;
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function csvCell(value, type) {
  if (value === null || value === undefined || value === "") return "";
  if (type === "money") {
    const n = Number(value);
    return Number.isFinite(n) ? n.toFixed(2) : "";
  }
  if (type === "date") return formatDate(value);
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value instanceof Date) return formatDate(value);
  return csvText(value);
}

/**
 * columns: [{ key, header, type? }]  type: "money" | "date" | undefined
 * rows: array of plain objects
 */
export function toCsv(columns, rows) {
  const lines = [columns.map((c) => csvText(c.header)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => csvCell(row[c.key], c.type)).join(","));
  }
  return BOM + lines.join("\r\n") + "\r\n";
}
