# Code Review: car-workshop-pos v0.3.27 (LHDN CF410 phone fix)

**Date:** 2026-11-14 · **Reviewers:** Tech Lead, 2 × Senior Dev (e-Invoice; orders/money/stock), QA, Security, Compliance (GRC/DPO), DevOps/SRE, UX, plus a completeness critic. Each role's findings were checked against the code by a separate verifier. Of 134 raw findings, none were refuted and several were downgraded. Duplicates are merged below.

**Verdict: Not ready.** Do not run it on a network that customers' phones join until C1 and C2 are fixed. The v0.3.27 phone fix works for normal numbers but leaves CF410 still reachable (see section V).

> The compliance items are a risk check, not legal advice. Have the LHDN and PDPA points confirmed by your tax agent or adviser.

**Status (v0.3.28):** fix-plan steps 1–3 are done, and C1 and C2 are fixed. See [CHANGELOG-v0.3.28-ZH.md](CHANGELOG-v0.3.28-ZH.md). The Medium "stale lockfile / broken lint" item is also fixed. Still open: everything from H1 down, plus Electron 33, which is end-of-life and has its own high advisories.

**Status (v0.3.29):** fix-plan steps 4–13 are done: every High item (H1–H11), the CF410 phone issue (section V), and the Medium / Low items in the same files. See [CHANGELOG-v0.3.29-ZH.md](CHANGELOG-v0.3.29-ZH.md). Still open (step 14): the remaining Medium / Low items, including Electron 33, non-cash rounding, reports / expenses, counter settlement, refund notes (type 04), submission idempotency, consolidated document size, audit-trail tamper evidence, PDPA customer export / delete, document numbers after a restore, i18n gaps and the 16 older lint problems.

**Status (v0.3.30):** fix-plan step 14 is done: every remaining Medium and Low item, including the move to Electron 45. The whole fix plan is now complete. A final cross-check by independent reviewers, and further review rounds on its fixes, found more problems where the changes meet; those are fixed too. See [CHANGELOG-v0.3.30-ZH.md](CHANGELOG-v0.3.30-ZH.md). Not covered here: production MyInvois submission stays blocked until XAdES signing exists (as before), and the LHDN document-lookup parameters could not be tried against LHDN from the test machine.

---

## Critical (fix before use)

**C1. [Security/DevOps] [electron/main.js:106](../electron/main.js): the server listens on `0.0.0.0` over plain HTTP, runs Next.js 15.3.9 on Windows, and customers are told to join the shop Wi-Fi.**
- **The problem:**
  - Every launch binds all network interfaces. There is no setting to turn this off.
  - Printed invoices and the README (`DocumentLayout.tsx:320`, `README.md:169`) tell customers to scan the QR code while on the shop Wi-Fi.
  - next 15.3.9 is affected by:
    - GHSA-p293-qw3h-jr36, an unauthenticated RCE on Windows-hosted servers (fixed in 15.5.24).
    - GHSA-2464-fhr4-w9xw and GHSA-2xp9-vwfh-vxw4, RCEs in the image optimiser.
    - GHSA-267c-6grr-h53f and GHSA-26hh-7cqf-hhc6, middleware bypasses.
    - Several Server Components DoS and SSRF advisories.
- **Impact:** any phone on that Wi-Fi can reach the POS server. That exposes the database (customer NRIC, TIN and phone numbers), the MyInvois client secret and the backups.
- **Fix:**
  - Upgrade `next` and `eslint-config-next` to ≥ 15.5.29 and regenerate the lockfile.
  - Bind to `127.0.0.1` by default. Make LAN access an explicit owner setting in the Connect panel.
  - Tell shops to put customers on a guest SSID that is isolated from the POS PC.
  - Set `images.unoptimized: true`.

**C2. [Security] [src/middleware.ts:72](../src/middleware.ts) and [src/app/(dashboard)/layout.tsx:15](../src/app/(dashboard)/layout.tsx): authentication is only checked in layouts.**
- **The problem:**
  - Middleware lets through any request that carries a cookie named `session`, whatever its value. Its own comment says the signature is not checked there.
  - The real session check runs only in `(dashboard)/layout.tsx`. The owner-only check runs only in the `suppliers/`, `supplier-invoices/`, `payment-vouchers/` and `settings/` layouts.
  - About 15 `page.tsx` files query Prisma with no check of their own. Examples: `vehicles`, `work-orders`, `service-reminders`, `suppliers/[id]`, `payment-vouchers/[id]`, `supplier-invoices/[id]`, `work-orders/[id]/invoice`, `credit-notes/[cnId]`. `customers/page.tsx` treats a missing user as a normal staff member.
- **Why this is critical:** Next.js partial rendering does not re-run shared layouts on client navigation. The Next.js docs warn against relying on layout checks for this reason, and the middleware-bypass advisories make it worse. A forged cookie plus an RSC navigation request can therefore render a page without its layout check. The result is customer PII and owner-only finances visible to anyone on the LAN. *We did not reproduce this live; the finding is the code pattern combined with the documented Next.js behaviour.*
- **Fix:**
  - Add `requirePageUser()` and `requirePageOwner()` helpers and call them at the top of every page that touches Prisma.
  - Verify the HMAC and expiry in middleware with Web Crypto.

## High

**H1. [e-Invoice] [submit/route.ts:105](../src/app/api/myinvois/submit/route.ts) and [docdata.ts:113](../src/lib/docdata.ts): sandbox results are saved as if they were real e-Invoice state.**
- **The problem:**
  - Production submission is hard-blocked with a 501, and sandbox mode is the default (`schema.prisma:250`).
  - Every sandbox UUID, status and `consolidatedId` is written to the same columns real ones would use. No column records which environment produced it.
- **Impact:**
  - `consolidationPreview` skips those orders. Real sales then drop out of the monthly consolidated e-Invoice.
  - The printed QR is built from today's sandbox flag, not the one used at submission. Sandbox invoices print "verify on LHDN", and manually saved production UUIDs print a link to the test portal.
- **Fix:**
  - Add an `eInvoiceEnv` column and count only production records as live.
  - Build the QR from the stored environment.
  - Print a "SANDBOX – NOT A VALID e-INVOICE" banner on sandbox documents.

**H2. [Security/Compliance] [work-orders/[id]/route.ts:247](../src/app/api/work-orders/[id]/route.ts) and [myinvois/status/route.ts:28](../src/app/api/myinvois/status/route.ts): any staff login can set or overwrite an LHDN UUID or status.**
- **The problem:**
  - `save_einvoice` is open to staff. It sets the status to `valid` whenever a Long ID is supplied, and nothing checks the UUID with LHDN.
  - It also runs on cancelled orders, on consolidated orders and over an existing live UUID.
  - The status route writes results to whatever `submissionUID` and record id the client sends.
  - The audit entry does not keep the old or new UUID.
- **Impact:** a sale can be removed from consolidated reporting without trace.
- **Fix:**
  - Make both routes owner-only.
  - Use the stored `submissionUid` and reject a mismatch.
  - Refuse to overwrite a live UUID.
  - Save the status as `pending` until LHDN confirms it.
  - Audit the old and new values.

**H3. [e-Invoice] [consolidation.ts:65](../src/lib/consolidation.ts) and [consolidated/route.ts:97](../src/app/api/einvoice/consolidated/route.ts): a consolidated e-Invoice that LHDN marks invalid can never be resubmitted.**
- **The problem:**
  - Submitting sets `consolidatedId` on every covered order, and nothing ever clears it.
  - The preview only selects orders where `consolidatedId` is null.
  - So the "Resubmit" button always fails with "Nothing to consolidate".
- **Fix:** when a consolidated record turns invalid or cancelled, release its orders and credit notes, and add a test for submit → invalid → resubmit.

**H4. [Compliance] [consolidation.ts:75](../src/lib/consolidation.ts): invoices where the buyer filled in the QR form are left out of consolidation.**
- **The problem:** any order with `buyerRequestedAt` set is skipped, on the assumption that it will get its own e-Invoice. Production submission is blocked, so unless staff key the UUID in by hand, the sale is never reported. The buyer-request lock also never closes in production.
- **Fix:**
  - Add a month-end cut-off for buyer requests.
  - Add an owner action that records a consolidated e-Invoice submitted through the portal.
  - Alert on any request still waiting after N days.

**H5. [Dev/Compliance] [work-orders/route.ts:71-81](../src/app/api/work-orders/route.ts) and [work-orders/new/page.tsx:83](../src/app/(dashboard)/work-orders/new/page.tsx): a returning walk-in merges into, and renames, a random "N/A" customer.**
- **The problem:** the plate lookup fills the phone field with `N/A`. `findFirst({ phone: "N/A" })` then matches the oldest walk-in customer, and the typed name renames that customer. Any name change on the same phone also renames the customer silently. The walk-in fix claimed in a previous release does not hold.
- **Impact:** together with H6, the buyer name changes on past invoices.
- **Fix:**
  - Never match on `N/A` or an empty phone.
  - Ask the user before renaming an existing customer.

**H6. [Architect/Compliance] [docdata.ts:31,72-82](../src/lib/docdata.ts) and [credit-notes/[cnId]/page.tsx:55](../src/app/(dashboard)/work-orders/[id]/credit-notes/[cnId]/page.tsx): issued tax documents are rebuilt from live data.**
- **The problem:** invoices, receipts and credit notes read the current shop profile, customer and vehicle every time they are displayed.
- **Impact:** a reprint after any edit, including the H5 rename or an SST number change, shows different particulars from the original. That breaks invoice immutability.
- **Fix:** snapshot the seller, buyer and vehicle particulars when the invoice or credit note is issued, and render documents from that snapshot.

**H7. [Dev/Architect] [work-orders/route.ts:182-204](../src/app/api/work-orders/route.ts) and [credit-notes/route.ts:37](../src/app/api/work-orders/[id]/credit-notes/route.ts): stock is wrong in three ways.**
- Stock is deducted when the quotation is created, so quotes that never go ahead still hold stock until someone cancels them.
- Parts that were short at quote time are only written down as text in a note, so they are never deducted after restocking.
- Credit notes for returned parts never put them back in stock.
- **Fix:**
  - Deduct the outstanding quantity in the `generate_invoice` transaction.
  - Restock when a credit note covers returned parts.

**H8. [Critic] [credit-notes/route.ts:68](../src/app/api/work-orders/[id]/credit-notes/route.ts): credit-note SST is spread over the whole invoice.**
- **The problem:** the formula `amount × invoiceSST / invoiceTotal` is only correct when the SST scope is ALL.
- **Example:** with SST charged on labour only, crediting a returned RM900 part credits RM7.14 of SST that was never charged on that part. That figure prints on the credit note and goes into the LHDN credit-note payload.
- **Fix:** make the credit note state what it credits (lines, or a labour/parts split) and calculate SST on that taxable base.

**H9. [Compliance/Security] [electron/backup.js:126,152](../electron/backup.js) and [schema.prisma:133-140,249](../prisma/schema.prisma): data is stored and backed up in plaintext.**
- **What is exposed:** customer NRIC, TIN, address and email, plus the MyInvois client secret.
- **Where it goes:** the database and its backups are unencrypted, and backups are copied to USB, OneDrive or Google Drive folders. `GET /api/backup` is not audited, and uninstalling keeps all of it.
- **Fix:**
  - Encrypt backups with AES-GCM, using a key held in Electron `safeStorage`.
  - Keep the client secret in `safeStorage` instead of the database.
  - Audit backup downloads.

**H10. [DevOps] [electron/backup.js:258-265](../electron/backup.js): restore ignores a failed safety copy and overwrites the live database in place.**
- **The problem:** `runBackup` reports failure by returning `{ok:false}`, and restore discards that result. It then kills the server and copies straight over `workshop.db`.
- **Impact:** if the disk is full, the copy can truncate the live database while no safety copy exists. On error the server stays dead.
- **Fix:**
  - Abort if the safety copy fails.
  - Copy to a temp file, verify it with `quick_check`, then rename it over the live file.
  - Always relaunch the app, including after an error.

**H11. [UX] [VoidButton.tsx:13](../src/components/suppliers/VoidButton.tsx) and [StaffPanel.tsx:72](../src/components/settings/StaffPanel.tsx): `window.prompt()` does nothing in Electron.**
- **The problem:** Electron does not support `prompt()` and returns null.
- **Impact:** on the shop PC, clicking Void on a supplier invoice or payment voucher, or resetting a staff password, silently does nothing. Ex-staff cannot be locked out.
- **Fix:**
  - Replace `prompt()` with in-page modals.
  - Add a "Disable account" action.

---

## V. The v0.3.27 phone fix: what still fails CF410

Phone normalisation does reach every phone sent to LHDN: supplier, buyer, General Public and credit notes. The supplier-phone check, however, contains the four gaps below. The first three are Medium and the last is Low.

1. **[myinvois.ts:83-85](../src/lib/myinvois.ts): validation runs on a value that has already been normalised.**
   - `normalize("-")` returns `""`. `isValid("")` normalises again, gets `"NA"`, and passes.
   - So placeholders such as `-`, `NIL` and `TBA` get through and are sent as Supplier Telephone `NA`, which is CF410 again. LHDN allows `NA` only for the buyer phone on a consolidated e-Invoice.
   - Reproduced with Node.
   - **Fix:** validate the raw value, and reject an empty result or a placeholder.
2. **[myinvois.ts:287](../src/lib/myinvois.ts): the buyer phone is never validated.**
   - A walk-in customer has the phone `N/A`, so a QR buyer request produces Telephone `NA` on an individual e-Invoice.
3. **[myinvois-phone.mjs:11](../src/lib/myinvois-phone.mjs): the output is not guaranteed to be E.164.**
   - `03-1234 5678 ext 12` becomes `+6031234567812`, and it passes.
   - `+60 (0)12-345 6789` becomes `+600123456789`, and it passes.
   - `6591234567` (no plus sign) and `+0123456789` both pass.
   - **Fix:** require a leading `+`, strip a trunk `(0)`, reject extensions and multiple numbers, and use the regex `^\+[1-9]\d{7,14}$`.
4. **Low.** The error text says "no spaces or symbols", but those are now stripped automatically. It also names a Settings tab that does not exist, and the check only runs at submit time. Validate when Settings are saved instead.

The new tests cover only the happy paths. Add the cases above.

---

## Medium

**Money and stock**
- [work-orders/[id]/route.ts:186](../src/app/api/work-orders/[id]/route.ts) and [OrderActions.tsx:88](../src/components/work-orders/OrderActions.tsx): 5-sen rounding is applied to card, TNG and transfer payments, always on the first row of a split payment. That row can become zero or negative, and the receipt says "Rounded Cash Total".
- [credit-notes/route.ts:50](../src/app/api/work-orders/[id]/credit-notes/route.ts): an invoice that was rounded down at payment can never be fully credited. For example, a total of 100.02 paid as 100.00 rejects both refund amounts.
- [work-orders/route.ts:124](../src/app/api/work-orders/route.ts): a quantity of 0 or blank previews as RM0.00 but is saved and charged as 1, and 1 unit is deducted from stock.
- [vehicles/lookup/route.ts:11](../src/app/api/vehicles/lookup/route.ts): the lookup does not remove spaces, but saving does. Typing "WXY 1234" therefore treats an existing car as new and moves it to a new walk-in customer.
- [supplier-invoices/[id]/void/route.ts:53](../src/app/api/supplier-invoices/[id]/void/route.ts): voiding a supplier invoice reverses the quantity but keeps the cost and selling price it overwrote.
- [reports/page.tsx:25-27](../src/app/(dashboard)/reports/page.tsx): the `Expense` table is never written to, so operating expenses always show RM0. Revenue is attributed by the last `paidAt` instead of the Payment ledger.
- [counter/[id]/page.tsx:49](../src/app/(dashboard)/counter/[id]/page.tsx): a closed day's settlement report stops adding up after a drawer voucher is voided. Line 151 also shows staff the boss-only bank deposit and voucher payees.

**e-Invoice**
- [credit-notes/[id]/einvoice/route.ts:83](../src/app/api/credit-notes/[id]/einvoice/route.ts): credit notes that pay money back are sent as type 02 (credit note) instead of 04 (refund note).
- [myinvois.ts:434](../src/lib/myinvois.ts): submission is not idempotent and has no timeout. A double click, a second device, or a retry after a hang can create duplicate valid e-Invoices.
- [myinvois.ts:403](../src/lib/myinvois.ts): the consolidated e-Invoice uses one line per invoice. It exceeds LHDN's 300 KB per-document limit at roughly 330–440 invoices a month.
- [myinvois.ts:473](../src/lib/myinvois.ts) and [myinvois-errors.ts:76](../src/lib/myinvois-errors.ts): an "invalid" result never shows LHDN's reason, and phone, address and email errors are labelled as TIN problems.
- [myinvois.ts:253,275](../src/lib/myinvois.ts): a 12-digit SSM registration number is sent as an NRIC, and a customer-record TIN is paired with an unchecked ID.
- [consolidation.ts:75](../src/lib/consolidation.ts): customers with a TIN on file, such as fleet accounts, are reported as "General Public".

**Security**
- [auth.ts:86](../src/lib/auth.ts): logins and 7-day session cookies travel over plain HTTP on shared Wi-Fi, and logout or idle timeout never revokes a token.
- [auth/setup/route.ts:7](../src/app/api/auth/setup/route.ts): before the owner finishes first-run setup, any LAN device can claim the owner account, including through DNS rebinding.
- [auth/login/route.ts:30](../src/app/api/auth/login/route.ts): the login throttle checks and then acts, so parallel requests bypass it. Any LAN device can also lock the boss out.
- [public/einvoice/[token]/route.ts:35](../src/app/api/public/einvoice/[token]/route.ts): the QR link never expires, and anyone holding the receipt can overwrite the buyer's TIN, NRIC and address, even after staff have entered them.

**Compliance**
- [shop/route.ts:101](../src/app/api/shop/route.ts) and [audit.ts:19](../src/lib/audit.ts): the audit trail has gaps (settings, backups, security events), records no before/after values, and is not tamper-evident even though it is labelled "Immutable". The IP column comes from a header the client can spoof.
- [backup.js:238](../electron/backup.js): restoring a backup rolls back invoices, payments and the audit log, then reissues invoice numbers that were already used. Nothing records that a restore happened.
- [customers/route.ts:6](../src/app/api/customers/route.ts): under PDPA there is no way to correct, delete, anonymise or export one customer's data, and no retention schedule exists.
- [BuyerRequestForm.tsx:69](../src/components/einvoice/BuyerRequestForm.tsx): the public form collects NRIC, TIN and address with a one-line notice that falls short of PDPA s.7, and no consent is recorded.
- [work-orders/route.ts:19](../src/app/api/work-orders/route.ts): every staff session can bulk-read buyer NRIC and TIN, and LHDN TIN lookups are not audited.
- [DocumentLayout.tsx:117,133](../src/components/documents/DocumentLayout.tsx): a template setting can hide the SST registration number while SST is still charged, and invoices carry no customer address.
- [inventory/[id]/route.ts:50](../src/app/api/inventory/[id]/route.ts): deleting an inventory item wipes its stock-movement history, even though the code cites the 7-year retention rule.
- [electron-builder.yml:9](../electron-builder.yml): the installer ships LGPL-3.0 libvips (bundled with sharp) and Apache-2.0 and MIT components without licence texts or a third-party notices file. No GPL or AGPL code was found.

**DevOps**
- [package-lock.json](../package-lock.json) is stale: it records next 15.3.2 instead of 15.3.9 and is missing electron, electron-builder, tesseract.js, `@tesseract.js-data/eng` and `@types/qrcode`.
  - `npm ci` fails.
  - CI runs `npm install` with a `contents: write` token and runs no tests ([build-windows.yml:29](../.github/workflows/build-windows.yml)).
  - The installer is unsigned, and the updater does no integrity check (line 41).
- [eslint.config.mjs](../eslint.config.mjs) uses the eslint-config-next 16 flat-config import, but the project pins 15.3.9, so `npm run lint` crashes.
- [package.json:45](../package.json): Electron 33 and its Node 20 runtime are end-of-life, and they run the server that faces the LAN.
- [electron/main.js:111](../electron/main.js): server output goes to `stdio: "ignore"`, so the packaged app keeps no logs, and crash restarts have no backoff, limit or record.
- [backup.js:126](../electron/backup.js): automatic backups are a plain copy of the live SQLite file. Use `VACUUM INTO` or the SQLite backup API to get a consistent snapshot.
- [backup.js:71](../electron/backup.js): retention is a fixed count on the same disk. The backups are unencrypted, and the copy is synchronous.
- [backup.js:239](../electron/backup.js): restore only works from this PC's auto-backup folder, and needs a working database and an owner login.
- [schema-upgrade.ts:11](../src/lib/schema-upgrade.ts) is a hand-maintained copy of the schema. It currently matches `schema.prisma`, but nothing guards that, and failures are swallowed and never retried.
- [install.bat:40](../install.bat): the documented source install fails, and it runs the dev server as the shop's production server.

**QA and code quality**
- [tests/](../tests/): 11 of the 25 passing tests only grep source text. There are no tests for `computeTotals`, UBL payload totals, counter reconciliation or schema-upgrade idempotency.
- [work-orders/[id]/page.tsx:29](../src/app/(dashboard)/work-orders/[id]/page.tsx): money and e-Invoice rules are duplicated across pages, routes and client components, and the copies already differ (`isLive` is defined 5 times).

**UX**
- [LanguageProvider.tsx:14](../src/components/layout/LanguageProvider.tsx): the invoice, credit-note and voucher pages are never translated, and most error text is missing from the dictionary.
- [credit-notes/[cnId]/page.tsx:55](../src/app/(dashboard)/work-orders/[id]/credit-notes/[cnId]/page.tsx): the printed credit note shows the walk-in customer, while LHDN receives the buyer the customer entered by QR.
- [einvoice-request.ts:113](../src/lib/einvoice-request.ts): the customer form requires a TIN that most individuals don't know, and gives no reason when a field is rejected.
- [inventory/page.tsx:190](../src/app/(dashboard)/inventory/page.tsx): on phones, the inventory Actions column and the work-order Amount column are cut off.
- [IdleLogout.tsx:71](../src/components/layout/IdleLogout.tsx): the 5-minute idle logout throws away a half-filled work order.

## Low / nice-to-have
- [money-core.mjs:6](../src/lib/money-core.mjs): `roundMoney` is not consistently half-up above about RM2, so SST is sometimes 1 sen low. For example, 36.25 × 6% gives 2.17 instead of 2.18.
- [schema.prisma:91](../prisma/schema.prisma): document numbers have no unique index. Numbering is still safe under SQLite's serialisable writes.
- [work-orders/[id]/route.ts:324](../src/app/api/work-orders/[id]/route.ts): cancel and submit check status on a read taken outside the transaction.
- [CounterPanel.tsx:339](../src/components/counter/CounterPanel.tsx): the cash count is not blind; staff see the expected cash while counting.
- [CreditNotePanel.tsx:123](../src/components/work-orders/CreditNotePanel.tsx): credit notes are issued, and staff promoted to boss, on a single tap with no confirmation.
- [ServiceRemindersClient.tsx:65](../src/components/service-reminders/ServiceRemindersClient.tsx): WhatsApp reminders have no consent or opt-out record, are English-only, and can greet "Walk-in (PLATE)".
- [electron/main.js:283](../electron/main.js): `shell.openExternal` has no URL-scheme allowlist, and there is no navigation guard.
- [seed-demo.js:27](../scripts/seed-demo.js): the demo build ships fixed boss credentials and listens on the LAN. [start.bat](../start.bat) runs `next dev` on all interfaces with the hard-coded fallback secret.
- `zod` is a runtime dependency that is never imported and carries a high CVE. Remove it.
- Housekeeping:
  - The root `LanguageProvider.tsx` is a stale fork.
  - Docs are duplicated between the root and `docs/`.
  - `tsconfig.tsbuildinfo` is committed.
  - The README links to `docs/AUDIT-v0.3.12.md`, which does not exist.
- Time zones are mixed: reports and CSV export use the PC's time zone, while document numbers and consolidation use a fixed UTC+8.
- Smaller items:
  - `copy-ocr.js` can let a release ship without OCR and still pass.
  - First-run copying of the template database is not atomic.
  - The public form accepts addresses and cities longer than LHDN's limits.
  - Deleting an inventory item fails silently when the server refuses.

---

## Test results

| Check | Result |
|---|---|
| `npm test` (node --test) | **25/25 pass**. 11 of these assert on source text rather than behaviour. |
| `tsc --noEmit` (after `npm install --ignore-scripts` + `prisma generate`, on a scratch copy) | **Pass**, 0 errors |
| `npm run lint` | **Broken**: `ERR_MODULE_NOT_FOUND eslint-config-next/core-web-vitals` (config written for v16) |
| eslint with a corrected FlatCompat config (scratch copy only) | 52 errors, 7 warnings, all style-level: 23 `no-require-imports` in CommonJS electron/scripts, 15 `no-explicit-any`, 12 unused variables, `<img>` warnings. No hooks or correctness rules fired. |
| `npm ci` | **Fails**: lockfile out of sync with package.json |
| `npm audit` (prod, resolved tree) | 7 vulnerabilities: 1 critical (next), 6 high (next, postcss, sharp, zod, prisma/deepmerge-ts) |
| Licences (from lockfile) | No GPL/AGPL. LGPL-3.0 libvips binaries via sharp (prod). MPL-2.0 in dev dependencies only. |
| Phone normaliser edge cases (node) | `-`, `NIL`, `TBA` → sent as `"NA"`. `ext 12` and `(0)` forms → invalid numbers accepted. |

## Fix plan (critical first, smallest safe change in each step)
1. **Dependencies:**
   - Bump `next` and `eslint-config-next` to ≥ 15.5.29 and regenerate `package-lock.json`.
   - Fix `eslint.config.mjs` for v15.
   - Remove `zod`.
   - Run `npm test`, `tsc --noEmit` and `next build`.
2. **Network exposure:** bind `127.0.0.1` by default and add an owner toggle for LAN access in the Connect panel. Document the guest-Wi-Fi setup in the README.
3. **Page auth:** add `requirePageUser()` and `requirePageOwner()` to every page that touches Prisma, and verify the HMAC in middleware.
4. **e-Invoice references:** make `save_einvoice` and the status route owner-only, match the stored `submissionUid`, refuse to overwrite a live UUID, and audit the old and new values.
5. **Phone fix (v0.3.27):** validate the raw value, reject placeholders, require E.164 output, validate the buyer phone, and add tests.
6. **Environment tracking:** add an `eInvoiceEnv` column, count only production records as live, build the QR from the stored environment, and print a sandbox banner.
7. **Consolidation:** let an invalid consolidated e-Invoice release its orders for resubmission, and add a month-end cut-off for buyer requests.
8. **Walk-ins:** stop matching on the `N/A` phone, stop silently renaming customers, and normalise plates in the lookup.
9. **Restore:** abort if the safety copy fails, then copy to a temp file, verify and rename. Take backups with `VACUUM INTO`.
10. **Electron dialogs:** replace `prompt()` with modals for Void and Reset password, and add "Disable account".
11. **Stock and credit notes:** deduct stock at invoice time, restock on credit notes, and calculate credit-note SST by scope.
12. **Document snapshots:** store seller, buyer and vehicle particulars on invoices and credit notes.
13. **Encryption:** encrypt backups and the MyInvois secret with `safeStorage`.
14. **Everything else:** work through the Medium and Low items. Add behavioural tests for `computeTotals`, the UBL totals, the counter and schema-upgrade.
