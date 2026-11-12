# Car Workshop POS — Audit & Change Report v0.3.9

## Change summary

- Added a built-in searchable MSIC picker to Settings → Tax / MyInvois.
- Added a local automotive activity shortlist searchable by five-digit code, English description, and common English/Bahasa Malaysia keywords.
- Selecting an activity fills both `msicCode` and `msicDesc`; existing manual editing remains available.
- Existing saved MSIC selection is shown when Settings is reopened.
- The public customer e-Invoice request form now explicitly tells buyers that they do not need to look up or enter an MSIC code.
- Added tests for five-digit format, uniqueness, and key automotive descriptions.
- Updated application version to `0.3.9`.

## Automotive MSIC entries included

`00000`, `45101`–`45109` (selected motor vehicle sales categories), `45201`–`45205` (maintenance, repair, painting, washing, seats, accessories), `45300` (motor vehicle parts/accessories), `45401`–`45403` (motorcycles, motorcycle parts, repair and maintenance), `52212` (towing/roadside assistance), `77101`–`77102` (vehicle rental).

## Compliance note

MSIC is a five-digit classification describing the taxpayer/supplier's business activity. This setting supplies the workshop/seller MSIC value used in its MyInvois supplier details. It is not a required buyer field on an ordinary customer e-Invoice request form. The included list is a focused automotive shortlist, not the complete MSIC directory. The workshop must select the activity that matches its actual registered business activity; the POS must not guess a customer's or workshop's legal classification.

Official reference: https://sdk.myinvois.hasil.gov.my/codes/msic-codes/
Official JSON directory: https://sdk.myinvois.hasil.gov.my/files/MSICSubCategoryCodes.json

## Validation

- Automated shortlist tests: run with `npm test`.
- TypeScript / Next.js production build: not verified in this environment because project dependencies are not installed and package registry access is unavailable.
- No database schema change was required; existing `ShopProfile.msicCode` and `ShopProfile.msicDesc` fields are reused.
