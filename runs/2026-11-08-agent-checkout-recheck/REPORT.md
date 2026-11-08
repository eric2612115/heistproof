# Heistproof evidence report

**Verdict: incomplete; nothing got through, but not every robbery ran, so run it again.** 9 of 10 scripted robberies blocked, 0 robbed the shop. The AI thief tried 6 robberies of its own: none got through. Real purchase: paid and shipped once. Tests: pass.

All payments ran in the PayPal sandbox (no real money). Order and capture ids below are PayPal's own and can be looked up in the merchant's sandbox account.

## Round 1: first check

- Tests: pass
- Buttons shown: paypal yes, venmo yes, paylater yes; Pay Later message: "Buy now, pay later. Learn more"
- Purchase: Paid $49.00: capture 39L33056PU580704E COMPLETED, shop order FOG-93B7CC fulfilled, 1 label.
  - PayPal order `1U251244T45756906`, amount USD 49.00 (bag total $49.00), capture `39L33056PU580704E` COMPLETED
- Webhook: PayPal's genuine PAYMENT.CAPTURE.COMPLETED event for this order was accepted (HTTP 2xx) (event WH-4KY4947353492215L-9KR71273XA7321329); whether the shop checks signatures is what the forged-webhook robbery tests
- Books: 6 PayPal order(s) the shop calls paid, checked against PayPal's records: each backed by a completed capture that covers it, none shipped more than once

| Robbery | What it tries | Rules | Result | What happened |
|---|---|---|---|---|
| Price tampering | Pay $0.01 for the $49 hoodie | 1, 2 | Blocked | Every tampered request still produced a USD 49.00 PayPal order, or none (the unchanged request did produce one). |
| Negative quantity | Buy -1, 0.5 or 1,000 hoodies, or a product that doesn't exist | 11 | Blocked | All five bad bags were refused before any PayPal order was created (the unchanged bag did create one). |
| Payment nobody approved | Claim payment for an order no buyer approved | 4 | Blocked | PayPal refused the capture (order 5KT238772Y516194U is CREATED); the shop kept it unpaid. |
| Approval without payment | Get it shipped before PayPal takes the money | 4, 8 | Blocked | Buyer approved order 8VE09446R6641162E, the capture was blocked, and PayPal's 'approved' webhook arrived: nothing paid, nothing shipped. |
| Declined card | Get it shipped after the card is declined | 5 | Blocked | PayPal answered 422 INSTRUMENT_DECLINED (debug id ca5704562a97c); the shop kept the order unpaid. |
| Forged webhook | Fake PayPal's 'payment completed' message | 6 | Blocked | Forged events were refused (HTTP 400 unsigned, 400 with stolen headers); order FOG-A3A5DC stayed unpaid. |
| Webhook replay | Resend PayPal's real message to ship again | 7, 8 | Blocked | Event WH-4KY4947353492215L-9KR71273XA7321329 for order FOG-93B7CC replayed 3 times byte for byte: no extra label. |
| Late event | Send 'approved' after 'completed' to roll an order back | 9 | Not run | PayPal sent no CHECKOUT.ORDER.APPROVED event for any paid order of this shop. |
| Double click | Capture twice at once to get two shipments | 8, 10 | Blocked | Two simultaneous captures: PayPal captured 1, the shop printed 1 label. |
| Secret in the browser | Look for the PayPal secret in every page and script | 12 | Blocked | Checked 7 pages, scripts and endpoints, and every answer during the purchase: only the client id is public. |

AI thief (Meta Model API muse-wonder-1.0): read only what any visitor can see and tried 6 robberies of its own; none got through. The books against PayPal's records decide each one, not the model.

| AI thief's robbery | Its idea | Result | What happened |
|---|---|---|---|
| Partial capture for five | The capture endpoint may forward a client-supplied amount to PayPal, or accept any COMPLETED capture without comparing the captured amount and final_capture flag with the shop order's $245 total. | Blocked | The books still match PayPal's records: nothing taken. |
| Cheap capture, costly order | The capture handler may trust a shop-order identifier supplied in the request body or query string instead of using the shop order permanently bound to the PayPal order being captured. | Blocked | The books still match PayPal's records: nothing taken. |
| Planted capture collision | Order creation may let the shopper control custom_id or reference_id. Planting a new five-item order under the legitimate order's identifier may make the shop resolve the genuinely signed $49 capture webhook to the newest matching order, even though that capture ID was already used for the original  | Blocked | The books still match PayPal's records: nothing taken. |
| Duplicate lines, single charge | Pricing or PayPal-order creation may deduplicate repeated SKUs with a map or first-line lookup, while fulfillment retains every raw duplicate line from the submitted bag. | Blocked | The books still match PayPal's records: nothing taken. |
| Yen amount, dollar basket | Create-order handling may forward shopper-supplied currency or purchase_units to PayPal while recording the basket internally in USD, then compare only the numeric capture value and ignore its currency during capture verification. | Blocked | The books still match PayPal's records: nothing taken. |
| Declined card, injected paid state | The card checkout may construct its order from the submitted body, or honor paid/status/capture fields, before applying the card gateway's declined result. Referencing the already completed legitimate capture may make the new order appear settled. | Blocked | The books still match PayPal's records: nothing taken. |
