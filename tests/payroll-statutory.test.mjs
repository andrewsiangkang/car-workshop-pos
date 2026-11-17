import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const moduleUrl = pathToFileURL(path.join(ROOT, 'src/lib/payroll-statutory.ts')).href;
const profile = (overrides = {}) => ({
  statutoryProfileComplete: true,
  epfCategory: 'MALAYSIAN_UNDER_60',
  socsoCategory: 'FIRST',
  socsoSkbbk: 'OFF',
  eisEligible: true,
  taxResidency: 'RESIDENT',
  taxCategory: 'SINGLE',
  qualifyingChildren: 0,
  disabledSelf: false,
  disabledSpouse: false,
  priorGrossYtd: 0,
  priorEpfYtd: 0,
  priorPcbYtd: 0,
  priorZakatYtd: 0,
  priorSocsoYtd: 0,
  taxReliefYtd: 0,
  taxReliefMonthly: 0,
  zakatMonthly: 0,
  ...overrides,
});
function calculate(grossWages, periodKey, p) {
  const script = `const { calculateMalaysiaStatutory } = await import(${JSON.stringify(moduleUrl)}); const result = calculateMalaysiaStatutory(${JSON.stringify({ grossWages, periodKey, profile: p })}); process.stdout.write(JSON.stringify(result));`;
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || 'statutory calculator subprocess failed');
  return JSON.parse(result.stdout);
}

test('statutory engine refuses to calculate before owner confirms the employee profile or before June 2026 schedules apply', () => {
  assert.equal(calculate(3000, '2026-11', profile({ statutoryProfileComplete: false })), null);
  assert.equal(calculate(3000, '2026-05', profile()), null);
});

test('standard Malaysian employee calculation separates employee and employer shares', () => {
  const result = calculate(5000, '2026-11', profile());
  assert.equal(result.epfEmployee, 550);
  assert.equal(result.epfEmployer, 650);
  assert.equal(result.socsoEmployee, 24.75);
  assert.equal(result.socsoEmployer, 86.65);
  assert.equal(result.eisEmployee, 9.9);
  assert.equal(result.eisEmployer, 9.9);
  assert.equal(result.pcb, 0);
  assert.equal(result.calculationVersion, 'MY-2026-REVIEW-1');
  assert.ok(result.warnings.length >= 3);
});

test('EPF follows the Third Schedule wage-band upper limit', () => {
  const withinTwentyRinggitBand = calculate(3250, '2026-11', profile());
  assert.equal(withinTwentyRinggitBand.epfEmployee, 359);
  assert.equal(withinTwentyRinggitBand.epfEmployer, 424);
  const aboveFiveThousandBand = calculate(5000.01, '2026-11', profile());
  assert.equal(aboveFiveThousandBand.epfEmployee, 561);
  assert.equal(aboveFiveThousandBand.epfEmployer, 612);
});

test('SKBBK employee share is added only when the profile indicates participation', () => {
  const optedOut = calculate(2000, '2026-11', profile());
  const optedIn = calculate(2000, '2026-11', profile({ socsoSkbbk: 'ON' }));
  assert.equal(Math.round((optedIn.socsoEmployee - optedOut.socsoEmployee) * 100) / 100, 14.65);
});

test('SKBBK Phase 2 and Phase 3 rates activate on their published dates', () => {
  const phase2 = calculate(5000, '2028-06', profile({ socsoSkbbk: 'ON' }));
  const phase3 = calculate(5000, '2031-06', profile({ socsoSkbbk: 'ON' }));
  assert.equal(phase2.socsoEmployee, 74.25);
  assert.equal(phase3.socsoEmployee, 86.65);
});

test('resident PCB uses YTD opening balances and monthly projection', () => {
  const result = calculate(10000, '2026-11', profile({ priorGrossYtd: 100000, priorEpfYtd: 4000, priorPcbYtd: 10000, priorSocsoYtd: 300 }));
  assert.equal(result.pcb, 533.8);
  assert.equal(result.breakdown.pcbMethod, 'RESIDENT_2026_MTD');
});

test('foreign non-resident PCB uses the HASiL 30 percent monthly method', () => {
  const result = calculate(3000, '2026-11', profile({
    epfCategory: 'FOREIGN', socsoCategory: 'FOREIGN', socsoSkbbk: 'ON',
    taxResidency: 'NON_RESIDENT', eisEligible: true,
  }));
  assert.equal(result.pcb, 900);
  assert.equal(result.breakdown.pcbMethod, 'NON_RESIDENT_30_PERCENT');
  assert.equal(result.eisEmployee, 0, 'foreign workers are not covered by EIS');
  assert.equal(result.socsoEmployer, 51.65);
  assert.equal(result.socsoEmployee, 36.9);
});

test('EIS uses the Act 800 band midpoint and RM6,000 ceiling', () => {
  const atThreeThousand = calculate(3000, '2026-11', profile());
  const atFiveThousandFiveHundred = calculate(5500, '2026-11', profile());
  const aboveCeiling = calculate(9000, '2026-11', profile());
  assert.equal(atThreeThousand.eisEmployee, 5.9);
  assert.equal(atFiveThousandFiveHundred.eisEmployee, 10.9);
  assert.equal(aboveCeiling.eisEmployee, 11.9);
});

test('EIS eligibility and EPF 60-plus category are respected', () => {
  const result = calculate(3000, '2026-11', profile({ epfCategory: 'MALAYSIAN_60_PLUS', eisEligible: false }));
  assert.equal(result.epfEmployee, 0);
  assert.equal(result.epfEmployer, 120);
  assert.equal(result.eisEmployee, 0);
  assert.equal(result.eisEmployer, 0);
});
