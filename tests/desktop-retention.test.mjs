import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseBackupName, selectForDeletion } = require("../electron/retention.js");

// Names use local time, exactly like stamp() in electron/backup.js.
function name(d, suffix = "", ext = ".db") {
  const p = (n) => String(n).padStart(2, "0");
  return (
    "workshop-auto-" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" +
    p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + suffix + ext
  );
}
const NOW = new Date(2026, 10, 14, 18, 0, 0); // 14 Nov 2026 18:00 local
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600 * 1000);
const keptOf = (files, deleted) => files.map((f) => f.name).filter((n) => !deleted.includes(n));

test("parseBackupName reads the local time stamp and the pre-restore flag", () => {
  const d = new Date(2026, 0, 2, 3, 4, 5);
  assert.deepEqual(parseBackupName(name(d)), { time: d.getTime(), preRestore: false });
  assert.deepEqual(parseBackupName(name(d, "-pre-restore")), { time: d.getTime(), preRestore: true });
  assert.deepEqual(parseBackupName(name(d, "-2", ".db.enc")), { time: d.getTime(), preRestore: false });
  assert.equal(parseBackupName("workshop.db"), null);
  assert.equal(parseBackupName("my-notes.db"), null);
});

test("keeps the newest N when all backups are from today", () => {
  const files = Array.from({ length: 40 }, (_, i) => ({ name: name(hoursAgo(i * 0.25)) }));
  const deleted = selectForDeletion(files, { keep: 30, now: NOW.getTime() });
  assert.equal(deleted.length, 10);
  // the 10 oldest go
  assert.deepEqual(deleted.sort(), files.slice(30).map((f) => f.name).sort());
});

test("keeps one per day for the last 7 days even when the count is used up", () => {
  // 10 backups a day for 10 days, keep only 5
  const files = [];
  for (let day = 0; day < 10; day++) for (let i = 0; i < 10; i++) files.push({ name: name(hoursAgo(day * 24 + i)) });
  const kept = keptOf(files, selectForDeletion(files, { keep: 5, now: NOW.getTime() }));
  for (let day = 0; day < 7; day++) {
    const d = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - day);
    const prefix = name(d).slice(0, "workshop-auto-YYYYMMDD".length);
    assert.ok(kept.some((n) => n.startsWith(prefix)), "a backup from " + d.toDateString() + " is kept");
  }
  // days 8-10 ago are not protected by the daily rule; only the monthly rule may keep one of them
  const oldDays = kept.filter((n) => parseBackupName(n).time < new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - 6).getTime());
  assert.ok(oldDays.length <= 1, "at most the newest backup of the month outside the 7 days: " + oldDays);
});

test("keeps the newest backup of each of the last 12 months and deletes older months", () => {
  const files = [];
  for (let m = 0; m < 18; m++) {
    for (const day of [3, 15, 27]) files.push({ name: name(new Date(2026, 10 - m, day, 12, 0, 0)) });
  }
  const deleted = selectForDeletion(files, { keep: 3, now: NOW.getTime() });
  const kept = keptOf(files, deleted);
  for (let m = 0; m < 12; m++) {
    assert.ok(kept.includes(name(new Date(2026, 10 - m, 27, 12, 0, 0))), "newest of month -" + m + " kept");
  }
  // nothing from 12+ months back survives (count is 3 and those months are outside the window)
  const cutoff = new Date(2025, 11, 1).getTime();
  assert.deepEqual(kept.filter((n) => parseBackupName(n).time < cutoff), []);
});

test("never deletes the newest pre-restore safety copies, however old", () => {
  const files = [
    ...Array.from({ length: 20 }, (_, i) => ({ name: name(hoursAgo(i)) })),
    { name: name(new Date(2024, 0, 5, 9, 0, 0), "-pre-restore") },
    { name: name(new Date(2024, 0, 4, 9, 0, 0), "-pre-restore") },
    { name: name(new Date(2024, 0, 3, 9, 0, 0), "-pre-restore") },
    { name: name(new Date(2024, 0, 2, 9, 0, 0), "-pre-restore") },
  ];
  const deleted = selectForDeletion(files, { keep: 5, now: NOW.getTime() });
  const kept = keptOf(files, deleted);
  assert.ok(kept.includes(name(new Date(2024, 0, 5, 9, 0, 0), "-pre-restore")));
  assert.ok(kept.includes(name(new Date(2024, 0, 4, 9, 0, 0), "-pre-restore")));
  assert.ok(kept.includes(name(new Date(2024, 0, 3, 9, 0, 0), "-pre-restore")));
  assert.ok(deleted.includes(name(new Date(2024, 0, 2, 9, 0, 0), "-pre-restore")), "older safety copies may go");
});

test("files that are not ours are never deleted", () => {
  const files = [{ name: "workshop.db" }, { name: "holiday-photos.db" }, { name: "workshop-auto-latest.db" }];
  assert.deepEqual(selectForDeletion(files, { keep: 1, now: NOW.getTime() }), []);
});

test("works the same for encrypted copies in the extra folder", () => {
  const files = Array.from({ length: 12 }, (_, i) => ({ name: name(hoursAgo(i), "", ".db.enc") }));
  assert.equal(selectForDeletion(files, { keep: 10, now: NOW.getTime() }).length, 2);
});
