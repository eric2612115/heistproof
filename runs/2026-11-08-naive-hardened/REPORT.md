# Heistproof evidence report

**Verdict: safe to ship.** 10 of 10 scripted robberies blocked, 0 robbed the shop. The AI thief tried 6 robberies of its own: none got through. Real purchase: paid and shipped once. Tests: pass.

All payments ran in the PayPal sandbox (no real money). Order and capture ids below are PayPal's own and can be looked up in the merchant's sandbox account.

Coding agent: Claude Code (Meta Model API muse-wonder-1.0) with APIMatic's PayPal Context Plugin. Skills it loaded: heistproof:checkout-hardening, paypal:typescript-integrate-paypal, heistproof:paypal-web-sdk-v6, paypal:typescript-error-handling, paypal:typescript-testing.

## Round 1: first check

- Tests: pass
- Buttons shown: paypal yes, venmo no, paylater no
- Purchase: PayPal would charge $4900.00 for a $49.00 bag.
  - PayPal order `3KR135790P2476137`, amount USD 4900.00 (bag total $49.00), capture `none` 
- Webhook: PayPal did not deliver the PAYMENT.CAPTURE.COMPLETED event during this run
- Books: not matched (the back office shows no PayPal ids)

| Robbery | What it tries | Rules | Result | What happened |
|---|---|---|---|---|
| Price tampering | Pay $0.01 for the $49 hoodie | 1, 2 | ROBBED | Shipped the $49 hoodie after PayPal captured USD 0.01 (order 1NT10871VR801261B); the shop's back office says fulfilled. |
| Negative quantity | Buy -1, 0.5 or 1,000 of an item, a product that doesn't exist, or a bag with a negative line | 11 | Blocked | All 6 bad bags were refused before any PayPal order was created (the unchanged bag did create one). |
| Payment nobody approved | Claim payment for an order no buyer approved | 4 | ROBBED | /api/paypal/orders/3AM22857YM330704P/capture, sent for order 3AM22857YM330704P, which no buyer approved, made the shop mark it paid although PayPal says CREATED. |
| Secret in the browser | Look for the PayPal secret or an access token in every page and script | 12 | Blocked | Checked 8 pages, scripts and endpoints, and every answer during the purchase: no secret and no access token, only the client id is public. |

AI thief: not run (the real purchase never reached a buyer's approval, so there was no checkout to rob).

## Round 2: after fix 1

- Tests: pass
- Buttons shown: paypal yes, venmo no, paylater no
- Purchase: Paid $49.00: capture 8AY54327S7967700H COMPLETED, shop order FOG-95B470 fulfilled, 1 label.
  - PayPal order `1VT30877UH158350B`, amount USD 49.00 (bag total $49.00), capture `8AY54327S7967700H` COMPLETED
- Webhook: PayPal's genuine PAYMENT.CAPTURE.COMPLETED event for this order was accepted (HTTP 2xx) (event WH-7FN03353R1037681M-7TE98012FV196102M); whether the shop checks signatures is what the forged-webhook robbery tests
- Books: 6 PayPal order(s) the shop calls paid, checked against PayPal's records: each backed by a completed capture that covers it, none shipped more than once (1 paid another way, not PayPal's to check)

| Robbery | What it tries | Rules | Result | What happened |
|---|---|---|---|---|
| Price tampering | Pay $0.01 for the $49 hoodie | 1, 2 | Blocked | Every tampered request still produced a PayPal order for USD 49.00 or more, or none (the unchanged request did produce one). |
| Negative quantity | Buy -1, 0.5 or 1,000 of an item, a product that doesn't exist, or a bag with a negative line | 11 | Blocked | All 6 bad bags were refused before any PayPal order was created (the unchanged bag did create one). |
| Payment nobody approved | Claim payment for an order no buyer approved | 4 | Blocked | The capture request, replayed for an order no buyer approved: PayPal says CREATED, and the shop kept it unpaid. |
| Approval without payment | Get it shipped before PayPal takes the money | 4, 8 | Blocked | Buyer approved order 9PW41642N40986841, the capture was blocked, and PayPal's 'approved' webhook arrived: nothing paid, nothing shipped. |
| Declined card | Get it shipped after the card is declined | 5 | Blocked | PayPal answered 422 INSTRUMENT_DECLINED (debug id f788842d2c5ab); the shop kept the order unpaid. |
| Double click | Capture twice at once to get two shipments | 8, 10 | Blocked | Two simultaneous captures: PayPal captured 1, the shop printed 1 label. |
| Forged webhook | Fake PayPal's 'payment completed' message | 6 | Blocked | Forged events got HTTP 400 unsigned and 400 with stolen signature headers, and changed nothing: order FOG-B60E2D stayed unpaid. |
| Webhook replay | Resend PayPal's real message to ship again | 7, 8 | Blocked | Event WH-7FN03353R1037681M-7TE98012FV196102M for order FOG-95B470 replayed 3 times byte for byte: no extra label. |
| Late event | Send 'approved' after 'completed' to roll an order back | 9 | Blocked | Order FOG-95B470 stayed fulfilled after a late 'approved' event. |
| Secret in the browser | Look for the PayPal secret or an access token in every page and script | 12 | Blocked | Checked 8 pages, scripts and endpoints, and every answer during the purchase: no secret and no access token, only the client id is public. |

AI thief (Meta Model API muse-wonder-1.0): read what any visitor can see and tried 6 robberies of its own; none got through. The books against PayPal's records decide each one, not the model.

| AI thief's robbery | Its idea | Result | What happened |
|---|---|---|---|
| Capture lands on newest order | The capture endpoint binds a PayPal capture to the newest shop order in the session, or to an orderId supplied in the capture body, instead of the custom_id stored on the PayPal order, and does not compare the captured and shop-order amounts. | Blocked | The books still match PayPal's records: nothing taken. |
| Old capture, new order | The CAPTURE.COMPLETED webhook handler trusts resource.custom_id to select the order and checks only whether that order is already fulfilled, without checking that this capture ID already settled the legitimate order or re-fetching the capture from PayPal. | Blocked | The books still match PayPal's records: nothing taken. |
| 49-yen hoodie | Extra currency or purchase-unit fields supplied at PayPal-order creation are forwarded to PayPal, while later verification compares only the numeric value 49.00 and ignores currency_code. | Blocked | The books still match PayPal's records: nothing taken. |
| Duplicate lines, single charge | Pricing de-duplicates repeated SKUs, for example with a Map keyed by SKU, while the stored and fulfilled order retains every raw duplicate line. | Blocked | The books still match PayPal's records: nothing taken. |
| Forged binding identifier | Client-supplied custom_id or invoice_id fields override the binding identifier the shop normally sets on a PayPal order, so capture processing follows the supplied identifier to another pending shop order and does not enforce the amount for that order. | Blocked | The books still match PayPal's records: nothing taken. |
| Expired test card | The separate card route checks the card number against its declined-card logic but does not validate that the expiration date is in the future before treating the simulated charge as paid. | Blocked | The books still match PayPal's records: nothing taken. |
