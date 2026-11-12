export type CsvColumn = { key: string; header: string; type?: "money" | "date" };
export function formatDate(value: Date | string | null | undefined): string;
export function csvText(value: unknown): string;
export function toCsv(columns: CsvColumn[], rows: Array<Record<string, unknown>>): string;
