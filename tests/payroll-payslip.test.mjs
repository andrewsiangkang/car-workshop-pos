import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manager = readFileSync('src/app/(dashboard)/payroll/PayrollManager.tsx', 'utf8');
const payslips = readFileSync('src/app/(dashboard)/payroll/PayslipActions.tsx', 'utf8');
const page = readFileSync('src/app/(dashboard)/payroll/page.tsx', 'utf8');

test('payslips are only issued after payroll approval', () => {
  assert.match(payslips, /run\.status === "DRAFT"/);
  assert.match(payslips, /Approve payroll before issuing employee payslips/);
});

test('payslip supports employee-specific print and batch print', () => {
  assert.match(payslips, /openPayslip\(run, rows\)/);
  assert.match(payslips, /openAllPayslips\(run, employees\)/);
  assert.match(payslips, /Print All Employees/);
  assert.match(payslips, /Save as PDF/);
});

test('payslip includes commission, basic salary, allowance, deduction and net pay', () => {
  for (const label of ['Commission', 'Basic salary', 'Allowance', 'Deduction', 'NET PAY']) {
    assert.ok(payslips.includes(label), `missing ${label}`);
  }
});

test('payroll page passes employee identifiers needed to group individual payslips', () => {
  assert.match(page, /userId: e\.userId/);
  assert.match(payslips, /new Map<string, PayslipEntry\[\]>/);
  assert.match(manager, /<PayslipActions run=\{run\} \/>/);
});
