import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Structural guard: every server page in the dashboard must check the login itself.
// A check in layout.tsx alone is not enough, because Next.js can render a page without
// re-running its parent layout. Client pages ("use client") get their data from API
// routes, which have their own requireAuth / requireOwner checks.
const ROOT = path.join(import.meta.dirname, "..", "src", "app", "(dashboard)");
const OWNER_ONLY = ["suppliers", "supplier-invoices", "payment-vouchers", "reports", "einvoice", "expenses"];

function pages(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return pages(p);
    return e.name === "page.tsx" ? [p] : [];
  });
}

function firstStatement(src) {
  const start = src.indexOf("export default ");
  const open = src.indexOf("(", src.indexOf("function", start));
  let depth = 0, i = open;
  for (; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) break;
  }
  const body = src.indexOf("{", i) + 1;
  return src.slice(body).trim().split("\n")[0];
}

test("every dashboard server page starts with requirePageUser / requirePageOwner", () => {
  const server = pages(ROOT).filter((f) => !/^\s*["']use client["']/.test(fs.readFileSync(f, "utf8")));
  assert.ok(server.length >= 15, "expected to find the dashboard server pages");
  for (const f of server) {
    const rel = path.relative(ROOT, f);
    const first = firstStatement(fs.readFileSync(f, "utf8"));
    const ownerOnly = OWNER_ONLY.includes(rel.split(path.sep)[0]);
    const want = ownerOnly ? /await requirePageOwner\(\);/ : /await requirePage(User|Owner)\(\);/;
    assert.match(first, want, `${rel} must check the login first (found: ${first})`);
  }
});
