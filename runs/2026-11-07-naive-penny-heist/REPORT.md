# Heistproof evidence report

**Verdict: do not ship.** 0 of 1 attacks held, 1 robbed the shop. Real sandbox purchase: failed. Signed webhook: not delivered by the sandbox during this run. Tests: pass.

All payments ran in the PayPal sandbox (no real money). Order and capture ids below are PayPal's own and can be looked up in the merchant's sandbox account.

## Round 0: first check

- Tests: pass
- Buttons shown: paypal yes, venmo no, paylater no
- Purchase: PayPal would charge $4900.00 for a $49.00 bag.
  - PayPal order `69F35835DG0710354`, amount USD 4900.00 (bag total $49.00), capture `none` 
- Signed PAYMENT.CAPTURE.COMPLETED webhook: not delivered by the sandbox during this run

| Attack | Rules | Result | What happened |
|---|---|---|---|
| Pay $0.01 for the $49 hoodie | 1, 2 | ROBBED | Shipped the $49.00 hoodie after PayPal captured USD 0.01 (order 0MB647230C444021W); the shop's back office says fulfilled. |
