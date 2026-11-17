// Malaysia time (Asia/Kuala_Lumpur, UTC+8, no daylight saving since 1982) as pure helpers, so
// reports, the dashboard, CSV exports and printed dates use the shop's calendar whatever time
// zone the PC is set to — the same fixed +8 hours the document numbers already use.
// 【中文】马来西亚时间（UTC+8，没有夏令时）纯函数：报表、首页、CSV 导出和打印日期一律按马来西亚日历，不受电脑时区设置影响（与单号同一规则）。

export const MY_TIME_ZONE = "Asia/Kuala_Lumpur";
const OFFSET_MS = 8 * 60 * 60 * 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad = (n) => String(n).padStart(2, "0");

/** A Date from a Date / ISO text / epoch ms, or null when it is not a valid date. */
function toDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Calendar parts of an instant on the Malaysian clock.
 * @param {Date | string | number} value
 * @returns {{ year: number; month: number; day: number; hour: number; minute: number } | null} month 1–12
 */
export function myParts(value) {
  const d = toDate(value);
  if (!d) return null;
  const s = new Date(d.getTime() + OFFSET_MS);
  return { year: s.getUTCFullYear(), month: s.getUTCMonth() + 1, day: s.getUTCDate(), hour: s.getUTCHours(), minute: s.getUTCMinutes() };
}

/** The instant of 00:00 Malaysia time on a calendar date (month 1–12; overflow rolls over, e.g. month 13 = next January). */
export function myMidnight(year, month, day = 1) {
  return new Date(Date.UTC(year, month - 1, day) - OFFSET_MS);
}

/** "YYYY-MM-DD" on the Malaysian calendar ("" for a missing / invalid date). */
// 【中文】马来西亚日期 YYYY-MM-DD。
export function myDateKey(value) {
  const p = myParts(value);
  return p ? `${p.year}-${pad(p.month)}-${pad(p.day)}` : "";
}

/** "YYYY-MM" on the Malaysian calendar. */
export function myMonthKey(value) {
  const p = myParts(value);
  return p ? `${p.year}-${pad(p.month)}` : "";
}

/** Short English month name of a "YYYY-MM" key ("Nov"). */
export function monthLabel(key) {
  const m = Number(String(key).slice(5, 7));
  return MONTHS[m - 1] || "";
}

/** Start of the Malaysian day that contains `now`. */
export function myDayStart(now = new Date()) {
  const p = myParts(now);
  return myMidnight(p.year, p.month, p.day);
}

/** Start of the Malaysian month containing `now`, moved by `addMonths` (−11 = eleven months earlier). */
export function myMonthStart(now = new Date(), addMonths = 0) {
  const p = myParts(now);
  return myMidnight(p.year, p.month + addMonths, 1);
}

/**
 * First instant of a report period on the Malaysian calendar: "month" (default), "quarter",
 * "year", or "all" (null = no lower limit).
 */
// 【中文】报表期间的开始时间（马来西亚时间）：本月 / 本季 / 本年；"all" 表示不限。
export function myRangeStart(range, now = new Date()) {
  if (range === "all") return null;
  const p = myParts(now);
  if (range === "year") return myMidnight(p.year, 1, 1);
  if (range === "quarter") return myMidnight(p.year, Math.floor((p.month - 1) / 3) * 3 + 1, 1);
  return myMidnight(p.year, p.month, 1);
}

/**
 * First instant AFTER a report period (the next month / quarter / year start), or null for "all".
 * Used as the upper bound, so a cost dated in a later period is never counted in this one.
 */
// 【中文】报表期间结束的时间（下个月 / 下一季 / 明年的开始）；以后日期的费用不算进本期间。
export function myRangeEnd(range, now = new Date()) {
  if (range === "all") return null;
  const p = myParts(now);
  if (range === "year") return myMidnight(p.year + 1, 1, 1);
  if (range === "quarter") return myMidnight(p.year, Math.floor((p.month - 1) / 3) * 3 + 4, 1);
  return myMidnight(p.year, p.month + 1, 1);
}

/** "YYYY-MM-DD" typed in a form → 00:00 Malaysia time that day, or null when it is not a real date. */
export function parseMyDate(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text ?? "").trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const at = myMidnight(y, mo, d);
  return myDateKey(at) === `${m[1]}-${m[2]}-${m[3]}` ? at : null;
}

/** "YYYY-MM" → { start, end } (end = start of the next month), or null. */
export function parseMyMonth(text) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(text ?? "").trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12 || y < 2000 || y > 2100) return null;
  return { start: myMidnight(y, mo, 1), end: myMidnight(y, mo + 1, 1) };
}

/** "YYYY-MM" key of the month `add` months after `key`. */
export function shiftMonthKey(key, add) {
  const y = Number(String(key).slice(0, 4));
  const m = Number(String(key).slice(5, 7));
  return myMonthKey(myMidnight(y, m + add, 1));
}

/** Printed date "YYYY/MM/DD" on the Malaysian calendar (same look as before, any PC time zone). */
// 【中文】打印用日期 YYYY/MM/DD（马来西亚时间）。
export function formatMyDate(value) {
  const p = myParts(value);
  return p ? `${p.year}/${pad(p.month)}/${pad(p.day)}` : "";
}

/** Printed date and time "YYYY/MM/DD HH:mm" (24-hour) on the Malaysian clock. */
export function formatMyDateTime(value) {
  const p = myParts(value);
  return p ? `${p.year}/${pad(p.month)}/${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}` : "";
}
