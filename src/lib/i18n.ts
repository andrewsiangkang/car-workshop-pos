import { ROWS } from "./i18n-dict";

// 【中文】多语言核心（纯函数，不依赖浏览器）：把界面上的英文原文换成所选语言。
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

const COL: Record<Lang, number> = { en: 0, zh: 1, ms: 2 };
const index = new Map<string, [string, string, string]>();
for (const r of ROWS) index.set(r[0], r);

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** 【中文】翻译一段文字：保留前后空格；词典里没有的文字原样返回。 */
export function translateText(text: string, lang: Lang): string {
  if (lang === "en" || !text) return text;
  const core = norm(text);
  if (!core) return text;
  const row = index.get(core);
  if (!row) return text;
  const lead = text.match(/^\s*/)![0];
  const trail = text.match(/\s*$/)![0];
  return lead + row[COL[lang]] + trail;
}
