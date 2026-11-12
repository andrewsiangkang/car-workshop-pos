# v0.3.21 — Rounding for All Payment Methods

- Expanded automatic and manual nearest-RM0.05 rounding from cash-only to all payment methods.
- Supports cash, e-wallet/TNG, card, bank transfer and split/mixed payments.
- Rounding remains available only when the current payment fully settles the remaining invoice balance.
- Partial payments are not rounded.
- Rounding adjustment is applied to the first payment row and persisted separately on the work order.
- Cash received/change calculations continue to account for the adjusted cash amount when the first row is cash.
- Server-side validation independently enforces full-settlement eligibility and manual adjustment limits.
