# Payroll v0.5.4 — Malaysia statutory preview and A5 payslip

## Owner-controlled employee setup

The owner configures commission basis/rate/basic salary and the employee statutory profile. The statutory profile is deliberately not treated as complete until the owner saves it. The profile includes:

- EPF category: Malaysian/PR under 60, Malaysian citizen 60+, PR 60+, foreign worker, or no EPF.
- SOCSO category: First, Second, Foreign, or not covered.
- LINDUNG 24 Jam / SKBBK participation and EIS eligibility.
- PCB residency, tax category, qualifying children, disabled status, previous employment/current-year accumulations, reliefs and zakat.

## Calculation behavior

- EPF uses the KWSP Third Schedule effective 1 October 2025: Part A wage bands (RM20 bands through RM5,000 and RM100 bands through RM20,000), Part C, Part E and Part F rates. Above RM20,000 the published percentage method is used.
- SOCSO uses PERKESO's published Act 4 First/Second Category contribution bands and RM6,000 ceiling. The 2026 table includes employee Invalidity and SKBBK shares. Local SKBBK is controlled by the owner's employee participation setting; foreign-worker participation is mandatory. Phase 1 (0.75%) is used from June 2026 to May 2028, Phase 2 (1.00%) from June 2028 to May 2031, and Phase 3 (1.25%) from June 2031.
- EIS preview uses the Second Schedule wage-band midpoint at 0.2% for each share, up to the RM6,000 wage ceiling. It is automatically excluded for foreign workers and 60+ EPF categories; the owner must confirm other eligibility exceptions.
- PCB uses the HASiL 2026 computerized MTD ordinary monthly remuneration formula, including resident/non-resident handling, employee category, standard personal/spouse/child/disabled reliefs, prior-year-to-date accumulations, EPF qualifying cap, SOCSO relief cap, previous PCB and zakat.
- Monthly recurring commission is treated as normal monthly remuneration. Non-monthly bonus, arrears, director fees, employer-borne tax and other additional remuneration require HASiL's separate additional-remuneration formula and are not automated by this release.

## Safety controls

- Each payroll run has one employee summary row. Statutory deductions and employer contributions are stored only on that row, not duplicated on every Work Order.
- Employee and employer contributions are separate. Employer contributions do not reduce employee net pay.
- Payroll approval is blocked until every employee summary row is reviewed. An incomplete profile can still use owner-entered statutory values, but they must be saved and reviewed.
- Approved/paid payroll remains locked. Changes require a separate future adjustment workflow; this release does not edit finalized runs.
- A5 landscape payslips can be printed individually or in batch. Browser print dialog can save each page as PDF.

## Important limitations

This is a payroll calculation preview, not a statutory remittance service or a certified payroll product. Automatic statutory calculation is enabled for payroll periods from June 2026 onward. EPF/SOCSO/EIS use published schedule bands, but still require checking against current official calculators and employee-specific exemptions/coverage. PCB covers ordinary monthly remuneration; the full TP1/TP3 relief catalogue, education/disabled-child relief variants, non-monthly additional remuneration, tax-borne-by-employer gross-up and all edge cases are not automated. Allowance types are currently treated as ordinary remuneration for the preview; exempt travel/reimbursement items must be excluded by owner adjustment and official review. No KWSP, PERKESO, HASiL, CP39 or bank payment file is submitted.

The owner must verify calculations before approving payroll. The 2026 HASiL test scenarios include C-suite, Returning Expert Programme, Knowledge Worker, BIK/VOLA, quarterly director fees and detailed TP1 claims; those special cases are not fully automated here. The software does not provide legal or tax advice.

## Official reference basis checked for this release

- KWSP Third Schedule, effective 1 October 2025: https://www.kwsp.gov.my/documents/d/guest/third_schedule_from_-1-october-2025
- PERKESO Act 4 contribution table including SKBBK (effective June 2026): https://www.perkeso.gov.my/images/lindung/lindung-24-jam/NewContributionRateIncludingSKBBK.pdf
- PERKESO Foreign Worker eligibility / contribution: https://www.perkeso.gov.my/en/our-services/protection/foreign-worker
- PERKESO EIS Act 800 Second Schedule / wage-ceiling update: https://www.perkeso.gov.my/images/arahan/011024%20-%20EMPLOYERS%20CIRCULAR%20NO.%203%20YEAR%202024%20-%20INCREMENT%20OF%20THE%20WAGE%20CEILING%20FOR%20MONTHLY%20CONTRIBUTIONS%20FROM%20RM5K%20TO%20RM6K.pdf
- PERKESO LINDUNG 24 Jam: https://www.perkeso.gov.my/en/our-services/protection/lindung-24-jam.html
- HASiL PCB 2026 computerized calculation specification: https://www.hasil.gov.my/wp-content/uploads/spesifikasi-kaedah-pengiraan-berkomputer-pcb-2026.pdf
- HASiL MTD Testing Questions 2026: https://www.hasil.gov.my/wp-content/uploads/mtd-testing-question-2026.pdf
- HASiL MTD Testing Question 2026: https://www.hasil.gov.my/wp-content/uploads/mtd-testing-question-2026.pdf
