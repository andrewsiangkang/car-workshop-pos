import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(here, "..", p), "utf8");

test("v0.3.29 Prisma schema includes submission and migration history models", () => {
  const schema = read("prisma/schema.prisma");
  assert.match(schema, /model EInvoiceSubmissionLog\s*\{/);
  assert.match(schema, /model SystemMigration\s*\{/);
});

test("schema upgrade is additive and creates v0.3.29 tables", () => {
  const upgrade = read("src/lib/schema-upgrade.ts");
  assert.match(upgrade, /CREATE TABLE "EInvoiceSubmissionLog"/);
  assert.match(upgrade, /CREATE TABLE "SystemMigration"/);
  assert.match(upgrade, /VACUUM INTO/);
  assert.doesNotMatch(upgrade, /DROP TABLE/i);
});

test("individual e-Invoice submission uses shared buyer validator", () => {
  const route = read("src/app/api/myinvois/submit/route.ts");
  const builder = read("src/lib/myinvois.ts");
  assert.match(route, /validateMyInvoisBuyer/);
  assert.match(builder, /validateMyInvoisBuyer/);
  assert.match(builder, /allowGeneralPublic: true/);
});

test("shop settings encrypt a newly supplied MyInvois secret", () => {
  const route = read("src/app/api/shop/route.ts");
  assert.match(route, /encryptSecret/);
});

test("package and lockfile versions are aligned", () => {
  const pkg = JSON.parse(read("package.json"));
  const lock = JSON.parse(read("package-lock.json"));
  assert.equal(pkg.version, "0.3.29");
  assert.equal(lock.version, "0.3.29");
  assert.equal(lock.packages[""].version, "0.3.29");
});

test("all API route files are guarded or explicitly public", () => {
  const apiRoot = path.join(here, "..", "src", "app", "api");
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : entry.name === "route.ts" ? [full] : [];
  });
  const publicRoutes = new Set([
    "auth/setup/route.ts",
    "auth/login/route.ts",
    "auth/logout/route.ts",
    "public/einvoice/[token]/route.ts",
    "version/route.ts",
  ]);
  const routes = walk(apiRoot);
  for (const file of routes) {
    const rel = path.relative(apiRoot, file).replaceAll(path.sep, "/");
    const source = fs.readFileSync(file, "utf8");
    if (publicRoutes.has(rel)) continue;
    assert.match(source, /requireAuth|requireOwner/, `${rel} must enforce API authentication`);
  }
});
