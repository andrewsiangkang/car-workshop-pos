# v0.3.18 — Business Intelligence & International Foundation

## Business Intelligence
- Expanded owner-only Reports into Business Intelligence.
- Added 12-month collections trend, revenue mix, estimated gross profit, recorded operating expenses and estimated net profit.
- Added top selling work items and assigned-technician paid-job summaries.
- Kept period filters for month, quarter and year.

## International foundation
- Added ShopProfile defaults: countryCode, currencyCode, locale, timeZone and taxLabel.
- Added International settings tab with supported country/currency/locale presets.
- Existing shops default safely to Malaysia / MYR / en-MY / Asia/Kuala_Lumpur / SST.
- Added additive SQLite schema upgrade and validated API allowlists.

## Important limitations
- Currency selection is currently stored as workshop configuration; it does not yet convert historical records or automatically switch every existing document/report formatter.
- Tax label is configuration metadata only. Country-specific tax rules and e-invoice integrations require separate implementation and local compliance validation.
- Profit is estimated from recorded data and excludes costs that have not been entered into the Expense module.
