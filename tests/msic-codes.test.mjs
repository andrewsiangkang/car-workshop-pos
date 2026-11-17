import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/data/msic-codes.ts", import.meta.url), "utf8");
const entries = [...source.matchAll(/\{ code: "(\d{5})", description: "([^"]+)"/g)].map((m) => ({ code: m[1], description: m[2] }));

test("automotive MSIC shortlist contains unique five-digit code values", () => {
  assert.ok(entries.length >= 15);
  assert.equal(new Set(entries.map((entry) => entry.code)).size, entries.length);
  assert.ok(entries.every((entry) => /^\d{5}$/.test(entry.code)));
});

test("common motor vehicle workshop MSIC codes are present", () => {
  const byCode = new Map(entries.map((entry) => [entry.code, entry.description]));
  assert.equal(byCode.get("45201"), "Maintenance and repair of motor vehicles");
  assert.equal(byCode.get("45202"), "Spraying and painting");
  assert.equal(byCode.get("45203"), "Washing and polishing (car wash)");
  assert.equal(byCode.get("45205"), "Installation of parts and accessories not as part of the manufacturing process");
  assert.equal(byCode.get("45300"), "Wholesale and retail sale of all kinds of parts, components, supplies, tools and accessories for motor vehicles");
  assert.equal(byCode.get("45403"), "Repair and maintenance of motorcycles");
});
