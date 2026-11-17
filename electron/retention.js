// Which automatic backups to delete. Pure (no file system access) so it can be unit-tested.
// Rules (a file is kept if ANY rule keeps it):
//   1. the newest `keep` backups (the count the boss picks in Settings → Backup);
//   2. the newest backup of each day for the last 7 days;
//   3. the newest backup of each month for the last 12 months;
//   4. the newest `safetyKeep` pre-restore safety copies, however old.
// Files whose names are not ours are never deleted. (Before-upgrade copies live in
// backups/pre-upgrade and are never pruned.)
// 【中文】备份保留规则：保留最近 N 份；另外最近 7 天每天至少一份、最近 12 个月每月至少一份；
// 最新的「还原前安全副本」永远保留；不是本程序命名的文件绝不删除。

// workshop-auto-YYYYMMDD-HHMMSS[-pre-restore][-n].db[.enc]  (local time, see backup.js stamp())
const NAME_RE = /^workshop-auto-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(-pre-restore)?(?:-\d+)?\.db(?:\.enc)?$/;

const DEFAULTS = { dailyDays: 7, monthlyMonths: 12, safetyKeep: 3 };

/** { time (ms, local), preRestore } from a backup file name, or null if it is not one of ours. */
function parseBackupName(name) {
  const m = NAME_RE.exec(String(name || ""));
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  if (Number.isNaN(d.getTime())) return null;
  return { time: d.getTime(), preRestore: !!m[7] };
}

function dayKey(t) {
  const d = new Date(t);
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}
function monthKey(t) {
  const d = new Date(t);
  return d.getFullYear() * 12 + d.getMonth();
}

/**
 * Names of the backups to delete.
 * @param {Array<{ name: string, mtime?: number }>} files
 * @param {{ keep: number, now?: number, dailyDays?: number, monthlyMonths?: number, safetyKeep?: number }} opts
 * @returns {string[]}
 */
// 【中文】算出可以删除的旧备份（只返回文件名，不碰硬盘）。
function selectForDeletion(files, opts) {
  const o = { ...DEFAULTS, ...opts };
  const now = o.now ?? Date.now();
  const keep = Math.max(1, Math.floor(Number(o.keep) || 0));
  const list = [];
  for (const f of files || []) {
    const p = parseBackupName(f && f.name);
    if (p) list.push({ name: f.name, time: p.time, preRestore: p.preRestore });
  }
  list.sort((a, b) => b.time - a.time || (a.name < b.name ? 1 : -1));

  const kept = new Set();
  // 1) newest N
  for (const f of list.slice(0, keep)) kept.add(f.name);

  // 2) newest of each day, for today and the 6 days before it
  const today = new Date(now);
  const firstDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (o.dailyDays - 1)).getTime();
  const seenDays = new Set();
  // 3) newest of each month, for this month and the 11 before it
  const firstMonth = monthKey(now) - (o.monthlyMonths - 1);
  const seenMonths = new Set();
  // 4) newest pre-restore safety copies
  let safety = 0;

  for (const f of list) {
    if (f.time >= firstDay) {
      const k = dayKey(f.time);
      if (!seenDays.has(k)) { seenDays.add(k); kept.add(f.name); }
    }
    const mk = monthKey(f.time);
    if (mk >= firstMonth && !seenMonths.has(mk)) { seenMonths.add(mk); kept.add(f.name); }
    if (f.preRestore && safety < o.safetyKeep) { safety++; kept.add(f.name); }
  }
  return list.filter((f) => !kept.has(f.name)).map((f) => f.name);
}

module.exports = { parseBackupName, selectForDeletion };
