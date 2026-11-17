import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { hasDataKey, isSealedSecret, sealSecret } from "@/lib/secret-box";
import { DOC_NUMBER_SOURCES, countByKind, lostEInvoices, numbersToRetire, safetyCopyLocation } from "@/lib/privacy-docnumber.mjs";
import { sweepExpiredBuyerData } from "@/lib/privacy-anonymise";
import { expiredBuyerDataSummary } from "@/lib/privacy-freeze.mjs";

/**
 * One-time jobs at server start for the desktop app (called from instrumentation.ts,
 * after ensureSchema).
 * 【中文】服务器启动时的一次性工作（在数据库升级之后运行）：加密旧的明文密钥、记录「还原备份」的审计日志。
 */

function dataDir() {
  return process.env.WORKSHOP_DATA_DIR || path.join(process.cwd(), "data");
}

/**
 * Seal a MyInvois client secret that an older version stored in plain text. Runs once:
 * afterwards the stored value starts with "enc:v1:". The update only applies if the value
 * is still the one read, so a secret saved at the same moment is never overwritten.
 * 【中文】把旧版本明文保存的 MyInvois Client Secret 改为加密保存（只做一次）。
 */
export async function sealPlainSecrets() {
  if (!hasDataKey()) return;
  const rows = await prisma.shopProfile.findMany({ select: { id: true, myInvoisClientSecret: true } });
  for (const r of rows) {
    const v = r.myInvoisClientSecret;
    if (!v || isSealedSecret(v)) continue;
    const res = await prisma.shopProfile.updateMany({
      where: { id: r.id, myInvoisClientSecret: v },
      data: { myInvoisClientSecret: sealSecret(v) },
    });
    if (res.count) console.log("[secret-box] the MyInvois client secret is now stored encrypted");
  }
}

/**
 * Customers anonymised while their documents were still inside the record-keeping period: once a
 * document has passed it, its buyer data is cleared (sweepExpiredBuyerData). Checked at every
 * start, so nothing depends on someone running the retention schedule. One audit entry with
 * counts only, and only when something was cleared or could not be (a customer that fails on every
 * start still shows in the audit log).
 * 【中文】匿名化时单据还在保存期内的客户：单据过了保存期后，启动时清除买方资料；清除了或有客户清除失败时才写一条只有数量的审计记录（每次都失败的客户也会出现在审计日志里）。
 */
export async function clearExpiredBuyerDataAtStart() {
  const r = await sweepExpiredBuyerData(prisma);
  const summary = expiredBuyerDataSummary(r);
  if (!summary) return;
  await writeAuditLog({
    actor: { id: "", name: "System (server start)", email: "", role: "SYSTEM" },
    action: "CUSTOMER_EXPIRED_BUYER_DATA_CLEARED",
    entityType: "Customer",
    entityId: null,
    summary,
    details: { customers: r.customers, documents: r.documents, failed: r.failed },
  });
}

type RestoreMarker = {
  status?: string;
  at?: number;
  source?: string;
  folder?: string;
  safetyCopy?: string;
  photos?: number;
  workOrders?: number | null;
  lastWorkOrderAt?: string | null;
  error?: string;
  /** Restored from the desktop app's emergency path (server could not start, no login). */
  emergency?: boolean;
  actor?: { id?: string; name?: string; role?: string };
  /** Set once the BACKUP_RESTORED entry is written while the safety-copy comparison still runs. */
  restoreRecordedAt?: number;
};

const RESTORE_ACTIONS: Record<string, { action: string; summary: string }> = {
  restored: { action: "BACKUP_RESTORED", summary: "Database restored from backup" },
  failed: { action: "BACKUP_RESTORE_FAILED", summary: "Backup restore failed; data unchanged" },
  "rolled-back": { action: "BACKUP_RESTORE_ROLLED_BACK", summary: "Restored backup could not be opened; data from before the restore was put back" },
};

type Reader = { $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T> };
type LostEInvoice = { kind: string; number: string | null; uuid: string | null; env: string | null; status: string | null };

/** Column names of a table (empty when the table does not exist). */
async function columnsOf(db: Reader, table: string): Promise<Set<string>> {
  const rows = await db.$queryRawUnsafe<Array<{ name: string }>>(`SELECT "name" FROM pragma_table_info('${table}')`);
  return new Set(rows.map((r) => r.name));
}

/** Every document number of each kind (WO, QT, INV, RC, CN, SI, PV) in one database. */
async function documentNumbers(db: Reader): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const src of DOC_NUMBER_SOURCES) {
    const cols = await columnsOf(db, src.table);
    if (!cols.has(src.column)) {
      out[src.kind] = [];
      continue;
    }
    const rows = await db.$queryRawUnsafe<Array<{ n: string | null }>>(
      `SELECT "${src.column}" AS "n" FROM "${src.table}" WHERE "${src.column}" IS NOT NULL`
    );
    out[src.kind] = rows.map((r) => r.n).filter((n): n is string => !!n);
  }
  return out;
}

/** Numbers already retired in that database (by an earlier restore), added to `numbers` by kind. */
async function addRetired(db: Reader, numbers: Record<string, string[]>) {
  const cols = await columnsOf(db, "RetiredDocNumber");
  if (!cols.has("number") || !cols.has("kind")) return numbers;
  const rows = await db.$queryRawUnsafe<Array<{ number: string; kind: string }>>(`SELECT "number", "kind" FROM "RetiredDocNumber"`);
  for (const r of rows) if (numbers[r.kind]) numbers[r.kind].push(r.number);
  return numbers;
}

/** e-Invoice UUIDs held by invoices, credit notes and consolidated e-Invoices in one database. */
async function eInvoiceDocs(db: Reader): Promise<LostEInvoice[]> {
  const tables = [
    { kind: "invoice", table: "WorkOrder", number: "invoiceNumber" },
    { kind: "credit note", table: "CreditNote", number: "number" },
    { kind: "consolidated", table: "ConsolidatedInvoice", number: "number" },
  ];
  const out: LostEInvoice[] = [];
  for (const t of tables) {
    const cols = await columnsOf(db, t.table);
    if (!cols.has("eInvoiceUuid")) continue;
    const env = cols.has("eInvoiceEnv") ? `"eInvoiceEnv"` : "NULL";
    const status = cols.has("eInvoiceStatus") ? `"eInvoiceStatus"` : "NULL";
    const rows = await db.$queryRawUnsafe<Array<{ number: string | null; uuid: string | null; env: string | null; status: string | null }>>(
      `SELECT "${t.number}" AS "number", "eInvoiceUuid" AS "uuid", ${env} AS "env", ${status} AS "status" FROM "${t.table}" WHERE "eInvoiceUuid" IS NOT NULL AND "eInvoiceUuid" <> ''`
    );
    for (const r of rows) out.push({ kind: t.kind, number: r.number, uuid: r.uuid, env: r.env, status: r.status });
  }
  return out;
}

/**
 * Remove a temporary copy of the pre-restore database. Never throws: on Windows the file can stay
 * locked for a moment (the SQLite engine just closed, an antivirus scan of the large copy), and a
 * throw from a `finally` would replace the comparison's result, which is then lost for good.
 * 【中文】删除还原前数据库的临时副本，不会抛出错误（Windows 上文件可能短暂被锁住；在 finally 里抛错会盖掉比对结果）。
 */
function removeTempCopy(dir: string) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (e) {
    console.error("[restore-audit] could not remove the temporary copy", e);
  }
}

/**
 * Temporary copies an earlier start could not remove (locked, or the app was closed during the
 * comparison) hold a whole customer database outside the data folder: removed once they are a
 * day old, checked at every start (recordRestoreAudit) and before each new copy. 【中文】之前没删掉的临时副本（被锁住或比对途中关掉程序）超过一天就删除，避免整份客户数据留在临时文件夹。
 */
function removeStaleTempCopies() {
  try {
    const tmp = os.tmpdir();
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    for (const name of fs.readdirSync(tmp)) {
      if (!name.startsWith("pos-safety-")) continue;
      const dir = path.join(tmp, name);
      try {
        if (fs.statSync(dir).mtimeMs < dayAgo) removeTempCopy(dir);
      } catch {
        // gone meanwhile, or not readable: leave it
      }
    }
  } catch {
    // the temporary folder cannot be listed: nothing to clean up
  }
}

type RetireResult = {
  checked: boolean;
  reason?: string;
  retired: Array<{ kind: string; number: string }>;
  lostEInvoices: LostEInvoice[];
};

/**
 * After a restore: open the safety copy (the data from just before the restore) with a separate,
 * read-only connection — only SELECTs are run on it — and
 * 1. put every document number it has (or had retired) that the restored database does not into
 *    RetiredDocNumber, so numbering never issues it again (INSERT OR IGNORE: running it twice
 *    changes nothing);
 * 2. list the e-Invoice UUIDs it has that the restored database does not (already reported to
 *    LHDN, but no longer on any document), so the boss can re-enter them.
 * 【中文】还原之后：用单独的只读连接打开还原前的安全副本，① 把安全副本里有、还原后的数据库里没有的单据号码
 * 写进 RetiredDocNumber（以后不会再开出这些号码，可重复执行）；② 列出只在安全副本里的电子发票 UUID，让老板重新登记。
 */
export async function retireNumbersFromSafetyCopy(safetyCopy: unknown): Promise<RetireResult> {
  const empty = { retired: [], lostEInvoices: [] };
  const name = typeof safetyCopy === "string" ? safetyCopy : "";
  // A plain file name in the automatic backups folder, or the raw files an emergency restore kept
  // in backups/damaged (never a path from elsewhere). 【中文】只认 auto 里的副本，或紧急还原保留在 damaged 里的原始文件。
  const where = safetyCopyLocation(name);
  if (!where) return { checked: false, reason: "no safety copy named", ...empty };
  const loc = path.join(dataDir(), "backups", ...where.parts);
  if (!fs.existsSync(loc)) return { checked: false, reason: "safety copy not found", ...empty };

  let file = loc;
  let tmpDir: string | null = null;
  if (where.kind === "raw") {
    // The raw database (with any -journal / -wal / -shm) is copied to a temporary folder, so
    // SQLite can roll a hot journal back there while the copy kept for support stays untouched.
    // 【中文】把原始数据库文件（连同 -journal / -wal / -shm）复制到临时文件夹，让 SQLite 在那里回滚日志，保留给技术支持的原件不变。
    const db = fs.readdirSync(loc).find((f) => /\.db$/i.test(f));
    if (!db) return { checked: false, reason: "safety copy not found", ...empty };
    removeStaleTempCopies();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-safety-"));
    try {
      for (const ext of ["", "-journal", "-wal", "-shm"]) {
        const src = path.join(loc, db + ext);
        if (fs.existsSync(src)) fs.copyFileSync(src, path.join(tmpDir, db + ext));
      }
    } catch (e) {
      // The copy error is the one reported, not a failed clean-up.
      removeTempCopy(tmpDir);
      throw e;
    }
    file = path.join(tmpDir, db);
  }

  const copy = new PrismaClient({ datasourceUrl: "file:" + file.replace(/\\/g, "/") });
  try {
    const [safetyNumbers, restoredNumbers, safetyDocs, restoredDocs] = await Promise.all([
      // Numbers an earlier restore had retired stay retired, even when the backup is older still.
      documentNumbers(copy).then((n) => addRetired(copy, n)),
      // Numbers the restored database already uses or has retired are not counted again.
      documentNumbers(prisma).then((n) => addRetired(prisma, n)),
      eInvoiceDocs(copy),
      eInvoiceDocs(prisma),
    ]);
    const fresh = numbersToRetire(safetyNumbers, restoredNumbers);
    // Epoch milliseconds: the same form Prisma itself stores dates in SQLite.
    const now = Date.now();
    for (let i = 0; i < fresh.length; i += 200) {
      const chunk = fresh.slice(i, i + 200);
      await prisma.$executeRawUnsafe(
        `INSERT OR IGNORE INTO "RetiredDocNumber" ("number", "kind", "source", "createdAt") VALUES ${chunk.map(() => "(?, ?, ?, ?)").join(", ")}`,
        ...chunk.flatMap((r) => [r.number, r.kind, name, now])
      );
    }
    // Everything retired because of this safety copy, including by an earlier start that was
    // closed before it could record the result (then `fresh` is empty this time).
    // 【中文】因这个安全副本而停用的全部号码（包括上次启动已停用、但没来得及记录结果的）。
    const retired = await prisma.$queryRawUnsafe<Array<{ kind: string; number: string }>>(
      `SELECT "kind", "number" FROM "RetiredDocNumber" WHERE "source" = ? ORDER BY "kind", "number"`,
      name
    );
    return {
      checked: true,
      retired: retired.map((r) => ({ kind: String(r.kind), number: String(r.number) })),
      lostEInvoices: lostEInvoices(safetyDocs, restoredDocs.map((d) => d.uuid)),
    };
  } finally {
    await copy.$disconnect().catch(() => {});
    if (tmpDir) removeTempCopy(tmpDir);
  }
}

/**
 * How long the server start waits for the safety-copy comparison. Most finish in a second or two,
 * and then numbering skips the retired numbers before anyone can log in. A slower one goes on in the
 * background and records its result when it ends; the start is never held up longer than this
 * (the desktop app rolls a restore back when the server is not up within 60 seconds).
 * 【中文】服务器启动最多等安全副本比对这么久（通常一两秒就完成，登录前号码就已停用）。比较慢的在后台继续，完成后再记录结果；
 * 启动不会被拖得更久（服务器 60 秒内没起来，桌面程序会自动撤销还原）。
 */
const RETIRE_WAIT_MS = 10_000;

type RetireOutcome = { retire: RetireResult | null; error: string | null };
type Actor = { id: string; name: string; email: string; role: string };

/** The restore itself: file, folder, safety copy, photos, and what the backup contained. */
function restoreDetails(m: RestoreMarker) {
  return {
    source: m.source ?? null,
    folder: m.folder ?? null,
    safetyCopy: m.safetyCopy ?? null,
    startedAt: m.at ? new Date(m.at).toISOString() : null,
    photosAdded: m.photos ?? 0,
    backupWorkOrders: m.workOrders ?? null,
    backupLatestWorkOrderAt: m.lastWorkOrderAt ?? null,
    error: m.error ?? null,
    emergency: m.emergency === true,
  };
}

/** Result of the comparison with the safety copy, for the audit entry. */
function retireDetails({ retire, error }: RetireOutcome) {
  const lost = retire?.lostEInvoices ?? [];
  return {
    safetyCopyChecked: !!retire?.checked,
    safetyCopyNote: retire?.reason ?? error,
    // Numbers issued before the restore that numbering now skips.
    retiredNumbers: retire?.retired.length ?? 0,
    retiredByKind: retire ? countByKind(retire.retired) : {},
    retiredSample: retire ? retire.retired.slice(0, 30).map((r) => r.number) : [],
    // e-Invoices LHDN has but the restored data no longer shows: re-enter them.
    eInvoicesToReenter: lost.length,
    eInvoicesToReenterReal: lost.filter((d) => d.env !== "sandbox").length,
    // The first ones here; all of them in the RESTORE_EINVOICES_TO_REENTER entries.
    eInvoicesFirst: lost.slice(0, 10).map((d) => ({ kind: d.kind, number: d.number, uuid: d.uuid, env: d.env })),
  };
}

/**
 * The e-Invoice UUIDs themselves, 20 per entry (the details of one entry are limited in size).
 * 【中文】需要重新登记的电子发票 UUID，每条审计记录列 20 个。
 */
async function recordEInvoicesToReenter(actor: Actor, m: RestoreMarker, lost: LostEInvoice[]) {
  for (let i = 0; i < lost.length; i += 20) {
    const part = lost.slice(i, i + 20);
    await writeAuditLog({
      actor,
      action: "RESTORE_EINVOICES_TO_REENTER",
      entityType: "Backup",
      entityId: null,
      summary: `e-Invoices sent to LHDN before the restore that are no longer in the data (${i + 1}-${i + part.length} of ${lost.length}): re-enter them on the documents`,
      details: { safetyCopy: m.safetyCopy ?? null, eInvoices: part },
    });
  }
}

/** Remove the marker: this restore is fully recorded. */
function doneWith(file: string) {
  fs.rmSync(file, { force: true });
}

/**
 * A comparison that finished after the restore entry was written (slow start, or the app was closed
 * before it ended and this is the next start): its own entry, then the UUID list, then the marker
 * goes. Until then the marker stays, so the next start runs the comparison again (it is safe to repeat).
 * 【中文】比对在「还原」记录写入之后才完成（启动较慢，或上次没完成就关了程序）：另写一条结果记录和 UUID 清单，然后才删除标记文件；
 * 在那之前标记文件保留，下次启动会再比对一次（可重复执行）。
 */
async function recordRetireOutcome(actor: Actor, m: RestoreMarker, outcome: RetireOutcome, file: string) {
  const d = retireDetails(outcome);
  const saved = await writeAuditLog({
    actor,
    action: "RESTORE_SAFETY_COPY_CHECKED",
    entityType: "Backup",
    entityId: null,
    summary: outcome.retire?.checked
      ? `Restore check finished: ${d.retiredNumbers} document number(s) from before the restore will not be issued again; ${d.eInvoicesToReenter} e-Invoice(s) to re-enter`
      : `Restore check could not compare with the safety copy: ${String(d.safetyCopyNote || "unknown reason").slice(0, 120)}`,
    details: { source: m.source ?? null, safetyCopy: m.safetyCopy ?? null, ...d },
  });
  if (!saved) return;
  doneWith(file);
  await recordEInvoicesToReenter(actor, m, outcome.retire?.lostEInvoices ?? []);
}

/** Write the marker back with `restoreRecordedAt`, so a later start does not record the restore twice. */
function markRestoreRecorded(file: string, m: RestoreMarker) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify({ ...m, restoreRecordedAt: Date.now() }));
  fs.renameSync(tmp, file);
}

/**
 * The desktop app writes data/restore-audit.json when it restores a backup (electron/backup.js).
 * It is recorded here, in the database that is now live, so the audit trail of the restored
 * data shows that a restore happened, from which file, by whom, and the safety copy's name.
 * After a real restore the document numbers it rolled back are retired and the e-Invoices LHDN
 * already has are listed (retireNumbersFromSafetyCopy). The start waits for that at most
 * RETIRE_WAIT_MS; a slower comparison records its result when it ends, and the marker file is only
 * removed once everything is recorded.
 * 【中文】桌面程序还原备份后留下 restore-audit.json；这里把它写进（现在使用中的）数据库审计日志：何时、谁、从哪个文件还原、安全副本名称。
 * 真正的还原之后，还会停用被还原掉的单据号码、列出 LHDN 已有的电子发票。启动最多等 RETIRE_WAIT_MS；
 * 比较慢的在完成后再记录结果，全部记录完才删除标记文件。
 */
export async function recordRestoreAudit() {
  // A temporary copy left by an earlier start (the app closed during the comparison, or the copy
  // was locked) goes once it is a day old, at any start, not only at the next emergency restore.
  // 【中文】之前启动留下的临时副本（比对途中关掉程序或文件被锁住），超过一天就在任何一次启动时删除，不用等下一次紧急还原。
  removeStaleTempCopies();
  const file = path.join(dataDir(), "restore-audit.json");
  if (!fs.existsSync(file)) return;
  let m: RestoreMarker;
  try {
    m = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    fs.renameSync(file, file + ".bad");
    return;
  }
  const kind = RESTORE_ACTIONS[String(m.status)] || RESTORE_ACTIONS.restored;
  const actor: Actor = {
    id: String(m.actor?.id || ""),
    name: String(m.actor?.name || "Boss (desktop app)"),
    email: "",
    role: String(m.actor?.role || "OWNER"),
  };
  const summary = `${kind.summary}: ${String(m.source || "unknown file").slice(0, 120)}`;

  // A failed or rolled-back restore changed nothing: only the entry itself.
  if (String(m.status || "restored") !== "restored") {
    const saved = await writeAuditLog({ actor, action: kind.action, entityType: "Backup", entityId: null, summary, details: restoreDetails(m) });
    // Keep the file when the write failed, so it is tried again at the next start.
    if (saved) doneWith(file);
    return;
  }

  // A real restore: retire the document numbers it rolled back. Never stops the start, and holds
  // it up at most RETIRE_WAIT_MS.
  const job: Promise<RetireOutcome> = retireNumbersFromSafetyCopy(m.safetyCopy).then(
    (retire) => ({ retire, error: null }),
    (e) => {
      console.error("[restore-audit] could not compare with the safety copy", e);
      return { retire: null, error: String((e as Error)?.message || e).slice(0, 200) };
    }
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const outcome = await Promise.race([
    job,
    new Promise<null>((r) => {
      timer = setTimeout(() => r(null), RETIRE_WAIT_MS);
    }),
  ]);
  clearTimeout(timer);

  if (m.restoreRecordedAt) {
    // The restore entry was written at an earlier start; only the comparison's result is missing.
    if (outcome) await recordRetireOutcome(actor, m, outcome, file);
    else void job.then((o) => recordRetireOutcome(actor, m, o, file)).catch((e) => console.error("[restore-audit]", e));
    return;
  }

  const saved = await writeAuditLog({
    actor,
    action: kind.action,
    entityType: "Backup",
    entityId: null,
    summary,
    details: {
      ...restoreDetails(m),
      ...(outcome
        ? retireDetails(outcome)
        : {
            safetyCopyChecked: false,
            safetyCopyNote: `still comparing after ${RETIRE_WAIT_MS / 1000} s; the result follows in a RESTORE_SAFETY_COPY_CHECKED entry`,
          }),
    },
  });
  // Keep the file when the write failed, so it is tried again at the next start.
  if (!saved) return;
  if (outcome) {
    doneWith(file);
    await recordEInvoicesToReenter(actor, m, outcome.retire?.lostEInvoices ?? []);
    return;
  }
  // Still running: remember that the restore is recorded, and record the result when it ends.
  try {
    markRestoreRecorded(file, m);
  } catch (e) {
    console.error("[restore-audit] could not update the restore marker", e);
  }
  void job.then((o) => recordRetireOutcome(actor, m, o, file)).catch((e) => console.error("[restore-audit]", e));
}
