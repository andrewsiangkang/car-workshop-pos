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
];

const TABLES: Array<{ table: string; ddl: string[] }> = [
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
];

let done: Promise<void> | null = null;

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

      for (const t of TABLES) {
        if (existing.has(t.table)) continue;
        await prisma.$transaction(t.ddl.map((sql) => prisma.$executeRawUnsafe(sql)));
        console.log(`[schema-upgrade] created table ${t.table}`);
      }

      const cache = new Map<string, Set<string>>();
      for (const c of COLUMNS) {
        if (!cache.has(c.table)) {
          const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("${c.table}")`);
          cache.set(c.table, new Set(rows.map((r) => r.name)));
        }
        const cols = cache.get(c.table)!;
        if (cols.size > 0 && !cols.has(c.column)) {
          await prisma.$executeRawUnsafe(`ALTER TABLE "${c.table}" ADD COLUMN "${c.column}" ${c.ddl}`);
          cols.add(c.column);
          console.log(`[schema-upgrade] added ${c.table}.${c.column}`);
        }
      }
    })().catch((e) => {
      done = null; // retry next time
      console.error("[schema-upgrade] failed", e);
      throw e;
    });
  }
  return done;
}
