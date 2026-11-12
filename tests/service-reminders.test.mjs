import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("service reminder fields are part of the Vehicle model and safe schema upgrade", () => {
  const schema = read("prisma/schema.prisma");
  const upgrade = read("src/lib/schema-upgrade.ts");
  for (const field of ["lastServiceDate", "lastServiceMileage", "nextServiceDate", "nextServiceMileage", "serviceIntervalKm", "serviceIntervalMonths"]) {
    assert.ok(schema.includes(field), `missing Prisma field ${field}`);
    assert.ok(upgrade.includes(`column: "${field}"`), `missing additive upgrade for ${field}`);
  }
});

test("service reminder page, navigation and protected API are present", () => {
  assert.ok(fs.existsSync(path.join(root, "src/app/(dashboard)/service-reminders/page.tsx")));
  assert.ok(read("src/components/layout/Sidebar.tsx").includes('href: "/service-reminders"'));
  const api = read("src/app/api/service-reminders/route.ts");
  assert.ok(api.includes("requireAuth"));
  assert.ok(api.includes("SERVICE_REMINDER_COMPLETED"));
  assert.ok(api.includes("SERVICE_REMINDER_UPDATED"));
});

test("split payment reducer has explicit numeric typing", () => {
  const route = read("src/app/api/work-orders/[id]/route.ts");
  assert.ok(route.includes("rows.reduce<number>((sum: number, row: SplitPaymentRow)"));
});
