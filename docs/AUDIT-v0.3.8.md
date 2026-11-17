# Car Workshop POS — Audit & Improvement Report v0.3.8

**Baseline:** user-provided v0.3.5 ZIP, carried forward through v0.3.6 and v0.3.7  
**Delivery:** v0.3.8  
**Date:** 2026-11-12  
**Scope:** source-level hardening, login throttle persistence, audit coverage, money primitives, and MyInvois production fail-closed control. This is not a penetration test, accounting certification, LHDN approval, or production acceptance test.

## Executive summary

v0.3.8 continues the v0.3.7 codebase. It adds persistent SQLite login throttling, extends Audit Trail coverage to supplier accounting, credit notes, account administration, workshop settings and MyInvois operations, introduces integer-sen money primitives with unit tests, and prevents unsigned submissions to the MyInvois production environment.

**Do not treat this release as fully production-approved.** Dependencies could not be installed in this execution environment, so full TypeScript, Prisma Client generation/validation, ESLint, Next.js build, Electron packaging, migration against a real shop database, and end-to-end workflows remain unverified.

## Implemented in v0.3.8

| Area | Change | Verification |
|---|---|---|
| Login throttling | Replaced process-memory counter with SQLite `LoginThrottle` table; key is SHA-256 digest of normalized account name, not plaintext email. Counter update is an atomic SQLite upsert and survives app restart. | Source reviewed; SQL smoke test pending below |
| Audit Trail | Added events for credit notes/refunds, supplier invoice entry/payments/voids, payment vouchers create/void, user create/update/delete, customer creation, workshop settings changes, MyInvois submit/status and consolidated submissions. | Source review; route integration tests pending |
| Sensitive audit data | Password values/hashes and MyInvois secrets are excluded from audit details. Credential changes are represented only as a boolean. | Source review |
| Money | Added `toCents`, `fromCents`, `roundMoney`, `addMoney`, `multiplyMoney`; shared `money()` rounding now delegates to the integer-sen primitive. | 5 Node built-in unit tests passed |
| MyInvois | Production submission is blocked with HTTP 501 until XAdES signing using the taxpayer's valid Malaysian organisation certificate is implemented and verified. Applies to individual invoices, consolidated invoices and credit notes. | Source review; no certificate provided, no LHDN submission performed |
| Version | Updated package version and sidebar display to `0.3.8`; added `npm test`. | Metadata check |

## Critical accounting limitation — database is still Float

The Prisma schema continues to store monetary columns as SQLite `REAL` / Prisma `Float`. The new cents helpers reduce rounding drift in calculations but **do not convert historical persisted records to integer cents**. A full schema migration is intentionally not included because the data model has monetary and non-monetary quantities, tax rates, historical invoice snapshots, supplier records, payment/refund records, cash shifts, vouchers and consolidated e-Invoices. A safe migration requires:

1. Close the POS and create a verified database + uploads backup.
2. Copy the database to a separate test environment.
3. Produce a field-by-field migration map distinguishing money, quantity, percentage and measurement fields.
4. Convert RM values to integer sen with a deterministic rounding rule.
5. Generate a reconciliation report comparing row counts, document totals, paid balances, credit notes, cash-shift expected/count/variance, supplier balances, tax totals and monthly consolidated totals.
6. Run dual-read/dual-calculation comparison and obtain owner sign-off.
7. Only then schedule the production migration with a tested rollback path.

**Never run a blind `Float` → `Int` database type change or `prisma db push --force-reset` against a live shop database.**

## MyInvois production status

The current project builds UBL-like JSON and submits it to MyInvois, but it does not implement certificate-backed XAdES signing. The official MyInvois SDK states that Submit Documents accepts signed documents and specifies an approved Malaysian X.509 certificate and XAdES/RSA/SHA-256 signature requirements. Therefore v0.3.8 deliberately blocks production submissions instead of transmitting unsigned documents. Sandbox use remains available for development, subject to current SDK validation rules.

Official references:
- MyInvois SDK — Digital Signature: https://sdk.myinvois.hasil.gov.my/signature/
- MyInvois SDK — Submit Documents: https://sdk.myinvois.hasil.gov.my/einvoicingapi/02-submit-documents/
- MyInvois SDK — FAQ: https://sdk.myinvois.hasil.gov.my/faq/

To complete production signing, the workshop must obtain a valid organisation certificate from a Malaysian-recognised CA. Private key material must be held in a protected OS certificate store or a secure signing service, not committed to the project, not pasted into chat, and never written to logs. The exact certificate format and secure custody mechanism must be selected before implementing the signer.

## Remaining findings — ordered by risk

### P1 — Required before production sign-off

1. **Integer-sen database migration:** still outstanding; schema fields remain Float/REAL.
2. **MyInvois XAdES signer:** intentionally not implemented without the taxpayer's approved organisation certificate and secure key custody. Production endpoints now fail closed.
3. **Full build and integration verification:** dependency installation timed out in this environment; no claim of passing TypeScript, ESLint, Prisma validation, Next.js build or Electron packaging.
4. **Real database upgrade:** test v0.3.5 → v0.3.8 on a duplicate of the actual shop database; validate automatic pre-upgrade backup and schema upgrade.
5. **Backup restore drill:** restore both SQLite database and uploaded images to an isolated machine, run integrity checks, and reconcile customers, vehicles, work orders, invoices, payments, stock, suppliers, vouchers and e-Invoice references.
6. **Audit transaction coupling:** audit writes currently occur after some business mutations and the helper intentionally does not roll back completed business operations if audit persistence fails. High-assurance deployments should write audit records within the same database transaction or use a durable outbox.
7. **Network exposure:** if the POS is reachable beyond a trusted LAN, add deployment-level HTTPS, firewall restrictions, rate limits for public QR/e-Invoice endpoints, and monitoring. The account throttle is per account, not a global IP/device abuse control.

### P2 — Next quality release

8. Add API integration tests for role enforcement, state transitions, payments/refunds, stock movements, supplier invoice voids, cash-shift reconciliation and audit coverage.
9. Add customer/vehicle edit/delete audit coverage and full settings diff coverage without capturing secrets or unnecessary personal data.
10. Add audit export, filtering, retention policy and tamper-evident daily hash/signature if required by the accountant.
11. Add a verified backup/restore command and scheduled restore drill. A successful backup file write alone is not a restore test.
12. Add CI: `npm ci`, `npm test`, `npx prisma validate`, `npx prisma generate`, `npm run lint`, `npm run typecheck`, `npm run build`, migration smoke tests and Electron packaging.
13. Add certificate expiry monitoring, MyInvois retry/idempotency controls, cancellation windows and production status polling after the signing implementation is completed.

## Verification performed in this environment

- `node --test tests/*.test.mjs`: **5 tests passed** for integer-sen conversion, positive/negative half-sen rounding, money addition, fractional quantity multiplication and safe integer range.
- Source inspection confirmed the existing schema still has Float monetary columns.
- `npm ci --ignore-scripts --no-audit --no-fund`: dependency install could not complete because the environment could not resolve `registry.npmjs.org` (`EAI_AGAIN`). A separate lockfile audit also found the checked-in lockfile is incomplete and inconsistent with `package.json`: it omits `@tesseract.js-data/eng`, `tesseract.js`, `@types/qrcode`, `electron`, and `electron-builder`, and pins Next / eslint-config-next to 15.3.2 while `package.json` specifies 15.3.9. Do not use `npm ci` until the lockfile is regenerated on a network-enabled machine.
- Therefore TypeScript, ESLint, Prisma validation/generation, Next.js production build, Electron packaging and real database migration were not run.

## Upgrade / test procedure

1. Keep the existing production application and database untouched.
2. Make a separate copy of the SQLite database **and** uploads directory.
3. Extract v0.3.8 into a new folder; do not overwrite the old application folder.
4. On a network-enabled machine, run `npm install` to regenerate `package-lock.json` from `package.json`; review and commit the new lockfile. Then run `npm ci` from that regenerated lockfile.
5. Run `npm test`, `npx prisma validate`, `npx prisma generate`, `npm run lint`, `npm run typecheck` and `npm run build`.
6. Point a test copy of the application at the duplicated database and start it. Confirm the schema upgrader creates `LoginThrottle` and keeps all old records.
7. Verify five invalid logins produce a temporary 429 lock; restart the app and verify the lock still applies; wait for expiry and confirm correct login works.
8. Verify audit entries for supplier invoice create/payment/void, voucher create/void, credit note/refund, user changes, customer creation, shop settings and MyInvois sandbox submit/status.
9. Verify production MyInvois mode returns `501 PRODUCTION_SIGNING_NOT_AVAILABLE` and does not call the submit API.
10. Restore the duplicated database and uploads to a second isolated location and reconcile records before any production cutover.
11. Package and test the Windows Electron installer only after the above checks pass.

## Release decision

**v0.3.8 is a hardening / controlled-test release, not a final production approval.** It improves login throttling, operational audit visibility and monetary rounding, and closes the unsigned MyInvois production submission path. Integer-cent database migration, certificate-backed XAdES signing, full integration tests and a successful restore drill remain outstanding.
