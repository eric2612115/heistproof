# Heistproof evidence report

**Verdict: safe to ship.** 10 of 10 attacks held, 0 robbed the shop. Real sandbox purchase: paid and shipped once. Signed webhook: verified. Tests: pass.

All payments ran in the PayPal sandbox (no real money). Order and capture ids below are PayPal's own and can be looked up in the merchant's sandbox account.

Coding agent: Claude Code (Meta Model API muse-wonder-1.0) with APIMatic's PayPal Context Plugin. Skills it loaded: heistproof:checkout-hardening, heistproof:paypal-web-sdk-v6, paypal:typescript-models, paypal:typescript-error-handling, paypal:typescript-calling-endpoints, paypal:typescript-integrate-paypal, paypal:typescript-getting-started.

## Round 0: first check

- Tests: pass
- Buttons shown: paypal yes, venmo no, paylater no
- Purchase: PayPal would charge $4900.00 for a $49.00 bag.
  - PayPal order `51C7658002134043V`, amount USD 4900.00 (bag total $49.00), capture `none` 
- Signed PAYMENT.CAPTURE.COMPLETED webhook: not delivered by the sandbox during this run

| Attack | Rules | Result | What happened |
|---|---|---|---|
| Pay $0.01 for the $49 hoodie | 1, 2 | ROBBED | The shop asked PayPal for USD 0.01 (order 54F25238NB109791R) after the browser said so. |
| Negative, fractional and fake items | 11 | HELD | All five bad bags were refused before any PayPal order was created. |
| Claim payment for an order nobody approved | 4 | ROBBED | The shop marked order 4KS28861CW3680153 paid although PayPal says CREATED. |
| Find the PayPal secret in the browser | 12 | HELD | Checked 5 pages and scripts: only the client id is public. |

## Round 1: after fixes

- Tests: pass
- Buttons shown: paypal no, venmo no, paylater no
- Purchase: The paypal button never appeared.
- Signed PAYMENT.CAPTURE.COMPLETED webhook: not delivered by the sandbox during this run

## Round 2: after fixes

- Tests: pass
- Buttons shown: paypal yes, venmo yes, paylater yes; Pay Later message: "Buy now, pay later. Learn more"
- Purchase: Paid $49.00: capture 8F3084201X897211V COMPLETED, shop order FOG-D165BA fulfilled, 1 label.
  - PayPal order `2G484248VG757532D`, amount USD 49.00 (bag total $49.00), capture `8F3084201X897211V` COMPLETED
- Signed PAYMENT.CAPTURE.COMPLETED webhook: verified and accepted (event WH-70A16648HR241483R-76J82141NL261002P)

| Attack | Rules | Result | What happened |
|---|---|---|---|
| Pay $0.01 for the $49 hoodie | 1, 2 | HELD | Every tampered request still produced a $49.00 USD PayPal order (or none). |
| Negative, fractional and fake items | 11 | HELD | All five bad bags were refused before any PayPal order was created. |
| Claim payment for an order nobody approved | 4 | HELD | PayPal refused the capture (order 9H87196400504274W is CREATED); the shop stayed unpaid. |
| Get it shipped on approval alone | 4, 8 | HELD | Buyer approved order 5VG3590075819573B, the capture was blocked and PayPal's 'approved' webhook arrived: nothing paid, nothing shipped. |
| Double-click: capture twice at once | 8, 10 | HELD | Two simultaneous captures: PayPal captured 1, the shop printed 1 label. |
| Card declined at capture (PayPal negative testing) | 5 | HELD | PayPal answered 422 INSTRUMENT_DECLINED (debug id f79355891f87e); the shop kept the order unpaid. |
| Forge PayPal's 'payment completed' webhook | 6 | HELD | Forged events were refused (HTTP 400 unsigned, 400 with stolen headers); nothing changed. |
| Replay a real webhook to ship twice | 7, 8 | HELD | Event WH-70A16648HR241483R-76J82141NL261002P replayed 3 times byte for byte: still one label. |
| Send 'approved' after 'completed' | 9 | HELD | Order FOG-D165BA stayed fulfilled after a late 'approved' event. |
| Find the PayPal secret in the browser | 12 | HELD | Checked 5 pages and scripts: only the client id is public. |
