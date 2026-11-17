import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const routePath = path.join(process.cwd(), "src", "app", "api", "payroll", "route.ts");
const source = fs.readFileSync(routePath, "utf8");

test("statutory profile does not define qualifyingChildren twice", () => {
  const profileBlock = source.slice(source.indexOf('if (body.action === "save-statutory-profile")'), source.indexOf('if (body.action === "generate")'));
  assert.match(profileBlock, /\.\.\.values/);
  assert.doesNotMatch(profileBlock, /qualifyingChildren:\s*values\.qualifyingChildren,\s*disabledSelf/);
});

test("optional payroll summary amounts are safely defaulted", () => {
  assert.match(source, /taxReliefMonthly:\s*summary\.taxRelief\s*\?\?\s*0/);
  assert.match(source, /zakatMonthly:\s*rule\.zakatMonthly\s*\?\?\s*0/);
  assert.match(source, /summary\.zakat\s*\?\?\s*0/);
});
