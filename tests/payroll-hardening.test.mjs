import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const periodModule = pathToFileURL(path.join(ROOT, 'src/lib/payroll-period.ts')).href;
const route = fs.readFileSync(path.join(ROOT, 'src/app/api/payroll/route.ts'), 'utf8');
const adjustment = fs.readFileSync(path.join(ROOT, 'src/app/(dashboard)/payroll/EntryAdjustment.tsx'), 'utf8');
const manager = fs.readFileSync(path.join(ROOT, 'src/app/(dashboard)/payroll/PayrollManager.tsx'), 'utf8');

function range(periodKey) {
  const script = `const { malaysiaPayrollMonthRange } = await import(${JSON.stringify(periodModule)}); const r = malaysiaPayrollMonthRange(${JSON.stringify(periodKey)}); process.stdout.write(JSON.stringify({ start: r.startAt.toISOString(), end: r.endAt.toISOString() }));`;
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || 'period helper failed');
  return JSON.parse(result.stdout);
}

test('Malaysia payroll period uses Kuala Lumpur local month boundaries, not UTC month boundaries', () => {
  assert.deepEqual(range('2026-11'), { start: '2026-10-31T16:00:00.000Z', end: '2026-11-30T16:00:00.000Z' });
  assert.throws(() => range('2026-13'));
});

test('changing a commission rule invalidates existing draft payroll snapshots', () => {
  assert.match(route, /invalidatedDraftRows/);
  assert.match(route, /statutoryStatus: "RULE_CHANGED"/);
  assert.match(route, /Regenerate this month's draft before approval/);
  assert.match(route, /staleRules/);
});

test('a stale commission rule cannot be manually adjusted, recalculated, reviewed or approved', () => {
  assert.match(route, /row\.statutoryStatus === "RULE_CHANGED"/);
  assert.match(route, /Commission settings changed\. Regenerate this month's draft before making payroll adjustments/);
  assert.match(route, /Commission settings changed\. Regenerate this month's draft before reviewing it/);
  assert.match(route, /Commission settings changed\. Regenerate this month's draft before recalculating statutory amounts/);
  assert.match(adjustment, /"RULE_CHANGED"\]/);
  assert.match(adjustment, /Regenerate this month's draft/);
});

test('saving a statutory profile does not clear an already stale commission-rule marker', () => {
  assert.match(route, /row\.statutoryStatus !== \"RULE_CHANGED\"/);
  assert.match(route, /Preserve RULE_CHANGED/);
});

test('statutory review is conditional on the draft still being open and unchanged', () => {
  assert.match(route, /currentRun\.status !== "DRAFT"/);
  assert.match(route, /statutoryStatus: entry\.statutoryStatus, statutoryReviewed: false/);
});

test('payroll dashboard displays one consolidated net-pay total per employee', () => {
  assert.match(manager, /Employee Net Pay \(summary row\)/);
  assert.match(manager, /run\.entries\.filter\(\(row\) => row\.userId === entry\.userId\)/);
  assert.match(manager, /Included in employee total/);
});
