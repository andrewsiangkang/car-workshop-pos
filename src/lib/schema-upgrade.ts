import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { backfillEnvSql, clearStaleSubmissionSql } from "@/lib/einvoice-env-backfill.mjs";

/**
 * The desktop app copies an empty template database on first install and never
 * migrates it afterwards. This brings an existing shop database up to the current
 * schema when the server starts, so updating the app does not break it.
 *
 * Only ever ADDS columns / tables / indexes — never drops or changes data.
 * To add something in future: add it to schema.prisma AND here. For new tables use
 * the exact DDL from:  npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
 * tests/ops-schema-upgrade.test.mjs fails when schema.prisma has a column, table or index this
 * file would not create on an old database (tests/fixtures/ops-schema-base.sql), or when running
 * the upgrade twice changes anything.
 */
// 【中文】新版本新增的字段清单。以后给 schema.prisma 加字段，必须同时加到这里，旧店的数据库才会自动升级。
const COLUMNS: Array<{ table: string; column: string; ddl: string; after?: string[] }> = [
  // v0.5.4 — statutory payroll profile, calculation review, Zakat and tax-relief snapshots.
  { table: "PayrollEntry", column: "epfEmployee", ddl: "REAL NOT NULL DEFAULT 0" },
  { table: "PayrollEntry", column: "socsoEmployee", ddl: "REAL NOT NULL DEFAULT 0" },
  { table: "PayrollEntry", column: "eisEmployee", ddl: "REAL NOT NULL DEFAULT 0" },
  { table: "PayrollEntry", column: "pcb", ddl: "REAL NOT NULL DEFAULT 0" },
  { table: "PayrollEntry", column: "zakat", ddl: "REAL NOT NULL DEFAULT 0" },
  { table: "PayrollEntry", column: "taxRelief", ddl: "REAL NOT NULL DEFAULT 0" },
  { table: "PayrollEntry", column: "epfEmployer", ddl: "REAL NOT NULL DEFAULT 0" },
  { table: "PayrollEntry", column: "socsoEmployer", ddl: "REAL NOT NULL DEFAULT 0" },
  { table: "PayrollEntry", column: "eisEmployer", ddl: "REAL NOT NULL DEFAULT 0" },
  { table: "PayrollEntry", column: "statutoryStatus", ddl: "TEXT NOT NULL DEFAULT 'MANUAL_REVIEW'" },
  { table: "PayrollEntry", column: "statutoryReviewed", ddl: "BOOLEAN NOT NULL DEFAULT false" },
  { table: "PayrollEntry", column: "statutoryDetails", ddl: "TEXT" },
  { table: "PayrollCommissionRule", column: "statutoryProfileComplete", ddl: "BOOLEAN NOT NULL DEFAULT false" },
  { table: "PayrollCommissionRule", column: "epfCategory", ddl: "TEXT NOT NULL DEFAULT 'MALAYSIAN_UNDER_60'" },
  { table: "PayrollCommissionRule", column: "socsoCategory", ddl: "TEXT NOT NULL DEFAULT 'FIRST'" },
  { table: "PayrollCommissionRule", column: "socsoSkbbk", ddl: "TEXT NOT NULL DEFAULT 'OFF'" },
  { table: "PayrollCommissionRule", column: "eisEligible", ddl: "BOOLEAN NOT NULL DEFAULT true" },
  { table: "PayrollCommissionRule", column: "taxResidency", ddl: "TEXT NOT NULL DEFAULT 'RESIDENT'" },
  { table: "PayrollCommissionRule", column: "taxCategory", ddl: "TEXT NOT NULL DEFAULT 'SINGLE'" },
  { table: "PayrollCommissionRule", column: "qualifyingChildren", ddl: "INTEGER NOT NULL DEFAULT 0" },
  { table: "PayrollCommissionRule", column: "disabledSelf", ddl: "BOOLEAN NOT NULL DEFAULT false" },
  { table: "PayrollCommissionRule", column: "disabledSpouse", ddl: "BOOLEAN NOT NULL DEFAULT false" },
  { table: "PayrollCommissionRule", column: "priorGrossYtd", ddl: "REAL NOT NULL DEFAULT 0" },
  { table: "PayrollCommissionRule", column: "priorEpfYtd", ddl: "REAL NOT NULL DEFAULT 0" },
  { table: "PayrollCommissionRule", column: "priorPcbYtd", ddl: "REAL NOT NULL DEFAULT 0" },
  { table: "PayrollCommissionRule", column: "priorZakatYtd", ddl: "REAL NOT NULL DEFAULT 0" },
  { table: "PayrollCommissionRule", column: "priorSocsoYtd", ddl: "REAL NOT NULL DEFAULT 0" },
  { table: "PayrollCommissionRule", column: "taxReliefYtd", ddl: "REAL NOT NULL DEFAULT 0" },
  { table: "PayrollCommissionRule", column: "taxReliefMonthly", ddl: "REAL NOT NULL DEFAULT 0" },
  { table: "PayrollCommissionRule", column: "zakatMonthly", ddl: "REAL NOT NULL DEFAULT 0" },
  // v0.4.0 — workshop scheduling metadata; defaults preserve all existing jobs.
  { table: "WorkOrder", column: "priority", ddl: "TEXT NOT NULL DEFAULT 'NORMAL'" },
  // Legacy work orders are deliberately marked LEGACY; new work orders use WAITING.
  { table: "WorkOrder", column: "workflowStage", ddl: "TEXT NOT NULL DEFAULT 'LEGACY'" },
  { table: "WorkOrder", column: "estimatedCompletionAt", ddl: "DATETIME" },
  { table: "WorkOrder", column: "startedAt", ddl: "DATETIME" },
  // v0.3.30 — customer address (printed / sent to LHDN), WhatsApp reminder consent, opt-out and
  // language, PDPA anonymisation
  { table: "Customer", column: "address", ddl: "TEXT" },
  { table: "Customer", column: "postcode", ddl: "TEXT" },
  { table: "Customer", column: "city", ddl: "TEXT" },
  { table: "Customer", column: "stateCode", ddl: "TEXT" },
  { table: "Customer", column: "reminderConsentAt", ddl: "DATETIME" },
  { table: "Customer", column: "reminderOptOutAt", ddl: "DATETIME" },
  { table: "Customer", column: "language", ddl: "TEXT" },
  { table: "Customer", column: "anonymisedAt", ddl: "DATETIME" },
  // v0.3.30 — an LHDN submission in flight (stops a double click / second device sending twice)
  { table: "WorkOrder", column: "eInvoiceSubmittingAt", ddl: "DATETIME" },
  { table: "CreditNote", column: "eInvoiceSubmittingAt", ddl: "DATETIME" },
  { table: "ConsolidatedInvoice", column: "eInvoiceSubmittingAt", ddl: "DATETIME" },
  // v0.3.30 — LHDN document type of a credit note: "02" credit note, "04" refund note
  { table: "CreditNote", column: "eInvoiceType", ddl: "TEXT" },
  // v0.3.30 — closed counter day keeps its totals; expenses can be recorded and voided
  { table: "CashShift", column: "closingSnapshot", ddl: "TEXT" },
  { table: "Expense", column: "createdById", ddl: "TEXT" },
  { table: "Expense", column: "voidedAt", ddl: "DATETIME" },
  { table: "Expense", column: "voidReason", ddl: "TEXT" },
  // v0.3.30 — PDPA retention schedule (years without a visit before a customer is anonymised)
  { table: "ShopProfile", column: "customerRetentionYears", ddl: "INTEGER" },
  // v0.3.30 — inventory items are archived instead of deleted (stock history kept)
  { table: "InventoryItem", column: "archivedAt", ddl: "DATETIME" },
  // v0.3.30 — supplier invoice void puts back the prices the invoice overwrote
  { table: "SupplierInvoiceItem", column: "prevCostPrice", ddl: "REAL" },
  { table: "SupplierInvoiceItem", column: "prevSellingPrice", ddl: "REAL" },
  // v0.3.30 — audit trail hash chain (tamper evidence)
  { table: "AuditLog", column: "seq", ddl: "INTEGER" },
  { table: "AuditLog", column: "prevHash", ddl: "TEXT" },
  { table: "AuditLog", column: "hash", ddl: "TEXT" },

  // v0.3.29 — which LHDN environment an e-Invoice result came from. `after` fills it in
  // once for records that already have a UUID (same transaction as the ADD COLUMN):
  // - the audit log says which environment the app submitted to, when it recorded it
  //   (only an audit row for the UUID the record holds NOW counts);
  // - otherwise a UUID typed in by hand (EINVOICE_REFERENCE_UPDATED) is a real portal
  //   e-Invoice, even if an older sandbox submission id is still on the record;
  // - otherwise a record with a submission id came from this app's API submission, which
  //   has been sandbox-only since production submission was locked (v0.3.12);
  // - otherwise the UUID was typed in by hand from the MyInvois portal: a real e-Invoice.
  // 【中文】只认“提交审计里的 UUID = 现在记录上的 UUID”；先沙盒测试、后手动填入真实 UUID 的发票算正式（production），并清掉旧的沙盒提交号。
  {
    table: "WorkOrder", column: "eInvoiceEnv", ddl: "TEXT",
    after: [
      backfillEnvSql("WorkOrder", "MYINVOIS_INVOICE_SUBMITTED"),
      clearStaleSubmissionSql("WorkOrder", "MYINVOIS_INVOICE_SUBMITTED"),
    ],
  },
  {
    table: "CreditNote", column: "eInvoiceEnv", ddl: "TEXT",
    after: [backfillEnvSql("CreditNote", "MYINVOIS_CREDIT_NOTE_SUBMITTED")],
  },
  {
    table: "ConsolidatedInvoice", column: "eInvoiceEnv", ddl: "TEXT",
    after: [backfillEnvSql("ConsolidatedInvoice", "MYINVOIS_CONSOLIDATED_SUBMITTED")],
  },

  // v0.3.29 — seller / buyer / vehicle particulars frozen on issued invoices and credit notes.
  // No backfill on purpose: today's Settings / customer data is not what was printed then, so
  // older records keep printing from live data (as before) instead of claiming a false snapshot.
  { table: "WorkOrder", column: "docSnapshot", ddl: "TEXT" },
  { table: "CreditNote", column: "docSnapshot", ddl: "TEXT" },

  // v0.3.29 — boss can switch off a staff account (ex-staff) without deleting it
  { table: "User", column: "disabledAt", ddl: "DATETIME" },

  // v0.3.20 — cash-only settlement rounding
  { table: "WorkOrder", column: "roundingAdjustment", ddl: "REAL NOT NULL DEFAULT 0" },

  // v0.3.18 — international profile defaults (additive; existing shops remain Malaysia/MYR)
  { table: "ShopProfile", column: "countryCode", ddl: "TEXT NOT NULL DEFAULT 'MY'" },
  { table: "ShopProfile", column: "currencyCode", ddl: "TEXT NOT NULL DEFAULT 'MYR'" },
  { table: "ShopProfile", column: "locale", ddl: "TEXT NOT NULL DEFAULT 'en-MY'" },
  { table: "ShopProfile", column: "timeZone", ddl: "TEXT NOT NULL DEFAULT 'Asia/Kuala_Lumpur'" },
  { table: "ShopProfile", column: "taxLabel", ddl: "TEXT NOT NULL DEFAULT 'SST'" },

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
  // v0.3.29 — PDPA consent from the QR form (time + notice version)
  { table: "WorkOrder", column: "buyerConsentAt", ddl: "DATETIME" },
  { table: "WorkOrder", column: "buyerConsentNotice", ddl: "TEXT" },
  // v0.3.3 — keep submission UID so status can be polled again after page refresh
  { table: "WorkOrder", column: "submissionUid", ddl: "TEXT" },
  // v0.3.11 — owner-editable document print templates
  { table: "ShopProfile", column: "documentSettings", ddl: "TEXT" },
  // v0.3.16 — customer service reminders (safe additive upgrade)
  { table: "Vehicle", column: "lastServiceDate", ddl: "DATETIME" },
  { table: "Vehicle", column: "lastServiceMileage", ddl: "INTEGER" },
  { table: "Vehicle", column: "nextServiceDate", ddl: "DATETIME" },
  { table: "Vehicle", column: "nextServiceMileage", ddl: "INTEGER" },
  { table: "Vehicle", column: "serviceIntervalKm", ddl: "INTEGER NOT NULL DEFAULT 5000" },
  { table: "Vehicle", column: "serviceIntervalMonths", ddl: "INTEGER NOT NULL DEFAULT 6" },
];

// 【中文】已有表上新增的普通索引（在同一个事务里、加完字段之后建立）。
const INDEXES: Array<{ name: string; table: string; ddl: string }> = [
  { name: "AuditLog_seq_idx", table: "AuditLog", ddl: `CREATE INDEX "AuditLog_seq_idx" ON "AuditLog"("seq")` },
  // v0.3.30 — a customer's jobs and a job's credit notes are looked up without scanning the whole
  // table (the privacy clean-up at every start reads them per customer).
  // 【中文】按客户查工单、按工单查退款单时不用扫描整张表（每次启动的隐私清理会按客户读取）。
  { name: "WorkOrder_customerId_idx", table: "WorkOrder", ddl: `CREATE INDEX "WorkOrder_customerId_idx" ON "WorkOrder"("customerId")` },
  { name: "WorkOrder_status_estimatedCompletionAt_idx", table: "WorkOrder", ddl: `CREATE INDEX "WorkOrder_status_estimatedCompletionAt_idx" ON "WorkOrder"("status", "estimatedCompletionAt")` },
  { name: "CreditNote_workOrderId_idx", table: "CreditNote", ddl: `CREATE INDEX "CreditNote_workOrderId_idx" ON "CreditNote"("workOrderId")` },
];

/**
 * v0.3.30 — document numbers must be unique. ALTER TABLE cannot add UNIQUE and an old shop
 * database might already hold a duplicate number, so each unique index is created on its own
 * AFTER the main upgrade, only when no duplicate exists. A duplicate is logged and written to
 * the status file instead of failing the whole upgrade; the app keeps working as before.
 */
// 【中文】单号唯一索引：单独建立；旧数据里已有重复单号时跳过并记录，不影响整个升级。
const UNIQUE_INDEXES: Array<{ name: string; table: string; column: string }> = [
  { name: "WorkOrder_quotationNumber_key", table: "WorkOrder", column: "quotationNumber" },
  { name: "WorkOrder_invoiceNumber_key", table: "WorkOrder", column: "invoiceNumber" },
  { name: "WorkOrder_receiptNumber_key", table: "WorkOrder", column: "receiptNumber" },
];

/** The database the upgrade runs on: the app's Prisma client (tests pass their own). */
type Db = Pick<typeof prisma, "$queryRawUnsafe" | "$executeRawUnsafe" | "$transaction">;

async function ensureUniqueIndexes(db: Db): Promise<string[]> {
  const problems: string[] = [];
  for (const u of UNIQUE_INDEXES) {
    const has = await db.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND name = '${u.name}'`
    );
    if (has.length) continue;
    const dup = await db.$queryRawUnsafe<Array<{ v: string }>>(
      `SELECT "${u.column}" AS v FROM "${u.table}" WHERE "${u.column}" IS NOT NULL GROUP BY "${u.column}" HAVING COUNT(*) > 1 LIMIT 3`
    );
    if (dup.length) {
      problems.push(`${u.table}.${u.column} has duplicate numbers (${dup.map((d) => d.v).join(", ")}); unique index not created`);
      continue;
    }
    await db.$executeRawUnsafe(`CREATE UNIQUE INDEX "${u.name}" ON "${u.table}"("${u.column}")`);
    console.log(`[schema-upgrade] applied: index ${u.name}`);
  }
  return problems;
}

// 【中文】新版本新增的表（含索引）。
const TABLES: Array<{ table: string; ddl: string[] }> = [
  // v0.4.0 — append-only status timeline. Existing work orders are not backfilled with invented events.
  {
    table: "WorkOrderHistory",
    ddl: [
      `CREATE TABLE "WorkOrderHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workOrderId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "note" TEXT,
    "actorUserId" TEXT,
    "actorName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkOrderHistory_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)`,
      `CREATE INDEX "WorkOrderHistory_workOrderId_createdAt_idx" ON "WorkOrderHistory"("workOrderId", "createdAt")`,
    ],
  },
  // v0.5.1 — boss-controlled commission payroll. New tables only; existing POS records are untouched.
  { table: "PayrollCommissionRule", ddl: [
    `CREATE TABLE "PayrollCommissionRule" ("id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "basis" TEXT NOT NULL DEFAULT 'LABOR', "commissionRate" REAL NOT NULL DEFAULT 0, "basicSalary" REAL NOT NULL DEFAULT 0, "isActive" BOOLEAN NOT NULL DEFAULT false, "updatedAt" DATETIME NOT NULL, CONSTRAINT "PayrollCommissionRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE)`,
    `CREATE UNIQUE INDEX "PayrollCommissionRule_userId_key" ON "PayrollCommissionRule"("userId")`
  ] },
  { table: "PayrollRun", ddl: [
    `CREATE TABLE "PayrollRun" ("id" TEXT NOT NULL PRIMARY KEY, "periodKey" TEXT NOT NULL, "startAt" DATETIME NOT NULL, "endAt" DATETIME NOT NULL, "status" TEXT NOT NULL DEFAULT 'DRAFT', "totalAmount" REAL NOT NULL DEFAULT 0, "approvedAt" DATETIME, "paidAt" DATETIME, "notes" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL)`,
    `CREATE UNIQUE INDEX "PayrollRun_periodKey_key" ON "PayrollRun"("periodKey")`
  ] },
  { table: "PayrollEntry", ddl: [
    `CREATE TABLE "PayrollEntry" ("id" TEXT NOT NULL PRIMARY KEY, "payrollRunId" TEXT NOT NULL, "userId" TEXT NOT NULL, "workOrderId" TEXT, "employeeName" TEXT NOT NULL, "basis" TEXT NOT NULL, "basisAmount" REAL NOT NULL DEFAULT 0, "commissionRate" REAL NOT NULL DEFAULT 0, "commissionAmount" REAL NOT NULL DEFAULT 0, "basicSalary" REAL NOT NULL DEFAULT 0, "allowance" REAL NOT NULL DEFAULT 0, "deduction" REAL NOT NULL DEFAULT 0, "epfEmployee" REAL NOT NULL DEFAULT 0, "socsoEmployee" REAL NOT NULL DEFAULT 0, "eisEmployee" REAL NOT NULL DEFAULT 0, "pcb" REAL NOT NULL DEFAULT 0, "epfEmployer" REAL NOT NULL DEFAULT 0, "socsoEmployer" REAL NOT NULL DEFAULT 0, "eisEmployer" REAL NOT NULL DEFAULT 0, "totalAmount" REAL NOT NULL DEFAULT 0, "notes" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "PayrollEntry_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE, CONSTRAINT "PayrollEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE, CONSTRAINT "PayrollEntry_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE)`,
    `CREATE UNIQUE INDEX "PayrollEntry_workOrderId_key" ON "PayrollEntry"("workOrderId")`,
    `CREATE INDEX "PayrollEntry_payrollRunId_userId_idx" ON "PayrollEntry"("payrollRunId", "userId")`
  ] },
  // v0.5.0 — additive professional workshop operations schema. Existing POS tables are untouched.
  { table: "WorkOrderStageHistory", ddl: [`CREATE TABLE "WorkOrderStageHistory" ("id" TEXT NOT NULL PRIMARY KEY, "workOrderId" TEXT NOT NULL, "fromStage" TEXT, "toStage" TEXT NOT NULL, "note" TEXT, "actorUserId" TEXT, "actorName" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "WorkOrderStageHistory_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE)`, `CREATE INDEX "WorkOrderStageHistory_workOrderId_createdAt_idx" ON "WorkOrderStageHistory"("workOrderId", "createdAt")`] },
  {
    table: "ServiceBay",
    ddl: [`CREATE TABLE "ServiceBay" ("id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "bayType" TEXT NOT NULL DEFAULT 'GENERAL', "isActive" BOOLEAN NOT NULL DEFAULT true, "notes" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL)` , `CREATE UNIQUE INDEX "ServiceBay_name_key" ON "ServiceBay"("name")`],
  },
  {
    table: "Appointment",
    ddl: [`CREATE TABLE "Appointment" ("id" TEXT NOT NULL PRIMARY KEY, "appointmentNo" TEXT NOT NULL, "customerId" TEXT NOT NULL, "vehicleId" TEXT NOT NULL, "startAt" DATETIME NOT NULL, "endAt" DATETIME NOT NULL, "status" TEXT NOT NULL DEFAULT 'BOOKED', "serviceType" TEXT, "notes" TEXT, "source" TEXT NOT NULL DEFAULT 'WALK_IN', "assignedTechnicianId" TEXT, "serviceBayId" TEXT, "workOrderId" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, CONSTRAINT "Appointment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE, CONSTRAINT "Appointment_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE, CONSTRAINT "Appointment_assignedTechnicianId_fkey" FOREIGN KEY ("assignedTechnicianId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE, CONSTRAINT "Appointment_serviceBayId_fkey" FOREIGN KEY ("serviceBayId") REFERENCES "ServiceBay"("id") ON DELETE SET NULL ON UPDATE CASCADE, CONSTRAINT "Appointment_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE)`, `CREATE UNIQUE INDEX "Appointment_appointmentNo_key" ON "Appointment"("appointmentNo")`, `CREATE UNIQUE INDEX "Appointment_workOrderId_key" ON "Appointment"("workOrderId")`, `CREATE INDEX "Appointment_startAt_endAt_idx" ON "Appointment"("startAt", "endAt")`, `CREATE INDEX "Appointment_status_startAt_idx" ON "Appointment"("status", "startAt")`, `CREATE INDEX "Appointment_customerId_startAt_idx" ON "Appointment"("customerId", "startAt")`, `CREATE INDEX "Appointment_assignedTechnicianId_startAt_idx" ON "Appointment"("assignedTechnicianId", "startAt")`, `CREATE INDEX "Appointment_serviceBayId_startAt_idx" ON "Appointment"("serviceBayId", "startAt")`],
  },
  {
    table: "VehicleCheckIn",
    ddl: [`CREATE TABLE "VehicleCheckIn" ("id" TEXT NOT NULL PRIMARY KEY, "checkInNo" TEXT NOT NULL, "customerId" TEXT NOT NULL, "vehicleId" TEXT NOT NULL, "workOrderId" TEXT, "mileageIn" INTEGER, "fuelLevel" TEXT, "exteriorNotes" TEXT, "belongings" TEXT, "keyCount" INTEGER NOT NULL DEFAULT 1, "checkedInAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "checkedInById" TEXT, "customerSignaturePath" TEXT, "reportPath" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "VehicleCheckIn_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE, CONSTRAINT "VehicleCheckIn_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE, CONSTRAINT "VehicleCheckIn_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE)`, `CREATE UNIQUE INDEX "VehicleCheckIn_checkInNo_key" ON "VehicleCheckIn"("checkInNo")`, `CREATE INDEX "VehicleCheckIn_vehicleId_checkedInAt_idx" ON "VehicleCheckIn"("vehicleId", "checkedInAt")`, `CREATE INDEX "VehicleCheckIn_workOrderId_idx" ON "VehicleCheckIn"("workOrderId")`],
  },
  { table: "CheckInPhoto", ddl: [`CREATE TABLE "CheckInPhoto" ("id" TEXT NOT NULL PRIMARY KEY, "checkInId" TEXT NOT NULL, "filePath" TEXT NOT NULL, "sha256" TEXT, "caption" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "CheckInPhoto_checkInId_fkey" FOREIGN KEY ("checkInId") REFERENCES "VehicleCheckIn"("id") ON DELETE CASCADE ON UPDATE CASCADE)`, `CREATE INDEX "CheckInPhoto_checkInId_idx" ON "CheckInPhoto"("checkInId")`] },
  { table: "InspectionTemplate", ddl: [`CREATE TABLE "InspectionTemplate" ("id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "vehicleType" TEXT NOT NULL DEFAULT 'GENERAL', "isActive" BOOLEAN NOT NULL DEFAULT true, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL)`, `CREATE UNIQUE INDEX "InspectionTemplate_name_key" ON "InspectionTemplate"("name")`] },
  { table: "InspectionTemplateItem", ddl: [`CREATE TABLE "InspectionTemplateItem" ("id" TEXT NOT NULL PRIMARY KEY, "templateId" TEXT NOT NULL, "category" TEXT NOT NULL, "label" TEXT NOT NULL, "sortOrder" INTEGER NOT NULL DEFAULT 0, "isRequired" BOOLEAN NOT NULL DEFAULT false, CONSTRAINT "InspectionTemplateItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "InspectionTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE)`, `CREATE INDEX "InspectionTemplateItem_templateId_sortOrder_idx" ON "InspectionTemplateItem"("templateId", "sortOrder")`] },
  { table: "VehicleInspection", ddl: [`CREATE TABLE "VehicleInspection" ("id" TEXT NOT NULL PRIMARY KEY, "inspectionNo" TEXT NOT NULL, "workOrderId" TEXT NOT NULL, "templateId" TEXT, "status" TEXT NOT NULL DEFAULT 'DRAFT', "inspectedById" TEXT, "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "completedAt" DATETIME, "summary" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, CONSTRAINT "VehicleInspection_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE, CONSTRAINT "VehicleInspection_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "InspectionTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE)`, `CREATE UNIQUE INDEX "VehicleInspection_inspectionNo_key" ON "VehicleInspection"("inspectionNo")`, `CREATE INDEX "VehicleInspection_workOrderId_createdAt_idx" ON "VehicleInspection"("workOrderId", "createdAt")`] },
  { table: "InspectionFinding", ddl: [`CREATE TABLE "InspectionFinding" ("id" TEXT NOT NULL PRIMARY KEY, "inspectionId" TEXT NOT NULL, "category" TEXT NOT NULL, "itemLabel" TEXT NOT NULL, "result" TEXT NOT NULL DEFAULT 'NOT_CHECKED', "severity" TEXT NOT NULL DEFAULT 'INFO', "recommendation" TEXT, "technicianNote" TEXT, "customerVisible" BOOLEAN NOT NULL DEFAULT true, "sortOrder" INTEGER NOT NULL DEFAULT 0, CONSTRAINT "InspectionFinding_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "VehicleInspection"("id") ON DELETE CASCADE ON UPDATE CASCADE)`, `CREATE INDEX "InspectionFinding_inspectionId_sortOrder_idx" ON "InspectionFinding"("inspectionId", "sortOrder")`] },
  { table: "InspectionPhoto", ddl: [`CREATE TABLE "InspectionPhoto" ("id" TEXT NOT NULL PRIMARY KEY, "findingId" TEXT NOT NULL, "filePath" TEXT NOT NULL, "sha256" TEXT, "caption" TEXT, "photoStage" TEXT NOT NULL DEFAULT 'DURING', "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "InspectionPhoto_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "InspectionFinding"("id") ON DELETE CASCADE ON UPDATE CASCADE)`, `CREATE INDEX "InspectionPhoto_findingId_idx" ON "InspectionPhoto"("findingId")`] },
  { table: "CustomerApproval", ddl: [`CREATE TABLE "CustomerApproval" ("id" TEXT NOT NULL PRIMARY KEY, "workOrderId" TEXT NOT NULL, "revision" INTEGER NOT NULL, "approvalStatus" TEXT NOT NULL DEFAULT 'PENDING', "approvalMethod" TEXT NOT NULL DEFAULT 'IN_PERSON', "customerName" TEXT, "approvedAt" DATETIME, "expiresAt" DATETIME, "tokenHash" TEXT, "signaturePath" TEXT, "snapshotJson" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "CustomerApproval_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE)`, `CREATE UNIQUE INDEX "CustomerApproval_workOrderId_revision_key" ON "CustomerApproval"("workOrderId", "revision")`, `CREATE INDEX "CustomerApproval_workOrderId_createdAt_idx" ON "CustomerApproval"("workOrderId", "createdAt")`, `CREATE INDEX "CustomerApproval_approvalStatus_expiresAt_idx" ON "CustomerApproval"("approvalStatus", "expiresAt")`] },
  { table: "ApprovalLine", ddl: [`CREATE TABLE "ApprovalLine" ("id" TEXT NOT NULL PRIMARY KEY, "approvalId" TEXT NOT NULL, "workOrderItemId" TEXT, "description" TEXT NOT NULL, "quantity" REAL NOT NULL, "unitPrice" REAL NOT NULL, "total" REAL NOT NULL, "decision" TEXT NOT NULL DEFAULT 'PENDING', "decidedAt" DATETIME, CONSTRAINT "ApprovalLine_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "CustomerApproval"("id") ON DELETE CASCADE ON UPDATE CASCADE)`, `CREATE INDEX "ApprovalLine_approvalId_idx" ON "ApprovalLine"("approvalId")`] },
  { table: "TechnicianTimeLog", ddl: [`CREATE TABLE "TechnicianTimeLog" ("id" TEXT NOT NULL PRIMARY KEY, "workOrderId" TEXT NOT NULL, "technicianId" TEXT NOT NULL, "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "endedAt" DATETIME, "pausedAt" DATETIME, "durationSeconds" INTEGER NOT NULL DEFAULT 0, "status" TEXT NOT NULL DEFAULT 'RUNNING', "note" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, CONSTRAINT "TechnicianTimeLog_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE, CONSTRAINT "TechnicianTimeLog_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE)`, `CREATE INDEX "TechnicianTimeLog_workOrderId_startedAt_idx" ON "TechnicianTimeLog"("workOrderId", "startedAt")`, `CREATE INDEX "TechnicianTimeLog_technicianId_status_idx" ON "TechnicianTimeLog"("technicianId", "status")`] },
  { table: "PartReservation", ddl: [`CREATE TABLE "PartReservation" ("id" TEXT NOT NULL PRIMARY KEY, "workOrderId" TEXT NOT NULL, "inventoryItemId" TEXT NOT NULL, "quantity" REAL NOT NULL, "status" TEXT NOT NULL DEFAULT 'RESERVED', "reservedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "reservedById" TEXT, "notes" TEXT, CONSTRAINT "PartReservation_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE, CONSTRAINT "PartReservation_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE)`, `CREATE INDEX "PartReservation_workOrderId_status_idx" ON "PartReservation"("workOrderId", "status")`, `CREATE INDEX "PartReservation_inventoryItemId_status_idx" ON "PartReservation"("inventoryItemId", "status")`] },
  { table: "PartIssue", ddl: [`CREATE TABLE "PartIssue" ("id" TEXT NOT NULL PRIMARY KEY, "reservationId" TEXT, "workOrderId" TEXT NOT NULL, "inventoryItemId" TEXT NOT NULL, "quantity" REAL NOT NULL, "movementType" TEXT NOT NULL DEFAULT 'ISSUE', "idempotencyKey" TEXT, "createdById" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "notes" TEXT, CONSTRAINT "PartIssue_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "PartReservation"("id") ON DELETE SET NULL ON UPDATE CASCADE, CONSTRAINT "PartIssue_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE, CONSTRAINT "PartIssue_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE)`, `CREATE UNIQUE INDEX "PartIssue_idempotencyKey_key" ON "PartIssue"("idempotencyKey")`, `CREATE INDEX "PartIssue_workOrderId_createdAt_idx" ON "PartIssue"("workOrderId", "createdAt")`, `CREATE INDEX "PartIssue_inventoryItemId_createdAt_idx" ON "PartIssue"("inventoryItemId", "createdAt")`] },
  { table: "QCInspection", ddl: [`CREATE TABLE "QCInspection" ("id" TEXT NOT NULL PRIMARY KEY, "workOrderId" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING', "inspectedById" TEXT, "roadTestDone" BOOLEAN NOT NULL DEFAULT false, "roadTestNotes" TEXT, "summary" TEXT, "inspectedAt" DATETIME, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, CONSTRAINT "QCInspection_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE)`, `CREATE INDEX "QCInspection_workOrderId_createdAt_idx" ON "QCInspection"("workOrderId", "createdAt")`] },
  { table: "QCInspectionItem", ddl: [`CREATE TABLE "QCInspectionItem" ("id" TEXT NOT NULL PRIMARY KEY, "qcInspectionId" TEXT NOT NULL, "label" TEXT NOT NULL, "result" TEXT NOT NULL DEFAULT 'PENDING', "notes" TEXT, "sortOrder" INTEGER NOT NULL DEFAULT 0, CONSTRAINT "QCInspectionItem_qcInspectionId_fkey" FOREIGN KEY ("qcInspectionId") REFERENCES "QCInspection"("id") ON DELETE CASCADE ON UPDATE CASCADE)`, `CREATE INDEX "QCInspectionItem_qcInspectionId_sortOrder_idx" ON "QCInspectionItem"("qcInspectionId", "sortOrder")`] },
  { table: "SyncOutbox", ddl: [`CREATE TABLE "SyncOutbox" ("id" TEXT NOT NULL PRIMARY KEY, "eventId" TEXT NOT NULL, "entityType" TEXT NOT NULL, "entityId" TEXT NOT NULL, "eventType" TEXT NOT NULL, "payloadJson" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING', "retryCount" INTEGER NOT NULL DEFAULT 0, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "syncedAt" DATETIME, "lastError" TEXT)`, `CREATE UNIQUE INDEX "SyncOutbox_eventId_key" ON "SyncOutbox"("eventId")`, `CREATE INDEX "SyncOutbox_status_createdAt_idx" ON "SyncOutbox"("status", "createdAt")`, `CREATE INDEX "SyncOutbox_entityType_entityId_idx" ON "SyncOutbox"("entityType", "entityId")`] },
  { table: "SyncConflict", ddl: [`CREATE TABLE "SyncConflict" ("id" TEXT NOT NULL PRIMARY KEY, "eventId" TEXT NOT NULL, "entityType" TEXT NOT NULL, "entityId" TEXT NOT NULL, "localJson" TEXT NOT NULL, "remoteJson" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'OPEN', "resolutionNote" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "resolvedAt" DATETIME)`, `CREATE INDEX "SyncConflict_status_createdAt_idx" ON "SyncConflict"("status", "createdAt")`] },
  // v0.3.30 — numbers issued before a backup restore rolled the database back
  {
    table: "RetiredDocNumber",
    ddl: [
      `CREATE TABLE "RetiredDocNumber" (
    "number" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "source" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
      `CREATE INDEX "RetiredDocNumber_kind_idx" ON "RetiredDocNumber"("kind")`,
    ],
  },
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
    "eInvoiceEnv" TEXT,
    "docSnapshot" TEXT,
    CONSTRAINT "CreditNote_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
)`,
      `CREATE UNIQUE INDEX "CreditNote_number_key" ON "CreditNote"("number")`,
    ],
  },
  {
    // v0.3.29 — invoice lines a credit note credits (old credit notes simply have none:
    // they stay amount-only credits).
    table: "CreditNoteLine",
    ddl: [
      `CREATE TABLE "CreditNoteLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "creditNoteId" TEXT NOT NULL,
    "workOrderItemId" TEXT,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "unitPrice" REAL NOT NULL,
    "total" REAL NOT NULL,
    "net" REAL NOT NULL,
    "taxAmount" REAL NOT NULL DEFAULT 0,
    "inventoryItemId" TEXT,
    "returnedToStock" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "CreditNoteLine_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "CreditNote" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CreditNoteLine_workOrderItemId_fkey" FOREIGN KEY ("workOrderItemId") REFERENCES "WorkOrderItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
)`,
      `CREATE INDEX "CreditNoteLine_creditNoteId_idx" ON "CreditNoteLine"("creditNoteId")`,
      `CREATE INDEX "CreditNoteLine_workOrderItemId_idx" ON "CreditNoteLine"("workOrderItemId")`,
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
    "submissionUid" TEXT,
    "eInvoiceEnv" TEXT
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
/** When the last upgrade attempt failed (request-time retries wait RETRY_AFTER_MS after it). */
let lastFailureAt = 0;
/** A failed upgrade is tried again by request-time callers at most this often (each try first makes a backup copy). */
const RETRY_AFTER_MS = 10 * 60 * 1000;

function dataDir() {
  return process.env.WORKSHOP_DATA_DIR || path.join(process.cwd(), "data");
}

/** Written when an upgrade fails so the desktop app can warn the user. Removed on success. */
function statusFile() {
  return path.join(dataDir(), "upgrade-error.txt");
}

// 【中文】启动时自动升级旧数据库：①先找出缺什么 ②先备份 ③在一个事务里一次改完（全成功或全不改）。只增不删，不会动已有数据。
/**
 * The upgrade succeeded: remove the error file. Warnings (a unique index skipped because old
 * data has a duplicate number) go to upgrade-warnings.txt and the log, NOT to the error file,
 * which makes the desktop app say the upgrade failed. The desktop app shows the warnings once
 * as a calm notice (electron/upgrade-notice.js).
 */
function writeUpgradeStatus(problems: string[]) {
  try { fs.rmSync(statusFile(), { force: true }); } catch {}
  const warnFile = path.join(dataDir(), "upgrade-warnings.txt");
  if (!problems.length) {
    try { fs.rmSync(warnFile, { force: true }); } catch {}
    return;
  }
  for (const p of problems) console.warn("[schema-upgrade] " + p);
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.writeFileSync(warnFile, `${new Date().toISOString()}\n${problems.join("\n")}\n`);
  } catch {}
}

/** Column names in a CREATE TABLE statement of TABLES (one `"name" TYPE` per line). */
export function ddlColumns(ddl: string): Set<string> {
  const body = ddl.slice(ddl.indexOf("(") + 1, ddl.lastIndexOf(")"));
  // Match column declarations whether CREATE TABLE is formatted across lines or on one line.
  // The old ^-anchored expression missed compact one-line DDL and caused duplicate ALTER TABLEs.
  const columnPattern = /(?:^|,)\s*"([^"]+)"\s+(TEXT|REAL|INTEGER|BOOLEAN|DATETIME|BLOB)\b/gi;
  return new Set(Array.from(body.matchAll(columnPattern), (m) => m[1]));
}

/**
 * Bring the database behind `db` up to the current schema (see the notes at the top).
 * Exported for tests/ops-schema-upgrade.test.mjs; the app calls ensureSchema().
 * A table created in this run gets the COLUMNS entries its CREATE TABLE text does not have yet
 * (in the same transaction), so a very old database is complete after ONE start, and an index
 * on such a column (INDEXES) never fails.
 * 【中文】把数据库升级到最新结构。本次新建的表，如果建表语句里还缺 COLUMNS 中的字段，会在同一个事务里马上补上。
 */
export async function runSchemaUpgrade(db: Db): Promise<void> {
  const existing = new Set(
    (await db.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT name FROM sqlite_master WHERE type = 'table'`
    )).map((r) => r.name)
  );
  // A brand-new empty file (no tables yet) is set up elsewhere; don't touch it.
  if (!existing.has("WorkOrder")) return;

  // 1) Work out what is missing (read-only).
  const sql: string[] = [];
  const names: string[] = [];
  const cache = new Map<string, Set<string>>();
  for (const t of TABLES) {
    if (existing.has(t.table)) continue;
    sql.push(...t.ddl);
    names.push(`table ${t.table}`);
    cache.set(t.table, ddlColumns(t.ddl[0]));
  }
  const after: string[] = []; // one-time data fills for columns added in this run
  for (const c of COLUMNS) {
    if (!cache.has(c.table)) {
      const rows = await db.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("${c.table}")`);
      cache.set(c.table, new Set(rows.map((r) => r.name)));
    }
    const cols = cache.get(c.table)!;
    if (cols.size > 0 && !cols.has(c.column)) {
      sql.push(`ALTER TABLE "${c.table}" ADD COLUMN "${c.column}" ${c.ddl}`);
      names.push(`${c.table}.${c.column}`);
      cols.add(c.column);
      if (c.after) after.push(...c.after);
    }
  }
  // v0.2.9 — the QR token must be unique (ALTER TABLE cannot add UNIQUE, so use an index).
  const woCols = cache.get("WorkOrder");
  const tokenIdx = await db.$queryRawUnsafe<Array<{ name: string }>>(
    `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'WorkOrder_eInvoiceToken_key'`
  );
  if (tokenIdx.length === 0 && woCols) {
    sql.push(`CREATE UNIQUE INDEX "WorkOrder_eInvoiceToken_key" ON "WorkOrder"("eInvoiceToken")`);
    names.push("index WorkOrder_eInvoiceToken_key");
  }
  for (const ix of INDEXES) {
    const has = await db.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND name = '${ix.name}'`
    );
    if (has.length === 0 && (existing.has(ix.table) || TABLES.some((t) => t.table === ix.table))) {
      sql.push(ix.ddl);
      names.push(`index ${ix.name}`);
    }
  }
  // Data fills run last, after every table and column they rely on exists.
  sql.push(...after);
  if (sql.length === 0) {
    const problems = await ensureUniqueIndexes(db);
    writeUpgradeStatus(problems);
    return;
  }

  // 2) Safety copy first. If it cannot be made, do NOT touch the database.
  const dir = path.join(dataDir(), "backups", "pre-upgrade");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `workshop-before-upgrade-${stamp}.db`);
  try {
    await db.$executeRawUnsafe(`VACUUM INTO '${file.replace(/'/g, "''")}'`);

    // 3) Apply everything in one transaction: all or nothing.
    await db.$transaction(sql.map((q) => db.$executeRawUnsafe(q)));
  } catch (e) {
    // Nothing was changed (the transaction rolled back, or the copy itself failed), so the copy
    // is not needed. Pre-upgrade copies are never pruned, and a failed upgrade is retried, so
    // keeping one per failed try would fill the disk.
    // 【中文】升级失败时数据库没有被改动，删掉这次的备份副本，避免每次重试都多一份完整副本占满硬盘。
    try { fs.rmSync(file, { force: true }); } catch {}
    throw e;
  }
  console.log(`[schema-upgrade] applied: ${names.join(", ")} (backup: ${file})`);
  // 4) Unique document-number indexes, each on its own (skipped if old data has duplicates).
  const problems = await ensureUniqueIndexes(db);
  writeUpgradeStatus(problems);
}

/**
 * Upgrade once per server run. A failure is NOT cached: it is written to upgrade-error.txt (the
 * desktop app warns about it) and the next caller tries again — the next start, or a request-time
 * caller through schemaReady().
 * 【中文】每次启动升级一次；失败不会被缓存：写入 upgrade-error.txt，下次启动或请求时（schemaReady）会再试。
 */
export function ensureSchema(): Promise<void> {
  if (!done) {
    done = runSchemaUpgrade(prisma).then(
      () => {
        lastFailureAt = 0;
      },
      (e) => {
        done = null; // tried again by the next caller
        lastFailureAt = Date.now();
        console.error("[schema-upgrade] failed", e);
        try {
          fs.mkdirSync(dataDir(), { recursive: true });
          fs.writeFileSync(statusFile(), `${new Date().toISOString()}\n${String(e?.stack || e)}\n`);
        } catch {}
        throw e;
      }
    );
  }
  return done;
}

/**
 * For request-time callers: resolves true when the database is up to date. A failed upgrade is
 * retried here (at most every 10 minutes, since each try makes a backup copy first) instead of
 * staying failed until the app is restarted. Never throws.
 * 【中文】给请求时调用：数据库已是最新就返回 true；之前升级失败的话会再试（最多每 10 分钟一次），不会一直失败到重启。
 */
export async function schemaReady(): Promise<boolean> {
  if (!done && lastFailureAt && Date.now() - lastFailureAt < RETRY_AFTER_MS) return false;
  try {
    await ensureSchema();
    return true;
  } catch {
    return false;
  }
}
