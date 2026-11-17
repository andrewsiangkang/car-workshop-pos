# Car Workshop POS — Audit & Improvement Report v0.3.7

**Baseline:** v0.3.5 user-provided project and v0.3.6 security patch  
**Delivery:** v0.3.7  
**Date:** 2026-11-12  
**Scope:** source review and implementation of an owner-only operational audit trail. This is not a penetration test, LHDN certification, or production acceptance test.

## Executive summary

The project already contains the core workshop workflow: customer/vehicle records, work orders, inventory, counter payments and shifts, supplier invoices, reports, staff roles, backup tooling and MyInvois integration points. v0.3.6 fixed unauthenticated QR generation and public QR caching. v0.3.7 adds an append-oriented AuditLog table, owner-only audit-log API and UI, and records selected high-impact events.

The project is **not yet certified production-ready**. Dependency installation timed out in this environment, so TypeScript, ESLint, Prisma validation, Next.js production build, migration, backup restore, Electron packaging and business workflow tests could not be executed here.

## Implemented in v0.3.7

| Area | Change |
|---|---|
| Audit data | Added `AuditLog` model with actor snapshot, action, entity, summary, limited JSON metadata, timestamp and indexes |
| Access control | Added `/api/audit-logs`, protected by owner-only authorization and `private, no-store` response headers |
| Audit UI | Added `/audit-logs` owner-only navigation entry; shows latest 50 events and metadata |
| Inventory | Records item create/update/delete and stock IN/OUT/ADJUST events |
| Work orders | Records creation, invoice issuance, payment recording, buyer detail/reference changes, status changes and cancellation |
| Cash control | Records shift open/close, bank deposit confirmation/reversal and non-cash reconciliation |
| Electron packaging | Added a pre-package build step to generate the missing `prisma/template.db` from the current schema, then package it with the app |
| Version | `package.json`, lockfile root metadata and sidebar version updated to 0.3.7 |
| Existing patch | Retains v0.3.6 QR authentication/cache fix and `npm run typecheck` script |

Audit metadata is intentionally limited. Do not add passwords, session tokens, API secrets, full NRIC, bank account numbers or payment-card data to audit details. The audit table is append-only through the application interface, but a database administrator can still alter the SQLite file; protect the database and backups with OS permissions and off-device copies.

## Remaining findings — ordered by risk

### P1 — Must resolve before production sign-off

1. **Money is still stored in Float fields.** This release does not change historical financial storage. A safe conversion requires a full backup, offline copy, deterministic RM-to-sen migration, rounding/reconciliation report, dual-check totals and rollback procedure. Do not run a blind schema type change on the live database.
2. **Login/public form throttling is process-memory based.** Restarting the app clears the counters; multiple processes do not share them. Add SQLite-backed throttling with expiry/cleanup and lockout recovery controls before exposing the service to untrusted networks.
3. **MyInvois production trust/signing.** Validate current LHDN requirements, certificate custody, signing, token refresh, submission retry/idempotency, cancellation/credit-note windows and sandbox-to-production transition with the actual taxpayer account. Never store production secrets in source control or audit logs.
4. **Backup restore has not been demonstrated.** Restore a copy of the database and uploaded files to an isolated machine; reconcile counts, latest invoice, inventory and images. A successful backup write is not proof of a usable restore.
5. **Audit event coverage is partial.** Current release covers core stock, work-order, invoice/payment and counter events. Extend to customer/vehicle edits, supplier invoices, supplier payments/vouchers, user/role/password changes, shop/tax settings, backup/restore and MyInvois submit/status/cancel operations. Ensure audit writes are transactionally coupled to the business mutation for high-assurance deployments.
6. **Electron database schema lifecycle.** v0.3.7 generates the blank `prisma/template.db` before Electron packaging (the uploaded source ZIP did not contain the file referenced by the builder config). The existing startup schema upgrader now adds the AuditLog table and indexes transactionally after first making a SQLite backup; test this upgrade from a real v0.3.5 database before production use.

### P2 — Important quality work

7. Add automated integration tests for authorization, invoice numbering, inventory deduction/reversal, partial/full payment, refund/credit note, shift reconciliation and audit event creation.
8. Add request-level schema validation consistently to all API routes; reject NaN, Infinity, negative or excessive quantities/prices and invalid state transitions.
9. Persist and export audit records with date/action/user filters; add retention and tamper-evident export (hash chain or signed daily export) if required by the business.
10. Add automated backup status/age checks and a documented restore drill schedule.
11. Add CI pipeline: install, Prisma validate/generate, lint, typecheck, build, migration smoke test and API integration tests.

## Database upgrade instructions

1. Close the POS application and make a separate copy of the existing SQLite database and uploads directory.
2. Install v0.3.7 dependencies using the project's lockfile.
3. Set `DATABASE_URL` to the intended database file.
4. Run `npx prisma validate` and `npx prisma generate`.
5. On existing shop databases, the application startup upgrader adds the `AuditLog` table and indexes after creating a pre-upgrade backup. For a manual development database sync, `npx prisma db push` may also be used. Test the automatic upgrade first on a copy of the production database and verify all existing records remain present.
6. Start v0.3.7, sign in as OWNER, and open **Audit Trail**. Confirm the page loads and test one harmless inventory change; verify the event appears.
7. Only replace the production database after a verified backup and successful isolated upgrade.

Do not use `prisma db push --force-reset`; it can destroy data.

## Release verification checklist

- [ ] `npm ci`
- [ ] `npx prisma validate`
- [ ] `npx prisma generate`
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] Upgrade a copy of a real v0.3.5 database to v0.3.7 without data loss
- [ ] Confirm `/api/audit-logs` returns 401 when logged out and 403 for non-owner
- [ ] Confirm owner can view audit trail; staff cannot see the menu or call the API
- [ ] Confirm stock create/edit/delete/adjustment generates expected audit entries
- [ ] Confirm work-order create/invoice/payment/status/cancel generates expected audit entries
- [ ] Confirm cash shift open/close/deposit/reconciliation generates expected audit entries
- [ ] Verify audit details do not expose credentials or sensitive identity data
- [ ] Restore database and uploads to an isolated location and reconcile records/files
- [ ] Run `npm run electron:dist` and confirm the generated `prisma/template.db` is included in the installer
- [ ] Test Electron install, upgrade, restart, LAN access and data retention
- [ ] Test MyInvois sandbox end-to-end; obtain separate tax/compliance sign-off before production

## Release decision

**v0.3.7 is a development/hardening release for controlled testing, not an unconditional production approval.** The new Audit Trail and QR security patch are implemented in source. The remaining P1 findings and release checklist above must be completed before using this build as the only production system.
