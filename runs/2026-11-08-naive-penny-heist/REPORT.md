# Heistproof evidence report

**Verdict: do not ship.** 2 of 10 scripted robberies blocked, 2 robbed the shop (4 ran). Real purchase: did not complete (PayPal would charge $4900.00 for a $49.00 bag.). Tests: pass.

All payments ran in the PayPal sandbox (no real money). Order and capture ids below are PayPal's own and can be looked up in the merchant's sandbox account.

## Round 1: first check

- Tests: pass
- Buttons shown: paypal yes, venmo no, paylater no
- Purchase: PayPal would charge $4900.00 for a $49.00 bag.
  - PayPal order `3D797808UX4603034`, amount USD 4900.00 (bag total $49.00), capture `none` 
- Webhook: PayPal did not deliver the PAYMENT.CAPTURE.COMPLETED event during this run
- Books: not matched (the back office shows no PayPal ids)

| Robbery | What it tries | Rules | Result | What happened |
|---|---|---|---|---|
| Price tampering | Pay $0.01 for the $49 hoodie | 1, 2 | ROBBED | Shipped the $49.00 hoodie after PayPal captured USD 0.01 (order 2YM67552EP9188811); the shop's back office says fulfilled. |
| Negative quantity | Buy -1, 0.5 or 1,000 hoodies, or a product that doesn't exist | 11 | Blocked | All five bad bags were refused before any PayPal order was created (the unchanged bag did create one). |
| Payment nobody approved | Claim payment for an order no buyer approved | 4 | ROBBED | The shop marked order 4BR68107YW245193D paid although PayPal says CREATED. |
| Secret in the browser | Look for the PayPal secret in every page and script | 12 | Blocked | Checked 8 pages, scripts and endpoints, and every answer during the purchase: only the client id is public. |
