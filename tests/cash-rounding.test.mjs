import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const actions = fs.readFileSync(new URL("../src/components/work-orders/OrderActions.tsx", import.meta.url), "utf8");
const route = fs.readFileSync(new URL("../src/app/api/work-orders/[id]/route.ts", import.meta.url), "utf8");
const schema = fs.readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const upgrade = fs.readFileSync(new URL("../src/lib/schema-upgrade.ts", import.meta.url), "utf8");
const receipt = fs.readFileSync(new URL("../src/components/documents/DocumentLayout.tsx", import.meta.url), "utf8");

test("rounding is nearest five sen and available to all methods on full settlement", () => {
  assert.ok(actions.includes("[1, 2, 6, 7].includes(lastDigit)"));
  assert.ok(route.includes("lastDigit === 3 || lastDigit === 4 || lastDigit === 8 || lastDigit === 9"));
  assert.ok(actions.includes("const roundingEligible = splits.length > 0 && settlesBalance"));
  assert.ok(!actions.includes("const roundingEligible = allCash"));
  assert.ok(route.includes("Rounding is only available when payment settles the full remaining balance"));
  assert.ok(!route.includes("if (!allCash"));
});

test("UI uses automatic standard rounding and API rejects non-standard manual adjustments", () => {
  assert.ok(actions.includes('roundingMode: roundingEligible ? "AUTO" : "NONE"'));
  assert.ok(!actions.includes("manualAdjustmentCents"));
  assert.ok(route.includes("roundingAdjustmentCents !== malaysiaRoundingAdjustmentCents(remainingCents)"));
});

test("rounding adjustment persists on work order and prints on receipt", () => {
  assert.match(schema, /roundingAdjustment Float/);
  assert.ok(upgrade.includes('column: "roundingAdjustment"'));
  assert.ok(route.includes("roundingAdjustment: money(cur.roundingAdjustment + roundingAdjustmentCents / 100)"));
  assert.ok(receipt.includes("Rounding Adjustment"));
});


test("Malaysia BNM rounding table is explicit and round-down settlement clears the balance", () => {
  assert.ok(route.includes("function malaysiaRoundingAdjustmentCents"));
  assert.ok(route.includes("effectiveTotalCents = Math.round((cur.totalAmount + cur.roundingAdjustment"));
  assert.ok(route.includes("roundingAdjustmentCents !== malaysiaRoundingAdjustmentCents(remainingCents)"));
  assert.ok(fs.readFileSync(new URL("../src/app/(dashboard)/work-orders/[id]/page.tsx", import.meta.url), "utf8").includes("order.totalAmount + (order.roundingAdjustment || 0)"));
  assert.ok(fs.readFileSync(new URL("../src/app/api/work-orders/[id]/credit-notes/route.ts", import.meta.url), "utf8").includes("o.totalAmount + (o.roundingAdjustment || 0) - newCredited"));
});
