# Heistproof evidence report

**Verdict: safe to ship.** 10 of 10 scripted robberies blocked, 0 robbed the shop. The AI thief tried 6 robberies of its own: none got through. Real purchase: paid and shipped once. Tests: pass.

All payments ran in the PayPal sandbox (no real money). Order and capture ids below are PayPal's own and can be looked up in the merchant's sandbox account.

Coding agent: Claude Code (Meta Model API muse-wonder-1.0) with APIMatic's PayPal Context Plugin. Skills it loaded: paypal:typescript-integrate-paypal, paypal:typescript-getting-started, paypal:typescript-error-handling, heistproof:paypal-web-sdk-v6, heistproof:checkout-hardening, paypal:typescript-client-initialization, paypal:typescript-authentication, paypal:typescript-calling-endpoints, paypal:typescript-models, paypal:typescript-configuration-resilience, paypal:typescript-testing.

## Round 1: first check

- Tests: pass
- Buttons shown: paypal yes, venmo yes, paylater yes; Pay Later message: "Pay in 4 interest-free payments of $12.25. Learn more"
- Purchase: Capture APPROVED; shop order FOG-376A3B is pending with 0 labels.
  - PayPal refused `POST /v2/checkout/orders/0EE7442332287661H/capture`: HTTP 415 UNSUPPORTED_MEDIA_TYPE, "The request payload is not supported", debug id `f844956bdd0a9`
  - PayPal order `0EE7442332287661H`, amount USD 49.00 (bag total $49.00), capture `none` APPROVED
- Webhook: PayPal did not deliver the PAYMENT.CAPTURE.COMPLETED event during this run
- Books: 0 PayPal order(s) the shop calls paid, checked against PayPal's records: each backed by a completed capture that covers it, none shipped more than once

| Robbery | What it tries | Rules | Result | What happened |
|---|---|---|---|---|
| Price tampering | Pay $0.01 for the $49 hoodie | 1, 2 | Blocked | Every tampered request still produced a PayPal order for USD 49.00 or more, or none (the unchanged request did produce one). |
| Negative quantity | Buy -1, 0.5 or 1,000 of an item, a product that doesn't exist, or a bag with a negative line | 11 | Blocked | All 6 bad bags were refused before any PayPal order was created (the unchanged bag did create one). |
| Payment nobody approved | Claim payment for an order no buyer approved | 4 | Blocked | The capture request, replayed for an order no buyer approved: PayPal says CREATED, and the shop kept it unpaid. |
| Approval without payment | Get it shipped before PayPal takes the money | 4, 8 | Blocked | Buyer approved order 9JC72310BW7829549, the capture was blocked, and PayPal's 'approved' webhook arrived: nothing paid, nothing shipped. |
| Declined card | Get it shipped after the card is declined | 5 | Blocked | PayPal answered 422 INSTRUMENT_DECLINED (debug id f900646e44b6f); the shop kept the order unpaid. |
| Double click | Capture twice at once to get two shipments | 8, 10 | Not run | Neither of two simultaneous capture requests captured order 9JC72310BW7829549 (shop answered 415 and 202), so the capture route does not work and a double capture tests nothing. |
| Forged webhook | Fake PayPal's 'payment completed' message | 6 | Not run | PayPal delivered no PAYMENT.CAPTURE.COMPLETED webhook in time to forge from. |
| Webhook replay | Resend PayPal's real message to ship again | 7, 8 | Not run | PayPal delivered no PAYMENT.CAPTURE.COMPLETED webhook about this shop's orders in time to replay. |
| Late event | Send 'approved' after 'completed' to roll an order back | 9 | Not run | Order FOG-376A3B was never paid (pending), so a late 'approved' event has nothing to roll back. |
| Secret in the browser | Look for the PayPal secret or an access token in every page and script | 12 | Blocked | Checked 7 pages, scripts and endpoints, and every answer during the purchase: no secret and no access token, only the client id is public. |

AI thief: not run (the shop's capture did not work, so nothing could be paid for the thief to steal).

## Round 2: after fix 1

- Tests: pass
- Buttons shown: paypal yes, venmo yes, paylater yes; Pay Later message: "Buy now, pay later. Learn more"
- Purchase: Paid $49.00: capture 5BW184260V783351G COMPLETED, shop order FOG-9949F8 fulfilled, 1 label.
  - PayPal order `4ST5352238439571S`, amount USD 49.00 (bag total $49.00), capture `5BW184260V783351G` COMPLETED
- Webhook: PayPal's genuine PAYMENT.CAPTURE.COMPLETED event for this order was accepted (HTTP 2xx) (event WH-6TA24690E2646382T-49L62628BL296872S); whether the shop checks signatures is what the forged-webhook robbery tests
- Books: 4 PayPal order(s) the shop calls paid, checked against PayPal's records: each backed by a completed capture that covers it, none shipped more than once

| Robbery | What it tries | Rules | Result | What happened |
|---|---|---|---|---|
| Price tampering | Pay $0.01 for the $49 hoodie | 1, 2 | Blocked | Every tampered request still produced a PayPal order for USD 49.00 or more, or none (the unchanged request did produce one). |
| Negative quantity | Buy -1, 0.5 or 1,000 of an item, a product that doesn't exist, or a bag with a negative line | 11 | Blocked | All 6 bad bags were refused before any PayPal order was created (the unchanged bag did create one). |
| Payment nobody approved | Claim payment for an order no buyer approved | 4 | Blocked | The capture request, replayed for an order no buyer approved: PayPal says CREATED, and the shop kept it unpaid. |
| Approval without payment | Get it shipped before PayPal takes the money | 4, 8 | Blocked | Buyer approved order 5TE10559DP428033N, the capture was blocked, and PayPal's 'approved' webhook arrived: nothing paid, nothing shipped. |
| Declined card | Get it shipped after the card is declined | 5 | Blocked | PayPal answered 422 INSTRUMENT_DECLINED (debug id f8337108dc42b); the shop kept the order unpaid. |
| Double click | Capture twice at once to get two shipments | 8, 10 | Blocked | Two simultaneous captures: PayPal captured 1, the shop printed 1 label. |
| Forged webhook | Fake PayPal's 'payment completed' message | 6 | Blocked | Forged events got HTTP 400 unsigned and 400 with stolen signature headers, and changed nothing: order FOG-16D105 stayed unpaid. |
| Webhook replay | Resend PayPal's real message to ship again | 7, 8 | Blocked | Event WH-6TA24690E2646382T-49L62628BL296872S for order FOG-9949F8 replayed 3 times byte for byte: no extra label. |
| Late event | Send 'approved' after 'completed' to roll an order back | 9 | Blocked | Order FOG-FCB970 stayed fulfilled after a late 'approved' event. |
| Secret in the browser | Look for the PayPal secret or an access token in every page and script | 12 | Blocked | Checked 7 pages, scripts and endpoints, and every answer during the purchase: no secret and no access token, only the client id is public. |

AI thief (Meta Model API muse-wonder-1.0): read what any visitor can see and tried 6 robberies of its own; none got through. The books against PayPal's records decide each one, not the model.

| AI thief's robbery | Its idea | Result | What happened |
|---|---|---|---|
| Latest-order capture swap | The capture handler may credit the newest pending shop order in the shopper session instead of the shop order permanently bound to the captured PayPal order. | Blocked | The books still match PayPal's records: nothing taken. |
| Cross-order webhook credit | The webhook handler may locate an order solely through editable custom_id or invoice_id fields, without proving that the already-used capture belongs to that order or that the capture ID has not credited another order. | Blocked | The books still match PayPal's records: nothing taken. |
| Capture-body item injection | The manual capture endpoint may build the fulfilled shipment from items supplied in the capture request body instead of the server-stored items from PayPal order creation. | Blocked | The books still match PayPal's records: nothing taken. |
| Duplicate-line aggregation split | Order creation may deduplicate repeated SKUs when calculating the PayPal charge, while fulfillment may iterate every submitted line and ship each occurrence. | Blocked | The books still match PayPal's records: nothing taken. |
| Shared PayPal-order linkage | Creating a second order may honor a client-supplied PayPal order identifier, allowing two shop orders to share one approved PayPal order; capture processing may then fulfill every shop order linked to that identifier. | Blocked | The books still match PayPal's records: nothing taken. |
| Paid-state mass assignment | The create-order endpoint may copy non-allowlisted client fields onto the persisted shop order instead of accepting only items and email, allowing the shopper to create an order already marked paid or fulfilled. | Blocked | The books still match PayPal's records: nothing taken. |
