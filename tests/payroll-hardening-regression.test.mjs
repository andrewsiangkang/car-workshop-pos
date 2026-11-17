import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const adjustment = fs.readFileSync(path.join(ROOT, 'src/app/(dashboard)/payroll/EntryAdjustment.tsx'), 'utf8');

test('payroll stale-draft message uses a JSX-safe apostrophe and remains covered by the test', () => {
  assert.match(adjustment, /Regenerate this month(?:'|&apos;)s draft/);
});
