// Pure translation matching used by src/lib/i18n.ts (and tested in tests/ux-i18n.test.mjs).
// A dictionary row is [English, 中文, Bahasa Melayu]. The English text is matched against a whole
// text node, alert or confirm message, with runs of whitespace collapsed.
// A row whose English contains {name} placeholders matches messages built at run time, e.g.
// ["Password must be at least {n} characters", "密码至少需要 {n} 个字符", "Kata laluan mesti sekurang-kurangnya {n} aksara"].
// 【中文】翻译匹配（纯函数）：整段文字对上词典的英文才翻译；英文里带 {名字} 的行可匹配带数字、单号等变量的句子。

export const LANG_COL = { en: 0, zh: 1, ms: 2 };

const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
const CJK = /[㐀-鿿豈-﫿＀-￯]/;

/** Collapse runs of whitespace and trim. */
export function normText(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

/** Placeholder names in a dictionary text, in order (duplicates kept). */
export function placeholdersOf(s) {
  return Array.from(String(s).matchAll(PLACEHOLDER), (m) => m[1]);
}

export function isPatternKey(en) {
  return placeholdersOf(en).length > 0;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function compilePattern(key, row) {
  const names = placeholdersOf(key);
  const literals = key.split(PLACEHOLDER).filter((_, i) => i % 2 === 0);
  const re = new RegExp("^" + literals.map(escapeRe).join("(.+?)") + "$");
  return {
    row,
    re,
    names,
    prefix: literals[0],
    suffix: literals[literals.length - 1],
    // More fixed text = more specific: tried first.
    weight: literals.join("").length,
  };
}

/**
 * Build the lookup from several row lists. Later rows win for the same English text.
 * @param {Array<Array<[string, string, string]>>} rowLists
 */
export function buildDictionary(rowLists) {
  const exact = new Map();
  const byKey = new Map();
  for (const rows of rowLists) {
    for (const r of rows) {
      const key = normText(r[0]);
      if (!key) continue;
      if (isPatternKey(key)) byKey.set(key, compilePattern(key, r));
      else exact.set(key, r);
    }
  }
  const patterns = [...byKey.values()].sort((a, b) => b.weight - a.weight);
  return { exact, patterns };
}

function fill(template, names, values) {
  const byName = new Map();
  names.forEach((n, i) => {
    if (!byName.has(n)) byName.set(n, values[i]);
  });
  return template.replace(PLACEHOLDER, (m, n) => (byName.has(n) ? byName.get(n) : m));
}

function matchPattern(patterns, core, col) {
  for (const p of patterns) {
    if (!core.startsWith(p.prefix) || !core.endsWith(p.suffix)) continue;
    const m = p.re.exec(core);
    if (!m) continue;
    return fill(p.row[col], p.names, m.slice(1));
  }
  return null;
}

/**
 * Translate one text. Keeps the leading / trailing whitespace; returns the text unchanged when
 * the language is English or nothing matches. Text spread over several lines (e.g. a status
 * message shown with line breaks) is only translated by an exact row, never by a pattern,
 * so its line breaks are not lost.
 * @param {{ exact: Map<string, string[]>, patterns: Array<object> }} dict
 * @param {string} text
 * @param {"en" | "zh" | "ms"} lang
 */
export function translateWith(dict, text, lang) {
  if (lang === "en" || !text) return text;
  const col = LANG_COL[lang];
  if (col === undefined) return text;
  const core = normText(text);
  if (!core) return text;
  const row = dict.exact.get(core);
  let out = row ? row[col] : null;
  if (out == null && !/\n/.test(text.trim())) out = matchPattern(dict.patterns, core, col);
  if (out == null || out === "") return text;
  const lead = text.match(/^\s*/)[0];
  const trail = text.match(/\s*$/)[0];
  return lead + out + trail;
}

// Pages that show a document to print. The printed document stays in the language it is issued in
// (English); the rest of the page is translated. 【中文】打印单据页面：单据本身保持英文，其余照常翻译。
const DOC_PAGE = /\/work-orders\/[^/]+\/(invoice|quotation|receipt)\/?$|\/work-orders\/[^/]+\/credit-notes\/[^/]+\/?$/;
const VOUCHER_PAGE = /\/payment-vouchers\/[^/]+\/?$/;

/**
 * Which parts of a page are the printed document, besides anything marked data-no-i18n:
 * printArea: the element with class "print-area" (invoice, receipt, quotation, credit note);
 * mainBody: everything inside <main> that is not marked no-print (payment voucher page whose printed
 * body is not marked .print-area yet; once the page has a .print-area, only that area stays English and
 * the rest of the page, e.g. the VOID note, is translated).
 * Other pages (e.g. the counter settlement, an internal report) are translated in full.
 * @param {string} pathname
 * @param {boolean} [hasPrintArea] whether the page currently has an element with class "print-area"
 * @returns {{ printArea: boolean, mainBody: boolean }}
 */
export function printedDocumentRule(pathname, hasPrintArea = false) {
  const p = String(pathname || "");
  const voucher = VOUCHER_PAGE.test(p);
  return { printArea: voucher || DOC_PAGE.test(p), mainBody: voucher && !hasPrintArea };
}

/**
 * Problems in the dictionaries (used by the tests): wrong shape, empty translations,
 * the same English text with different translations, Malay copied from the Chinese
 * column, and placeholders that differ between the columns.
 * @param {Array<{ name: string, rows: unknown[] }>} named
 * @returns {string[]}
 */
export function dictionaryProblems(named) {
  const problems = [];
  const seen = new Map();
  for (const { name, rows } of named) {
    rows.forEach((r, i) => {
      const where = `${name}[${i}]`;
      if (!Array.isArray(r) || r.length !== 3 || r.some((c) => typeof c !== "string")) {
        problems.push(`${where}: a row must be [English, 中文, Bahasa Melayu]`);
        return;
      }
      const [en, zh, ms] = r;
      const key = normText(en);
      if (!key || !normText(zh) || !normText(ms)) problems.push(`${where}: empty text in ${JSON.stringify(r)}`);
      if (ms === zh && CJK.test(ms)) problems.push(`${where}: the Malay column is the Chinese text for "${key}"`);
      const want = [...placeholdersOf(en)].sort().join(",");
      for (const [lang, t] of [["zh", zh], ["ms", ms]]) {
        const got = [...placeholdersOf(t)].sort().join(",");
        if (got !== want) problems.push(`${where}: ${lang} placeholders {${got}} differ from English {${want}} for "${key}"`);
      }
      const prev = seen.get(key);
      if (!prev) seen.set(key, { where, zh, ms });
      else if (prev.zh !== zh || prev.ms !== ms) {
        problems.push(`${where}: "${key}" is also in ${prev.where} with a different translation`);
      }
    });
  }
  return problems;
}
