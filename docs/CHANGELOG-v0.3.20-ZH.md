# v0.3.20 — Cash-only Manual & Automatic Rounding

- Added WorkOrder.roundingAdjustment with additive SQLite schema upgrade.
- Automatic cash rounding to the nearest RM0.05 when cash settles the full remaining balance.
- Manual cash rounding accepts adjustments from -RM0.02 to +RM0.02, provided the final amount is a RM0.05 multiple.
- Rounding is unavailable for non-cash and mixed-method payments; electronic payments remain exact.
- The original invoice total and tax amount remain unchanged. The rounding difference is stored separately and included in the cash payment applied.
- Receipt displays Invoice Total, Rounding Adjustment and Rounded Cash Total as separate lines.
- Cash received/change calculations use the rounded cash amount.
- Server validates eligibility and adjustment independently; UI validation is not trusted as the only guard.
