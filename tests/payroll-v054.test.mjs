import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

test('v0.5.4 schema stores owner statutory profile and immutable calculation snapshots', () => {
  const schema = read('../prisma/schema.prisma');
  for (const field of ['statutoryProfileComplete', 'epfCategory', 'socsoCategory', 'socsoSkbbk', 'eisEligible', 'taxResidency', 'taxCategory', 'priorGrossYtd', 'priorEpfYtd', 'priorPcbYtd', 'priorZakatYtd', 'statutoryStatus', 'statutoryReviewed', 'statutoryDetails', 'zakat', 'taxRelief']) assert.match(schema, new RegExp(`\\b${field}\\b`));
  const upgrade = read('../src/lib/schema-upgrade.ts');
  for (const field of ['statutoryProfileComplete', 'epfCategory', 'socsoCategory', 'socsoSkbbk', 'eisEligible', 'taxResidency', 'taxCategory', 'statutoryReviewed', 'statutoryDetails', 'zakat', 'taxRelief']) assert.match(upgrade, new RegExp(`column: "${field}"`));
});

test('statutory profiles and review actions are owner-only and audited', () => {
  const route = read('../src/app/api/payroll/route.ts');
  assert.match(route, /requireOwner\(\)/);
  assert.match(route, /save-statutory-profile/);
  assert.match(route, /PAYROLL_STATUTORY_PROFILE_UPDATED/);
  assert.match(route, /PROFILE_CHANGED/);
  assert.match(route, /draftRowsInvalidated/);
  assert.match(route, /review-statutory/);
  assert.match(route, /recalculate-statutory/);
  assert.match(route, /PAYROLL_STATUTORY_RECALCULATED/);
  assert.match(route, /priorPaidEntries/);
  assert.match(route, /priorTotals/);
  assert.match(route, /status: "PAID"/);
  assert.match(route, /taxRelief: true/);
  assert.match(route, /PAYROLL_STATUTORY_REVIEWED/);
  assert.match(route, /statutoryReviewed: true/);
});

test('payroll approval blocks unreviewed or incomplete statutory rows', () => {
  const route = read('../src/app/api/payroll/route.ts');
  assert.match(route, /PROFILE_REQUIRED/);
  assert.match(route, /PROFILE_CHANGED/);
  assert.match(route, /!row\.statutoryReviewed/);
  assert.match(route, /Regenerate the draft to create employee summary rows/);
});

test('statutory amounts are stored once on the employee summary row', () => {
  const route = read('../src/app/api/payroll/route.ts');
  assert.match(route, /Always create one employee summary row/);
  assert.match(route, /Calculate statutory preview once per employee/);
  assert.match(route, /entry\.workOrderId\) return NextResponse\.json/);
});

test('A5 landscape payslip prints separate employer contributions and review state', () => {
  const payslip = read('../src/app/(dashboard)/payroll/PayslipActions.tsx');
  assert.match(payslip, /@page\{size:A5 landscape/);
  assert.match(payslip, /EPF employer/);
  assert.match(payslip, /SOCSO employer/);
  assert.match(payslip, /EIS employer/);
  assert.match(payslip, /Owner statutory review recorded/);
  assert.match(payslip, /Zakat/);
});

test('employee statutory profile requires explicit owner confirmation before save', () => {
  const editor = read('../src/app/(dashboard)/payroll/StatutoryProfileEditor.tsx');
  assert.match(editor, /I confirm these employee categories/);
  assert.match(editor, /disabled=\{busy \|\| !confirmed\}/);
});
