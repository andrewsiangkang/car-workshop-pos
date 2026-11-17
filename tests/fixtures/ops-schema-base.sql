-- The oldest shop database the automatic upgrade (src/lib/schema-upgrade.ts) must bring up to
-- date: the tables of the first desktop releases, without any column, table or index that the
-- upgrade adds (COLUMNS, TABLES, INDEXES, UNIQUE_INDEXES, WorkOrder_eInvoiceToken_key).
-- FROZEN on purpose: do not regenerate it from schema.prisma. tests/ops-schema-upgrade.test.mjs
-- runs the upgrade on it and compares the result with a database made from schema.prisma, so a
-- new column / table / index in schema.prisma that the upgrade does not create fails the test.
-- 【中文】最旧的店铺数据库结构（冻结，不要从 schema.prisma 重新生成）：测试会在它上面跑自动升级，再和最新结构比较。

CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'STAFF',
    "phone" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "Customer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "tin" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "plateNumber" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER,
    "color" TEXT,
    "vin" TEXT,
    "mileage" INTEGER,
    "notes" TEXT,
    "customerId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Vehicle_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "WorkOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderNumber" TEXT NOT NULL,
    "quotationNumber" TEXT,
    "invoiceNumber" TEXT,
    "receiptNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "description" TEXT,
    "diagnosis" TEXT,
    "laborNotes" TEXT,
    "mileageIn" INTEGER,
    "mileageOut" INTEGER,
    "totalAmount" REAL NOT NULL DEFAULT 0,
    "partsAmount" REAL NOT NULL DEFAULT 0,
    "laborAmount" REAL NOT NULL DEFAULT 0,
    "discount" REAL NOT NULL DEFAULT 0,
    "paidAmount" REAL NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "quotedAt" DATETIME,
    "confirmedAt" DATETIME,
    "completedAt" DATETIME,
    "invoicedAt" DATETIME,
    "paidAt" DATETIME,
    "eInvoiceUuid" TEXT,
    "eInvoiceLongId" TEXT,
    "eInvoiceStatus" TEXT,
    "customerId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "assignedToId" TEXT,
    CONSTRAINT "WorkOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WorkOrder_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WorkOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WorkOrder_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "WorkOrderItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" REAL NOT NULL DEFAULT 1,
    "unitPrice" REAL NOT NULL,
    "costPrice" REAL NOT NULL DEFAULT 0,
    "total" REAL NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "inventoryItemId" TEXT,
    CONSTRAINT "WorkOrderItem_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkOrderItem_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "amount" REAL NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'CASH',
    "reference" TEXT,
    "notes" TEXT,
    "paidAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "workOrderId" TEXT NOT NULL,
    CONSTRAINT "Payment_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "Expense" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "category" TEXT,
    "notes" TEXT,
    "expenseDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "ShopProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "nameMs" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "tin" TEXT,
    "brn" TEXT,
    "sstNumber" TEXT,
    "msicCode" TEXT,
    "msicDesc" TEXT,
    "myInvoisClientId" TEXT,
    "myInvoisClientSecret" TEXT,
    "myInvoisSandbox" BOOLEAN NOT NULL DEFAULT true,
    "bankName" TEXT,
    "bankAccount" TEXT,
    "paymentQrUrl" TEXT,
    "logoUrl" TEXT,
    "receiptFooter" TEXT,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "category" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'pcs',
    "quantityOnHand" REAL NOT NULL DEFAULT 0,
    "costPrice" REAL NOT NULL DEFAULT 0,
    "sellingPrice" REAL NOT NULL DEFAULT 0,
    "minStockLevel" REAL NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "notes" TEXT,
    "inventoryItemId" TEXT NOT NULL,
    "workOrderId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockMovement_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StockMovement_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

CREATE UNIQUE INDEX "Vehicle_plateNumber_key" ON "Vehicle"("plateNumber");

CREATE UNIQUE INDEX "WorkOrder_orderNumber_key" ON "WorkOrder"("orderNumber");

CREATE UNIQUE INDEX "InventoryItem_sku_key" ON "InventoryItem"("sku");
