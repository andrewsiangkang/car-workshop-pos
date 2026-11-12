# v0.3.19 — Cash Change & Payment Precision Fix

- Fixed split-payment validation to compare integer sen instead of floating-point values.
- A cash tender greater than the payment amount is accepted; the difference is recorded as change to return.
- The payment applied to the invoice remains the amount due, not the cash tendered.
- The payment success notice clearly shows the change to return to the customer.
- Receipt payment details show Cash Received and Change Returned to Customer.
- API-side remaining-balance and split-total validation now use integer sen.
