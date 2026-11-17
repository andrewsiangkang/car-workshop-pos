# Car Workshop POS v0.5.4 — Payroll upgrade

- Added owner-controlled statutory profile for each technician.
- Added Malaysia 2026 statutory calculation preview for EPF Third Schedule, PERKESO Act 4 wage-band table / SKBBK Phase 1–3, EIS Act 800 Second Schedule and ordinary monthly PCB/MTD.
- Added current-year accumulations from previous PAID payroll runs plus opening YTD balances not recorded in this POS; added Zakat deduction and tax-relief YTD snapshots.
- Added employee summary payroll row so statutory deductions are not duplicated across Work Orders.
- Added mandatory owner review step before payroll approval.
- Added audit events for statutory profile updates and review confirmations.
- Added A5 landscape payslip breakdown with separate employee deductions and employer contributions.
- Fixed payslip text label regression (`Deduction`).
- Added pure calculation tests and payroll integration source tests.

Important: calculated statutory amounts remain review previews. This release does not automate the full HASiL additional-remuneration/TP1 catalogue or submit statutory remittances.
