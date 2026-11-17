// Run the checks in a PC time zone far from Malaysia: the helpers must not depend on it.
process.env.TZ = "America/Los_Angeles";
import test from "node:test";
import assert from "node:assert/strict";
import {
  myParts, myMidnight, myDateKey, myMonthKey, monthLabel, myDayStart, myMonthStart, myRangeStart, myRangeEnd,
  parseMyDate, parseMyMonth, shiftMonthKey, formatMyDate, formatMyDateTime,
} from "../src/lib/money-time.mjs";

test("calendar date and month follow Malaysia (UTC+8), not the PC", () => {
  const lateUtc = new Date("2026-10-31T16:30:00Z"); // 1 Nov 00:30 in Kuala Lumpur
  assert.equal(myDateKey(lateUtc), "2026-11-01");
  assert.equal(myMonthKey(lateUtc), "2026-11");
  assert.deepEqual(myParts(lateUtc), { year: 2026, month: 11, day: 1, hour: 0, minute: 30 });
  assert.equal(myDateKey("2026-11-14T15:59:59Z"), "2026-11-14");
  assert.equal(myDateKey(null), "");
  assert.equal(myDateKey("rubbish"), "");
});

test("midnight, day, month, quarter and year starts are Malaysian midnights", () => {
  assert.equal(myMidnight(2026, 11, 1).toISOString(), "2026-10-31T16:00:00.000Z");
  assert.equal(myMidnight(2026, 13, 1).toISOString(), "2026-12-31T16:00:00.000Z"); // month 13 = next January
  const now = new Date("2026-11-14T20:00:00Z"); // 15 Nov 04:00 in KL
  assert.equal(myDayStart(now).toISOString(), "2026-11-14T16:00:00.000Z");
  assert.equal(myMonthStart(now).toISOString(), "2026-10-31T16:00:00.000Z");
  assert.equal(myMonthStart(now, -11).toISOString(), "2025-11-30T16:00:00.000Z");
  assert.equal(myRangeStart("month", now).toISOString(), "2026-10-31T16:00:00.000Z");
  assert.equal(myRangeStart("quarter", now).toISOString(), "2026-09-30T16:00:00.000Z");
  assert.equal(myRangeStart("year", now).toISOString(), "2025-12-31T16:00:00.000Z");
  assert.equal(myRangeStart("all", now), null);
  assert.equal(myRangeStart("nonsense", now).toISOString(), "2026-10-31T16:00:00.000Z");
  // The period ends where the next one starts (a forward-dated supplier invoice is not counted early).
  assert.equal(myRangeEnd("month", now).toISOString(), "2026-11-30T16:00:00.000Z");
  assert.equal(myRangeEnd("quarter", now).toISOString(), "2026-12-31T16:00:00.000Z");
  assert.equal(myRangeEnd("year", now).toISOString(), "2026-12-31T16:00:00.000Z");
  assert.equal(myRangeEnd("all", now), null);
  assert.equal(myRangeEnd("month", new Date("2026-12-20T00:00:00Z")).toISOString(), "2026-12-31T16:00:00.000Z");
  assert.equal(myRangeEnd("quarter", new Date("2026-02-01T00:00:00Z")).toISOString(), "2026-03-31T16:00:00.000Z");
});

test("typed dates and months are read as Malaysian days", () => {
  assert.equal(parseMyDate("2026-11-14").toISOString(), "2026-11-13T16:00:00.000Z");
  assert.equal(parseMyDate("2026-02-30"), null);
  assert.equal(parseMyDate("14/11/2026"), null);
  const m = parseMyMonth("2026-12");
  assert.equal(m.start.toISOString(), "2026-11-30T16:00:00.000Z");
  assert.equal(m.end.toISOString(), "2026-12-31T16:00:00.000Z");
  assert.equal(parseMyMonth("2026-13"), null);
  assert.equal(shiftMonthKey("2026-01", -1), "2025-12");
  assert.equal(shiftMonthKey("2026-11", 2), "2027-01");
  assert.equal(monthLabel("2026-11"), "Nov");
});

test("printed dates keep the old look, in Malaysia time", () => {
  const t = new Date("2026-11-14T16:05:00Z"); // 15 Nov 00:05 in KL
  assert.equal(formatMyDate(t), "2026/11/15");
  assert.equal(formatMyDateTime(t), "2026/11/15 00:05");
  assert.equal(formatMyDateTime("2026-11-14T07:05:00Z"), "2026/11/14 15:05");
  // Same text the old Intl zh-CN formatter gave on a PC set to Malaysia time.
  const intl = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" });
  assert.equal(formatMyDateTime(t), intl.format(t));
});
