# Car Workshop POS v0.5.0 — Professional Workshop Operations Foundation

## Scope
This release extends the v0.4.0 codebase without replacing the existing POS, customer, vehicle, invoice, payment, inventory, counter, SST, MyInvois, backup or audit modules.

## Added
- Appointment records with customer/vehicle ownership validation and technician/service-bay overlap checks.
- Vehicle check-in records with mileage, fuel level, keys, condition notes and belongings.
- Local workshop photo storage for check-in and inspection findings (JPG/PNG/WEBP, maximum 8 MB per image, SHA-256 metadata).
- Configurable general vehicle inspection template and digital inspection/finding records.
- Revisioned customer approval snapshots with per-line approve/decline decisions and expiring high-entropy approval links.
- Technician time logs with start/pause/resume/stop state handling.
- Work-order parts reservation, issue and return records integrated transactionally with inventory quantity and stock movements.
- QC checklists; a work order cannot move to READY without a passed QC record.
- Separate workshop workflow stage and append-only stage history, kept separate from financial WorkOrderStatus.
- Local SyncOutbox and SyncConflict schema foundation for future optional cloud sync. No cloud endpoint or automatic cloud transfer is enabled by this release.
- Appointments, check-in, inspections, technician/time and QC pages in the dashboard.

## Data safety
- Additive schema only: existing POS tables and records are retained.
- Existing work orders are assigned workflowStage `LEGACY` during upgrade; new work orders default to `WAITING`.
- No synthetic stage history is created for historical work orders.
- Local photos are stored under `WORKSHOP_DATA_DIR/workshop-photos`; this directory must be included in backup/restore operations.

## Known limitations / release gates
- Run Prisma schema validation, client generation, TypeScript typecheck, full automated tests and production-database-copy migration rehearsal before production rollout.
- Customer approval link page and token verification are implemented; secure public links must be delivered only through a channel controlled by the workshop.
- Photo upload API is implemented; photo capture UI and inspection PDF export remain follow-up work.
- Appointment-to-work-order conversion and drag/drop calendar are not included yet.
- Cloud sync is only a local queue/conflict schema foundation. A server, tenant identity, device registration, transport security, event contracts and conflict-resolution UI are required before enabling sync.
- QC checklist is available through the work-order API; dedicated editable QC UI remains follow-up work.
- Parts reservation is separate from stock deduction; stock is deducted only on issue and returned on explicit return.

## v0.5.2 — Payroll employee payslips
- Added individual employee A4 payslips for approved and paid payroll runs.
- Added per-employee print / Save as PDF workflow and batch printing with employee page breaks.
- Payslips include commission basis, rate, commission, basic salary, allowance, deduction, net pay, payroll period and approval/payment status.
- Owner remains responsible for commission settings and payroll approval; draft payroll cannot issue employee payslips.
- PDF output uses the browser print dialog (Save as PDF); statutory EPF/SOCSO/EIS/PCB calculations are not included.
