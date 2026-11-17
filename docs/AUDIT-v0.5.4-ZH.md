# Car Workshop POS v0.5.4 Payroll — Verification Report

## Scope

- Owner-controlled commission and statutory employee profiles.
- EPF, PERKESO Act 4 / SKBBK, EIS and PCB calculation preview.
- Previous PAID payroll year-to-date accumulation.
- Zakat and other payroll adjustments.
- A5 landscape employee payslip / print-to-PDF.
- Payroll approval review gate and audit events.

## Verified in this environment

| Check | Result |
|---|---:|
| Focused Payroll tests | 23 passed, 0 failed |
| Full repository test suite | 488 total: 476 passed, 6 failed, 6 skipped |
| Payroll statutory engine isolated TypeScript check | Passed |
| Syntax transpilation of 8 changed TypeScript / TSX files | Passed |
| SQLite additive schema-upgrade test | Passed as part of full suite |
| ZIP integrity | Passed (`unzip -t`, 516 files) |

The 6 full-suite failures are dependency/environment failures: Electron is unavailable for three desktop tests, `@prisma/client` is unavailable for two operations tests, and TypeScript is unavailable to the i18n test. The dependency installation (`npm ci --ignore-scripts --no-audit --no-fund`) timed out. The 6 skipped tests are also dependency-gated.

## Not verified

- Full project `tsc --noEmit` / Next.js production build.
- Prisma CLI `validate` / `generate` against this exact schema.
- Electron Windows installer build.
- Physical A5 printer output on real printer hardware.
- Full statutory acceptance against every KWSP / PERKESO / HASiL official test scenario.

## Statutory limitations

- EPF implements the current schedule categories and wage-band upper limits. Special member-status exceptions and final combined rounding must be checked before remittance.
- PERKESO uses the published June 2026 Act 4 contribution table, including Phase 1 SKBBK, and applies Phase 2 / Phase 3 SKBBK rates by effective date. Employee category and local opt-in / opt-out status must be confirmed by the owner.
- EIS uses the Act 800 Second Schedule wage-band midpoint. The owner must confirm age and prior contribution history exceptions.
- PCB is a 2026 ordinary monthly remuneration preview. It does not implement all HASiL 2026 test cases, including C-suite, Returning Expert Programme, Knowledge Worker, quarterly director fees / additional remuneration, BIK/VOLA, full TP1 / TP3 relief catalogue, all child education/disabled-child relief variants, or employer-borne tax gross-up.
- Allowances are treated as ordinary remuneration by the preview. Exempt travel reimbursements or other excluded wage items require owner adjustment and official verification.
- No statutory remittance, CP39, bank payment, or government portal submission is performed.

## Release recommendation

**Payroll v0.5.4 is a tested development candidate, not a certified or production-approved statutory payroll release.** Test it on a copy of the workshop database first. The owner must verify each employee profile and all calculated amounts against official portals before approving or paying wages.
