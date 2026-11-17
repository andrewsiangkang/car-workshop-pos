import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

test("Payroll JSX copy escapes apostrophes", () => {
  const files = [
    "src/app/(dashboard)/payroll/EntryAdjustment.tsx",
    "src/app/(dashboard)/payroll/StatutoryProfileEditor.tsx",
  ];
  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(source, /employee's|month's/);
  }
});

test("Payroll API uses explicit statutory profile types instead of any", () => {
  const source = read("src/app/api/payroll/route.ts");
  assert.match(source, /type PayrollStatutoryProfile/);
  assert.doesNotMatch(source, /as any/);
});

test("SOCSO band values do not use an unused destructured placeholder", () => {
  const source = read("src/lib/payroll-statutory.ts");
  assert.match(source, /const firstEmployer = band\.row\[1\]/);
  assert.doesNotMatch(source, /const \[_[,]/);
});
