import { ROWS } from "./i18n-dict";
import { ROWS as ROWS_CORE } from "./i18n-dict-core";
import { ROWS as ROWS_DESKTOP } from "./i18n-dict-desktop";
import { ROWS as ROWS_ACCOUNTS } from "./i18n-dict-accounts";
import { ROWS as ROWS_MONEY } from "./i18n-dict-money";
import { ROWS as ROWS_EINVOICE2 } from "./i18n-dict-einvoice2";
import { ROWS as ROWS_PRIVACY } from "./i18n-dict-privacy";
import { ROWS as ROWS_OPS } from "./i18n-dict-ops";
import { ROWS as ROWS_ZH_COMPLETION } from "./i18n-dict-zh-completion";
import { buildDictionary, translateWith } from "./ux-i18n-core.mjs";

// 【中文】多语言核心（纯函数，不依赖浏览器）：把界面上的英文原文换成所选语言。
// The matching rules (whole text, collapsed whitespace, {placeholder} rows) are in ux-i18n-core.mjs.
export type Lang = "zh" | "en" | "ms";
export const LANGS: Array<{ code: Lang; label: string }> = [
  { code: "zh", label: "中文" },
  { code: "en", label: "English" },
  { code: "ms", label: "Bahasa Melayu" },
];
export const DEFAULT_LANG: Lang = "zh";

export function isLang(v: unknown): v is Lang {
  return v === "zh" || v === "en" || v === "ms";
}

const DICT = buildDictionary([ROWS, ROWS_CORE, ROWS_DESKTOP, ROWS_ACCOUNTS, ROWS_MONEY, ROWS_EINVOICE2, ROWS_PRIVACY, ROWS_OPS, ROWS_ZH_COMPLETION]);

/** 【中文】翻译一段文字：保留前后空格；词典里没有的文字原样返回。 */
export function translateText(text: string, lang: Lang): string {
  return translateWith(DICT, text, lang);
}
