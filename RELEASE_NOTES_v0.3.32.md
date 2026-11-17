# Car Workshop POS v0.3.32

## Changes
- Block individual e-Invoice submissions when a walk-in buyer is represented as General Public.
- Validate buyer identity, name, Malaysian city/state, phone and address lengths before submission.
- Use classification 004 for credit notes that adjust a reported consolidated e-Invoice.

## Verification
- Focused e-Invoice unit test: tests/einvoice2-ubl.test.mjs
