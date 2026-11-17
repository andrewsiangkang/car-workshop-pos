export type DictLang = "en" | "zh" | "ms";
export type DictRow = [string, string, string];
export type Dictionary = {
  exact: Map<string, DictRow>;
  patterns: Array<{ row: DictRow; re: RegExp; names: string[]; prefix: string; suffix: string; weight: number }>;
};

export const LANG_COL: Record<DictLang, number>;
export function normText(s: unknown): string;
export function placeholdersOf(s: string): string[];
export function isPatternKey(en: string): boolean;
export function buildDictionary(rowLists: ReadonlyArray<ReadonlyArray<DictRow>>): Dictionary;
export function translateWith(dict: Dictionary, text: string, lang: DictLang): string;
export function dictionaryProblems(named: ReadonlyArray<{ name: string; rows: ReadonlyArray<unknown> }>): string[];
export type PrintedDocumentRule = { printArea: boolean; mainBody: boolean };
export function printedDocumentRule(pathname: string, hasPrintArea?: boolean): PrintedDocumentRule;
