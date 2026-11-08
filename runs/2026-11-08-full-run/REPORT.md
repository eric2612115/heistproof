# Heistproof evidence report

**Verdict: safe to ship.** 10 of 10 scripted robberies blocked, 0 robbed the shop. The AI thief tried 6 robberies of its own: none got through. Real purchase: paid and shipped once. Tests: pass.

All payments ran in the PayPal sandbox (no real money). Order and capture ids below are PayPal's own and can be looked up in the merchant's sandbox account.

Coding agent: Claude Code (Meta Model API muse-wonder-1.0) with APIMatic's PayPal Context Plugin. Skills it loaded: paypal:typescript-integrate-paypal, paypal:typescript-getting-started, paypal:typescript-error-handling, heistproof:paypal-web-sdk-v6, heistproof:checkout-hardening, paypal:typescript-client-initialization, paypal:typescript-authentication, paypal:typescript-calling-endpoints, paypal:typescript-models, paypal:typescript-configuration-resilience, paypal:typescript-testing.

## Round 1: first check

- Tests: pass
- Buttons shown: paypal yes, venmo yes, paylater yes; Pay Later message: "Buy now, pay later. Learn more"
- Purchase: Capture APPROVED; shop order FOG-BAC9E8 is pending with 0 labels.
  - PayPal refused `POST /v2/checkout/orders/9JF068826A073763J/capture`: HTTP 415 UNSUPPORTED_MEDIA_TYPE, "The request payload is not supported", debug id `f6507972aed1f`
  - PayPal order `9JF068826A073763J`, amount USD 49.00 (bag total $49.00), capture `none` APPROVED
- Webhook: PayPal did not deliver the PAYMENT.CAPTURE.COMPLETED event during this run
- Books: 0 PayPal order(s) the shop calls paid, checked against PayPal's records: each backed by a completed capture that covers it, none shipped more than once

| Robbery | What it tries | Rules | Result | What happened |
|---|---|---|---|---|
| Price tampering | Pay $0.01 for the $49 hoodie | 1, 2 | Blocked | Every tampered request still produced a PayPal order for USD 49.00 or more, or none (the unchanged request did produce one). |
| Negative quantity | Buy -1, 0.5 or 1,000 of an item, a product that doesn't exist, or a bag with a negative line | 11 | Blocked | All 6 bad bags were refused before any PayPal order was created (the unchanged bag did create one). |
| Payment nobody approved | Claim payment for an order no buyer approved | 4 | Blocked | The capture request, replayed for an order no buyer approved: PayPal says CREATED, and the shop kept it unpaid. |
| Approval without payment | Get it shipped before PayPal takes the money | 4, 8 | Blocked | Buyer approved order 3GW68835HF6523433, the capture was blocked, and PayPal's 'approved' webhook arrived: nothing paid, nothing shipped. |
| Declined card | Get it shipped after the card is declined | 5 | Blocked | PayPal answered 422 INSTRUMENT_DECLINED (debug id f603666ff08d9); the shop kept the order unpaid. |
| Double click | Capture twice at once to get two shipments | 8, 10 | Not run | Neither of two simultaneous capture requests captured order 3GW68835HF6523433 (shop answered 415 and 415), so the capture route does not work and a double capture tests nothing. |
| Forged webhook | Fake PayPal's 'payment completed' message | 6 | Blocked | Forged events got HTTP 400 unsigned and 400 with stolen signature headers, and changed nothing: order FOG-F3B510 stayed unpaid. |
| Webhook replay | Resend PayPal's real message to ship again | 7, 8 | Not run | PayPal delivered no PAYMENT.CAPTURE.COMPLETED webhook about this shop's orders in time to replay. |
| Late event | Send 'approved' after 'completed' to roll an order back | 9 | Not run | Order FOG-BAC9E8 was never paid (pending), so a late 'approved' event has nothing to roll back. |
| Secret in the browser | Look for the PayPal secret or an access token in every page and script | 12 | Blocked | Checked 8 pages, scripts and endpoints, and every answer during the purchase: no secret and no access token, only the client id is public. |

AI thief: not run (the shop's capture did not work, so nothing could be paid for the thief to steal).

## Round 2: after fix 1

- Tests: pass
- Buttons shown: paypal yes, venmo yes, paylater yes; Pay Later message: "Buy now, pay later. Learn more"
- Purchase: Paid $49.00: capture 9V4685382Y695120M COMPLETED, shop order FOG-4887ED fulfilled, 1 label.
  - PayPal order `6Y2713318X722280J`, amount USD 49.00 (bag total $49.00), capture `9V4685382Y695120M` COMPLETED
- Webhook: PayPal's genuine PAYMENT.CAPTURE.COMPLETED event for this order was accepted (HTTP 2xx) (event WH-6RE69827CW371340G-2JP55163AA7058326); whether the shop checks signatures is what the forged-webhook robbery tests
- Books: 4 PayPal order(s) the shop calls paid, checked against PayPal's records: each backed by a completed capture that covers it, none shipped more than once (1 paid another way, not PayPal's to check)

| Robbery | What it tries | Rules | Result | What happened |
|---|---|---|---|---|
| Price tampering | Pay $0.01 for the $49 hoodie | 1, 2 | Blocked | Every tampered request still produced a PayPal order for USD 49.00 or more, or none (the unchanged request did produce one). |
| Negative quantity | Buy -1, 0.5 or 1,000 of an item, a product that doesn't exist, or a bag with a negative line | 11 | Blocked | All 6 bad bags were refused before any PayPal order was created (the unchanged bag did create one). |
| Payment nobody approved | Claim payment for an order no buyer approved | 4 | Blocked | The capture request, replayed for an order no buyer approved: PayPal says CREATED, and the shop kept it unpaid. |
| Approval without payment | Get it shipped before PayPal takes the money | 4, 8 | Blocked | Buyer approved order 6K7069961J917323W, the capture was blocked, and PayPal's 'approved' webhook arrived: nothing paid, nothing shipped. |
| Declined card | Get it shipped after the card is declined | 5 | Blocked | PayPal answered 422 INSTRUMENT_DECLINED (debug id f894652d4de93); the shop kept the order unpaid. |
| Double click | Capture twice at once to get two shipments | 8, 10 | Blocked | Two simultaneous captures: PayPal captured 1, the shop printed 1 label. |
| Forged webhook | Fake PayPal's 'payment completed' message | 6 | Blocked | Forged events got HTTP 400 unsigned and 400 with stolen signature headers, and changed nothing: order FOG-79B752 stayed unpaid. |
| Webhook replay | Resend PayPal's real message to ship again | 7, 8 | Blocked | Event WH-6RE69827CW371340G-2JP55163AA7058326 for order FOG-4887ED replayed 3 times byte for byte: no extra label. |
| Late event | Send 'approved' after 'completed' to roll an order back | 9 | Blocked | Order FOG-15A61F stayed fulfilled after a late 'approved' event. |
| Secret in the browser | Look for the PayPal secret or an access token in every page and script | 12 | Blocked | Checked 8 pages, scripts and endpoints, and every answer during the purchase: no secret and no access token, only the client id is public. |

AI thief (Meta Model API muse-wonder-1.0): read what any visitor can see and tried 6 robberies of its own; none got through. The books against PayPal's records decide each one, not the model.

| AI thief's robbery | Its idea | Result | What happened |
|---|---|---|---|
| Status injection at creation | The create-order handler may spread client-supplied fields into the stored shop order, allowing status, paid or capture fields to override the server's initial pending state. | Blocked | The books still match PayPal's records: nothing taken. |
| Split duplicate SKU lines | Pricing may deduplicate identical SKUs and keep only the first quantity, while fulfilment may sum every duplicate line in the stored order. | Blocked | The books still match PayPal's records: nothing taken. |
| Signed capture rebound to another order | The webhook handler may merely require original PayPal signature headers, then trust edited order-binding and amount fields instead of cryptographically verifying the body or fetching the capture from PayPal. | Blocked | The books still match PayPal's records: nothing taken. |
| Capture applied to latest order | The capture handler may fulfil the session's or server's most recently created pending order instead of the shop order permanently bound to the PayPal order being captured. | Blocked | The books still match PayPal's records: nothing taken. |
| Item swap in capture request | Although the browser sends no capture body, the capture endpoint may trust items supplied in a manually crafted capture request when constructing fulfilment, while PayPal captures only the originally created amount. | Blocked | The books still match PayPal's records: nothing taken. |
| Card-route total mismatch | The separate card checkout may charge a client-supplied total field while using the items array for fulfilment, even if the PayPal route correctly recalculates prices from the catalog. | Blocked | The books still match PayPal's records: nothing taken. |
