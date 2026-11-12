import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";

/**
 * The desktop app copies an empty template database on first install and never
 * migrates it afterwards. This brings an existing shop database up to the current
 * schema when the server starts, so updating the app does not break it.
 *
 * Only ever ADDS columns / tables / indexes — never drops or changes data.
 * To add something in future: add it to schema.prisma AND here. For new tables use
 * the exact DDL from:  npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
 */
// 【中文】新版本新增的字段清单。以后给 schema.prisma 加字段，必须同时加到这里，旧店的数据库才会自动升级。
const COLUMNS: Array<{ table: string; column: string; ddl: string }> = [
  // v0.2 — SST
  { table: "ShopProfile", column: "sstRate", ddl: "REAL NOT NULL DEFAULT 0" },
  { table: "ShopProfile", column: "sstScope", ddl: "TEXT NOT NULL DEFAULT 'ALL'" },
  { table: "WorkOrder", column: "taxRate", ddl: "REAL NOT NULL DEFAULT 0" },
  { table: "WorkOrder", column: "taxScope", ddl: "TEXT NOT NULL DEFAULT 'ALL'" },
  { table: "WorkOrder", column: "taxAmount", ddl: "REAL NOT NULL DEFAULT 0" },
  // v0.2 — address for MyInvois, credit notes, consolidation
  { table: "ShopProfile", column: "city", ddl: "TEXT" },
  { table: "ShopProfile", column: "postcode", ddl: "TEXT" },
  { table: "ShopProfile", column: "stateCode", ddl: "TEXT" },
  { table: "WorkOrder", column: "creditedAmount", ddl: "REAL NOT NULL DEFAULT 0" },
  { table: "WorkOrder", column: "consolidatedId", ddl: "TEXT" },
  // v0.2.1 — void supplier invoices / payment vouchers (for shops already on v0.2.0;
  // new tables get these columns from the CREATE TABLE text below)
  { table: "SupplierInvoice", column: "voidedAt", ddl: "DATETIME" },
  { table: "SupplierInvoice", column: "voidReason", ddl: "TEXT" },
  { table: "PaymentVoucher", column: "voidedAt", ddl: "DATETIME" },
  { table: "PaymentVoucher", column: "voidReason", ddl: "TEXT" },
  // cash counter: cash received / change on a payment, and which counter session it belongs to
  { table: "Payment", column: "tendered", ddl: "REAL" },
  { table: "Payment", column: "changeGiven", ddl: "REAL" },
  { table: "Payment", column: "shiftId", ddl: `TEXT REFERENCES "CashShift" ("id") ON DELETE SET NULL ON UPDATE CASCADE` },
  // v0.2.4 — daily settlement: denomination counts, float kept, bank deposit
  { table: "CashShift", column: "openingCount", ddl: "TEXT" },
  { table: "CashShift", column: "countedBreakdown", ddl: "TEXT" },
  { table: "CashShift", column: "floatKept", ddl: "REAL" },
  { table: "CashShift", column: "depositAmount", ddl: "REAL" },
  { table: "CashShift", column: "depositedAt", ddl: "DATETIME" },
  { table: "CashShift", column: "depositedByName", ddl: "TEXT" },
  { table: "CashShift", column: "depositRef", ddl: "TEXT" },
  // v0.2.5 — other payment methods ticked as checked; cash vouchers paid from the drawer
  { table: "CashShift", column: "reconciled", ddl: "TEXT" },
  { table: "PaymentVoucher", column: "shiftId", ddl: `TEXT REFERENCES "CashShift" ("id") ON DELETE SET NULL ON UPDATE CASCADE` },
  // v0.2.9 — buyer e-Invoice details sent through the QR code on the invoice / receipt
  { table: "WorkOrder", column: "eInvoiceToken", ddl: "TEXT" },
  { table: "WorkOrder", column: "buyerRequestedAt", ddl: "DATETIME" },
  { table: "WorkOrder", column: "buyerName", ddl: "TEXT" },
  { table: "WorkOrder", column: "buyerTin", ddl: "TEXT" },
  { table: "WorkOrder", column: "buyerIdType", ddl: "TEXT" },
  { table: "WorkOrder", column: "buyerIdNo", ddl: "TEXT" },
  { table: "WorkOrder", column: "buyerEmail", ddl: "TEXT" },
  { table: "WorkOrder", column: "buyerPhone", ddl: "TEXT" },
  { table: "WorkOrder", column: "buyerAddress", ddl: "TEXT" },
  { table: "WorkOrder", column: "buyerPostcode", ddl: "TEXT" },
  { table: "WorkOrder", column: "buyerCity", ddl: "TEXT" },
  { table: "WorkOrder", column: "buyerStateCode", ddl: "TEXT" },
  // v0.3.3 — keep submission UID so status can be polled again after page refresh
  { table: "WorkOrder", column: "submissionUid", ddl: "TEXT" },
  // v0.3.11 — owner-editable document print templates
  { table: "ShopProfile", column: "documentSettings", ddl: "TEXT" },
];

// 【中文】新版本新增的表（含索引）。
const TABLES: Array<{ table: string; ddl: string[] }> = [
  {
    table: "LoginThrottle",
    ddl: [
      `CREATE TABLE "LoginThrottle" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "windowStartedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" DATETIME,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
      `CREATE INDEX "LoginThrottle_lockedUntil_idx" ON "LoginThrottle"("lockedUntil")`,
    ],
  },
  {
    table: "AuditLog",
    ddl: [
      `CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorUserId" TEXT,
    "actorName" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "summary" TEXT NOT NULL,
    "details" TEXT,
    "ipAddress" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
      `CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt")`,
      `CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId")`,
      `CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt")`,
    ],
  },
  {
    table: "CashShift",
    ddl: [
      `CREATE TABLE "CashShift" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedByName" TEXT NOT NULL,
    "openingFloat" REAL NOT NULL,
    "closedAt" DATETIME,
    "closedByName" TEXT,
    "expectedCash" REAL,
    "countedCash" REAL,
    "variance" REAL,
    "notes" TEXT,
    "openingCount" TEXT,
    "countedBreakdown" TEXT,
    "floatKept" REAL,
    "depositAmount" REAL,
    "depositedAt" DATETIME,
    "depositedByName" TEXT,
    "depositRef" TEXT,
    "reconciled" TEXT
)`,
    ],
  },
  {
    table: "CreditNote",
    ddl: [
      `CREATE TABLE "CreditNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "taxAmount" REAL NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL,
    "refundAmount" REAL NOT NULL DEFAULT 0,
    "refundMethod" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "workOrderId" TEXT NOT NULL,
    "eInvoiceUuid" TEXT,
    "eInvoiceLongId" TEXT,
    "eInvoiceStatus" TEXT,
    "submissionUid" TEXT,
    CONSTRAINT "CreditNote_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
)`,
      `CREATE UNIQUE INDEX "CreditNote_number_key" ON "CreditNote"("number")`,
    ],
  },
  {
    table: "ConsolidatedInvoice",
    ddl: [
      `CREATE TABLE "ConsolidatedInvoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "orderCount" INTEGER NOT NULL,
    "netAmount" REAL NOT NULL,
    "taxAmount" REAL NOT NULL,
    "totalAmount" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eInvoiceUuid" TEXT,
    "eInvoiceLongId" TEXT,
    "eInvoiceStatus" TEXT,
    "submissionUid" TEXT
)`,
      `CREATE UNIQUE INDEX "ConsolidatedInvoice_number_key" ON "ConsolidatedInvoice"("number")`,
      `CREATE UNIQUE INDEX "ConsolidatedInvoice_month_key" ON "ConsolidatedInvoice"("month")`,
    ],
  },
  {
    table: "Supplier",
    ddl: [
      `CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
      `CREATE UNIQUE INDEX "Supplier_name_key" ON "Supplier"("name")`,
    ],
  },
  {
    table: "SupplierInvoice",
    ddl: [
      `CREATE TABLE "SupplierInvoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "internalNo" TEXT NOT NULL,
    "invoiceNo" TEXT NOT NULL,
    "invoiceDate" DATETIME NOT NULL,
    "dueDate" DATETIME,
    "supplierId" TEXT NOT NULL,
    "subtotal" REAL NOT NULL,
    "taxAmount" REAL NOT NULL DEFAULT 0,
    "totalAmount" REAL NOT NULL,
    "paidAmount" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'UNPAID',
    "notes" TEXT,
    "imageUrl" TEXT,
    "voidedAt" DATETIME,
    "voidReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    CONSTRAINT "SupplierInvoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
)`,
      `CREATE UNIQUE INDEX "SupplierInvoice_internalNo_key" ON "SupplierInvoice"("internalNo")`,
      `CREATE UNIQUE INDEX "SupplierInvoice_supplierId_invoiceNo_key" ON "SupplierInvoice"("supplierId", "invoiceNo")`,
    ],
  },
  {
    table: "SupplierInvoiceItem",
    ddl: [
      `CREATE TABLE "SupplierInvoiceItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "description" TEXT NOT NULL,
    "sku" TEXT,
    "category" TEXT,
    "quantity" REAL NOT NULL,
    "unitCost" REAL NOT NULL,
    "total" REAL NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "inventoryItemId" TEXT,
    CONSTRAINT "SupplierInvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SupplierInvoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SupplierInvoiceItem_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
)`,
    ],
  },
  {
    table: "PaymentVoucher",
    ddl: [
      `CREATE TABLE "PaymentVoucher" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" TEXT NOT NULL,
    "payee" TEXT NOT NULL,
    "purpose" TEXT,
    "amount" REAL NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'CASH',
    "reference" TEXT,
    "notes" TEXT,
    "paidAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "supplierInvoiceId" TEXT,
    "voidedAt" DATETIME,
    "voidReason" TEXT,
    "shiftId" TEXT,
    CONSTRAINT "PaymentVoucher_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "CashShift" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PaymentVoucher_supplierInvoiceId_fkey" FOREIGN KEY ("supplierInvoiceId") REFERENCES "SupplierInvoice" ("id") ON DELETE SET NULL ON UPDATE CASCADE
)`,
      `CREATE UNIQUE INDEX "PaymentVoucher_number_key" ON "PaymentVoucher"("number")`,
    ],
  },
];

let done: Promise<void> | null = null;

function dataDir() {
  return process.env.WORKSHOP_DATA_DIR || path.join(process.cwd(), "data");
}

/** Written when an upgrade fails so the desktop app can warn the user. Removed on success. */
function statusFile() {
  return path.join(dataDir(), "upgrade-error.txt");
}

// 【中文】启动时自动升级旧数据库：①先找出缺什么 ②先备份 ③在一个事务里一次改完（全成功或全不改）。只增不删，不会动已有数据。
export function ensureSchema() {
  if (!done) {
    done = (async () => {
      const existing = new Set(
        (await prisma.$queryRawUnsafe<Array<{ name: string }>>(
          `SELECT name FROM sqlite_master WHERE type = 'table'`
        )).map((r) => r.name)
      );
      // A brand-new empty file (no tables yet) is set up elsewhere; don't touch it.
      if (!existing.has("WorkOrder")) return;

      // 1) Work out what is missing (read-only).
      const sql: string[] = [];
      const names: string[] = [];
      for (const t of TABLES) {
        if (existing.has(t.table)) continue;
        sql.push(...t.ddl);
        names.push(`table ${t.table}`);
      }
      const cache = new Map<string, Set<string>>();
      for (const c of COLUMNS) {
        if (!cache.has(c.table)) {
          const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("${c.table}")`);
          cache.set(c.table, new Set(rows.map((r) => r.name)));
        }
        const cols = cache.get(c.table)!;
        if (cols.size > 0 && !cols.has(c.column)) {
          sql.push(`ALTER TABLE "${c.table}" ADD COLUMN "${c.column}" ${c.ddl}`);
          names.push(`${c.table}.${c.column}`);
        }
      }
      // v0.2.9 — the QR token must be unique (ALTER TABLE cannot add UNIQUE, so use an index).
      const woCols = cache.get("WorkOrder");
      const tokenIdx = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'WorkOrder_eInvoiceToken_key'`
      );
      if (tokenIdx.length === 0 && woCols) {
        sql.push(`CREATE UNIQUE INDEX "WorkOrder_eInvoiceToken_key" ON "WorkOrder"("eInvoiceToken")`);
        names.push("index WorkOrder_eInvoiceToken_key");
      }
      if (sql.length === 0) {
        try { fs.rmSync(statusFile(), { force: true }); } catch {}
        return;
      }

      // 2) Safety copy first. If it cannot be made, do NOT touch the database.
      const dir = path.join(dataDir(), "backups", "pre-upgrade");
      fs.mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const file = path.join(dir, `workshop-before-upgrade-${stamp}.db`);
      await prisma.$executeRawUnsafe(`VACUUM INTO '${file.replace(/'/g, "''")}'`);

      // 3) Apply everything in one transaction: all or nothing.
      await prisma.$transaction(sql.map((q) => prisma.$executeRawUnsafe(q)));
      console.log(`[schema-upgrade] applied: ${names.join(", ")} (backup: ${file})`);
      try { fs.rmSync(statusFile(), { force: true }); } catch {}
    })().catch((e) => {
      done = null; // retry next time
      console.error("[schema-upgrade] failed", e);
      try {
        fs.mkdirSync(dataDir(), { recursive: true });
        fs.writeFileSync(statusFile(), `${new Date().toISOString()}\n${String(e?.stack || e)}\n`);
      } catch {}
      throw e;
    });
  }
  return done;
}
