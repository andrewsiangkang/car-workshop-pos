# Car Workshop POS v0.4.0 — Workshop Management Foundation

## Changes
- Add a Workshop Board with quoted, confirmed, in-progress and completed lanes.
- Add job priority (Low / Normal / High / Urgent) and estimated completion date.
- Add technician assignment using enabled TECHNICIAN accounts.
- Record work-order creation and status transitions in an append-only workshop timeline.
- Stamp the first actual start time when a work order enters In Progress.
- Add additive SQLite schema upgrade entries for the new fields, table and indexes.
- Preserve the existing POS, payments, inventory, documents, e-Invoice, counter and backup workflows.

## Database safety
- Existing WorkOrder rows receive priority=NORMAL by a SQLite column default.
- Existing work orders are not given synthetic timeline entries.
- The existing pre-upgrade VACUUM INTO backup and transactional schema-upgrade mechanism remains in use.
- No existing table or column is dropped or rewritten.

## Verification
- Run `node --test tests/*.test.mjs`.
- With dependencies installed, run `npm run typecheck`, `npm run lint`, `npm run build`, and the Prisma schema-upgrade parity test.
- Run a copy-of-production-database upgrade rehearsal before any customer rollout.

## Not included in this foundation release
Appointment calendar, vehicle inspection/photos, parts reservation/issue/return, technician time logs, service bays, customer-facing repair portal and advanced workshop analytics are planned as subsequent v0.4.x steps.
