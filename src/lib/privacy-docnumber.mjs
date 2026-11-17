// Document numbering rules (pure): the next number of the day, never re-using a number that was
// issued before a backup restore rolled the database back, and the comparison that finds those
// numbers in the safety copy taken before the restore.
// 【中文】单据编号的纯规则：当天的下一个号码（跳过还原备份前已开出的号码），以及比对还原前安全副本、找出被还原掉的号码。

/**
 * Next number for `base` (e.g. "INV20261114"): one more than the highest number of that day
 * that is in use OR retired. A non-numeric tail is ignored.
 * 【中文】下一个号码 = 当天已使用或已停用号码中最大的 + 1（至少 3 位数）。
 * @param {string} base
 * @param {Iterable<string | null | undefined>} used
 * @param {Iterable<string | null | undefined>} [retired]
 * @returns {string}
 */
export function nextSequenceNumber(base, used, retired = []) {
  let max = 0;
  for (const list of [used, retired]) {
    for (const n of list) {
      if (typeof n !== "string" || !n.startsWith(base)) continue;
      const k = parseInt(n.slice(base.length), 10);
      if (Number.isFinite(k) && k > max) max = k;
    }
  }
  return `${base}${String(max + 1).padStart(3, "0")}`;
}

/** Number kinds kept in RetiredDocNumber.kind, and where each one is stored. */
export const DOC_NUMBER_SOURCES = [
  { kind: "WO", table: "WorkOrder", column: "orderNumber" },
  { kind: "QT", table: "WorkOrder", column: "quotationNumber" },
  { kind: "INV", table: "WorkOrder", column: "invoiceNumber" },
  { kind: "RC", table: "WorkOrder", column: "receiptNumber" },
  { kind: "CN", table: "CreditNote", column: "number" },
  { kind: "SI", table: "SupplierInvoice", column: "internalNo" },
  { kind: "PV", table: "PaymentVoucher", column: "number" },
];

/**
 * Numbers that exist in the safety copy (data from just before the restore) but not in the
 * restored database: they were already given to a document, so they must never be issued again.
 * @param {Record<string, Iterable<string | null | undefined>>} safety  kind → numbers in the safety copy
 * @param {Record<string, Iterable<string | null | undefined>>} restored  kind → numbers in the restored database
 * @returns {Array<{ kind: string, number: string }>}
 */
export function numbersToRetire(safety, restored) {
  /** @type {Array<{ kind: string, number: string }>} */
  const out = [];
  const seen = new Set();
  for (const { kind } of DOC_NUMBER_SOURCES) {
    const have = new Set(Array.from(restored[kind] || []).filter(Boolean));
    for (const n of safety[kind] || []) {
      if (typeof n !== "string" || !n || have.has(n) || seen.has(n)) continue;
      seen.add(n);
      out.push({ kind, number: n });
    }
  }
  return out;
}

/**
 * e-Invoice UUIDs that LHDN received for documents in the safety copy but that no document in the
 * restored database carries any more: the boss has to re-enter them (or check them in the portal).
 * @param {Array<{ kind: string, number: string | null, uuid: string | null, env?: string | null, status?: string | null }>} safetyDocs
 * @param {Iterable<string | null | undefined>} restoredUuids
 */
export function lostEInvoices(safetyDocs, restoredUuids) {
  const have = new Set(Array.from(restoredUuids).filter(Boolean));
  const seen = new Set();
  return safetyDocs.filter((d) => {
    if (!d.uuid || have.has(d.uuid) || seen.has(d.uuid)) return false;
    seen.add(d.uuid);
    return true;
  });
}

/**
 * Count of retired numbers per kind, e.g. { INV: 3, RC: 2 }.
 * @param {Array<{ kind: string }>} list
 */
export function countByKind(list) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const { kind } of list) out[kind] = (out[kind] || 0) + 1;
  return out;
}

/**
 * Where a restore's safety copy is kept, from the name the desktop app recorded (electron/backup.js),
 * as path parts below data/backups — never a path from anywhere else:
 * - "workshop-auto-…-pre-restore.db": a checked copy in backups/auto;
 * - "damaged/workshop-before-emergency-restore-<stamp>" ("\\" on Windows): the raw database files an
 *   emergency restore kept when no checked copy could be made (a write was in progress, e.g. a
 *   hot journal after a power cut). They are a readable database once SQLite rolls the journal back.
 * @param {unknown} name
 * @returns {{ kind: "auto" | "raw"; parts: string[] } | null}
 */
// 【中文】按桌面程序记下的名称找还原前的安全副本（只认 backups 下的这两种）：auto 里检查过的副本，或紧急还原时保留的原始数据库文件（damaged 文件夹）。
export function safetyCopyLocation(name) {
  const n = typeof name === "string" ? name : "";
  if (/^[^\\/]+\.db$/i.test(n)) return { kind: "auto", parts: ["auto", n] };
  const raw = /^damaged[\\/](workshop-before-emergency-restore-[\w-]+)$/.exec(n);
  if (raw) return { kind: "raw", parts: ["damaged", raw[1]] };
  return null;
}
