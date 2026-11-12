import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const component = await readFile(new URL('../src/components/work-orders/OrderActions.tsx', import.meta.url), 'utf8');
const route = await readFile(new URL('../src/app/api/work-orders/[id]/route.ts', import.meta.url), 'utf8');

test('OrderActions declares stock warning state before rendering it', () => {
  assert.match(component, /const \[stockWarnings, setStockWarnings\] = useState<string\[]>\(\[\]\)/);
  assert.match(component, /stockWarnings\.length > 0/);
  assert.match(component, /stockWarnings\.map\(/);
});

test('invoice response stock warnings are safely read from the API response', () => {
  assert.match(component, /payload\.action === "generate_invoice"/);
  assert.match(component, /Array\.isArray\(data\.stockWarnings\)/);
  assert.match(component, /typeof warning === "string"/);
  assert.match(route, /stockWarnings: stockWarnings\.length \? stockWarnings : undefined/);
});
