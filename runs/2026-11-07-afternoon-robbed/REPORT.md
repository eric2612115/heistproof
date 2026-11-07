# Heistproof evidence report

**Verdict: do not ship.** 2 of 10 attacks held, 8 robbed the shop. Real sandbox purchase: failed. Signed webhook: verified. Tests: pass.

All payments ran in the PayPal sandbox (no real money). Order and capture ids below are PayPal's own and can be looked up in the merchant's sandbox account.

## Round 0: first check

- Tests: pass
- Buttons shown: paypal yes, venmo no, paylater no
- Purchase: Capture COMPLETED; shop order FOG-4DAA45 is fulfilled with 2 labels.
  - PayPal order `0BU79938H4914314A`, amount USD 49.00 (bag total $49.00), capture `4J545854YB692811R` COMPLETED
- Signed PAYMENT.CAPTURE.COMPLETED webhook: verified and accepted (event WH-8UV08218TS906732V-77U00956CS805325H)

| Attack | Rules | Result | What happened |
|---|---|---|---|
| Pay $0.01 for the $49 hoodie | 1, 2 | ROBBED | Shipped the $49.00 hoodie after PayPal captured USD 0.01 (order 85T649862M925761T); the shop's back office says fulfilled. |
| Negative, fractional and fake items | 11 | HELD | All five bad bags were refused before any PayPal order was created. |
| Claim payment for an order nobody approved | 4 | ROBBED | The shop marked order 4K243350M9143235R paid although PayPal says CREATED. |
| Get it shipped on approval alone | 4, 8 | ROBBED | Order 0RA8125158363783V was approved but never captured, and the shop still marked it paid. |
| Double-click: capture twice at once | 8, 10 | ROBBED | Two simultaneous captures printed 2 labels for one payment. |
| Card declined at capture (PayPal negative testing) | 5 | ROBBED | PayPal answered 422 INSTRUMENT_DECLINED but the shop marked the order paid. |
| Forge PayPal's 'payment completed' webhook | 6 | ROBBED | A forged event marked an unpaid order paid. |
| Replay a real webhook to ship twice | 7, 8 | ROBBED | Replaying event WH-8UV08218TS906732V-77U00956CS805325H printed 3 extra shipping label(s). |
| Send 'approved' after 'completed' | 9 | ROBBED | The late 'approved' event printed 1 more shipping label(s) for order FOG-4DAA45. |
| Find the PayPal secret in the browser | 12 | HELD | Checked 5 pages and scripts: only the client id is public. |
