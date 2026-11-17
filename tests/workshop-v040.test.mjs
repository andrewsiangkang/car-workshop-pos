import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("v0.4.0 workshop planning fields are represented in Prisma and additive upgrade", () => {
  const schema = read("prisma/schema.prisma");
  const upgrade = read("src/lib/schema-upgrade.ts");
  for (const field of ["priority", "estimatedCompletionAt", "startedAt"]) {
    assert.match(schema, new RegExp(`\\b${field}\\b`));
    assert.match(upgrade, new RegExp(`column: \\"${field}\\"`));
  }
  assert.match(schema, /model WorkOrderHistory/);
  assert.match(upgrade, /table: "WorkOrderHistory"/);
  assert.match(upgrade, /WorkOrderHistory_workOrderId_createdAt_idx/);
  assert.match(upgrade, /WorkOrder_status_estimatedCompletionAt_idx/);
});

test("new work orders and status transitions append workshop timeline entries", () => {
  const createRoute = read("src/app/api/work-orders/route.ts");
  const updateRoute = read("src/app/api/work-orders/[id]/route.ts");
  assert.match(createRoute, /workOrderHistory\.create/);
  assert.match(updateRoute, /action === "update_status"/);
  assert.match(updateRoute, /if \(from !== next\)/);
  assert.match(updateRoute, /workOrderHistory\.create/);
  assert.match(updateRoute, /action === "update_workshop_plan"/);
});

test("Workshop Board is local server-rendered and linked from the main navigation", () => {
  const page = read("src/app/(dashboard)/workshop/page.tsx");
  const sidebar = read("src/components/layout/Sidebar.tsx");
  assert.match(page, /requirePageUser/);
  assert.match(page, /prisma\.workOrder\.findMany/);
  assert.match(page, /IN_PROGRESS/);
  assert.match(sidebar, /href: "\/workshop"/);
});

test("workshop plan updates validate enabled technician accounts and are audited", () => {
  const route = read("src/app/api/work-orders/[id]/route.ts");
  assert.match(route, /role: "TECHNICIAN", disabledAt: null/);
  assert.match(route, /WORKSHOP_PLAN_UPDATED/);
  assert.match(route, /estimatedCompletionAt/);
});
