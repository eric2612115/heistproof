# Heistproof evidence report

**Verdict: safe to ship.** 10 of 10 attacks held, 0 robbed the shop. Real sandbox purchase: paid and shipped once. Signed webhook: verified. Tests: pass.

All payments ran in the PayPal sandbox (no real money). Order and capture ids below are PayPal's own and can be looked up in the merchant's sandbox account.

Coding agent: Claude Code (Meta Model API muse-wonder-1.0) with APIMatic's PayPal Context Plugin. Skills it loaded: paypal:typescript-integrate-paypal, paypal:typescript-getting-started, paypal:typescript-error-handling, paypal:typescript-client-initialization, paypal:typescript-authentication, paypal:typescript-calling-endpoints, paypal:typescript-models, paypal:typescript-configuration-resilience, paypal:typescript-testing, heistproof:paypal-web-sdk-v6, heistproof:checkout-hardening.

## Round 0: first check

- Tests: pass
- Buttons shown: paypal yes, venmo yes, paylater yes; Pay Later message: "Buy now, pay later. Learn more"
- Purchase: Capture APPROVED; shop order FOG-E3D3FA is pending with 0 labels.
  - PayPal order `0KV683486E973004T`, amount USD 49.00 (bag total $49.00), capture `none` APPROVED
- Signed PAYMENT.CAPTURE.COMPLETED webhook: not delivered by the sandbox during this run

| Attack | Rules | Result | What happened |
|---|---|---|---|
| Pay $0.01 for the $49 hoodie | 1, 2 | HELD | Every tampered request still produced a $49.00 USD PayPal order (or none). |
| Negative, fractional and fake items | 11 | HELD | All five bad bags were refused before any PayPal order was created. |
| Claim payment for an order nobody approved | 4 | HELD | PayPal refused the capture (order 412020574M1160000 is CREATED); the shop stayed unpaid. |
| Find the PayPal secret in the browser | 12 | HELD | Checked 4 pages and scripts: only the client id is public. |

## Round 1: after fixes

- Tests: pass
- Buttons shown: paypal yes, venmo yes, paylater yes; Pay Later message: "Buy now, pay later. Learn more"
- Purchase: Paid $49.00: capture 5UD433706B768933M COMPLETED, shop order FOG-C70B36 fulfilled, 1 label.
  - PayPal order `81V2183693482234F`, amount USD 49.00 (bag total $49.00), capture `5UD433706B768933M` COMPLETED
- Signed PAYMENT.CAPTURE.COMPLETED webhook: verified and accepted (event WH-8JR40138J9986991U-0LK19640A6378052J)

| Attack | Rules | Result | What happened |
|---|---|---|---|
| Pay $0.01 for the $49 hoodie | 1, 2 | HELD | Every tampered request still produced a $49.00 USD PayPal order (or none). |
| Negative, fractional and fake items | 11 | HELD | All five bad bags were refused before any PayPal order was created. |
| Claim payment for an order nobody approved | 4 | HELD | PayPal refused the capture (order 7EC97819FL845105T is CREATED); the shop stayed unpaid. |
| Get it shipped on approval alone | 4, 8 | HELD | Buyer approved order 4CN470392D348921H, the capture was blocked: nothing paid, nothing shipped. |
| Double-click: capture twice at once | 8, 10 | HELD | Two simultaneous captures: PayPal captured 1, the shop printed 1 label. |
| Card declined at capture (PayPal negative testing) | 5 | HELD | PayPal answered 422 INSTRUMENT_DECLINED (debug id f483901a10acf); the shop kept the order unpaid. |
| Forge PayPal's 'payment completed' webhook | 6 | HELD | Forged events were refused (HTTP 400 unsigned, 400 with stolen headers); nothing changed. |
| Replay a real webhook to ship twice | 7, 8 | HELD | Event WH-8JR40138J9986991U-0LK19640A6378052J replayed 3 times byte for byte: still one label. |
| Send 'approved' after 'completed' | 9 | HELD | Order FOG-C70B36 stayed fulfilled after a late 'approved' event. |
| Find the PayPal secret in the browser | 12 | HELD | Checked 4 pages and scripts: only the client id is public. |
