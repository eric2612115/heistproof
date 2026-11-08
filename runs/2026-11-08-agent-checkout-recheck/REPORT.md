# Heistproof evidence report

**Verdict: safe to ship.** 10 of 10 scripted robberies blocked, 0 robbed the shop. The AI thief tried 6 robberies of its own: none got through. Real purchase: paid and shipped once. Tests: pass.

All payments ran in the PayPal sandbox (no real money). Order and capture ids below are PayPal's own and can be looked up in the merchant's sandbox account.

## Round 1: first check

- Tests: pass
- Buttons shown: paypal yes, venmo yes, paylater yes; Pay Later message: "Buy now, pay later. Learn more"
- Purchase: Paid $49.00: capture 6FL13610NE362454F COMPLETED, shop order FOG-DB6380 fulfilled, 1 label.
  - PayPal order `50C40975HT3933002`, amount USD 49.00 (bag total $49.00), capture `6FL13610NE362454F` COMPLETED
- Webhook: PayPal's genuine PAYMENT.CAPTURE.COMPLETED event for this order was accepted (HTTP 2xx) (event WH-4CJ36458KN3422115-8VA91836JC6883627); whether the shop checks signatures is what the forged-webhook robbery tests
- Books: 6 PayPal order(s) the shop calls paid, checked against PayPal's records: each backed by a completed capture that covers it, none shipped more than once

| Robbery | What it tries | Rules | Result | What happened |
|---|---|---|---|---|
| Price tampering | Pay $0.01 for the $49 hoodie | 1, 2 | Blocked | Every tampered request still produced a PayPal order for USD 49.00 or more, or none (the unchanged request did produce one). |
| Negative quantity | Buy -1, 0.5 or 1,000 of an item, a product that doesn't exist, or a bag with a negative line | 11 | Blocked | All 6 bad bags were refused before any PayPal order was created (the unchanged bag did create one). |
| Payment nobody approved | Claim payment for an order no buyer approved | 4 | Blocked | PayPal refused the capture (order 5NN28378VE324701U is CREATED); the shop kept it unpaid. |
| Approval without payment | Get it shipped before PayPal takes the money | 4, 8 | Blocked | Buyer approved order 8EV95563ME171724V, the capture was blocked, and PayPal's 'approved' webhook arrived: nothing paid, nothing shipped. |
| Declined card | Get it shipped after the card is declined | 5 | Blocked | PayPal answered 422 INSTRUMENT_DECLINED (debug id f6953123b9705); the shop kept the order unpaid. |
| Double click | Capture twice at once to get two shipments | 8, 10 | Blocked | Two simultaneous captures: PayPal captured 1, the shop printed 1 label. |
| Forged webhook | Fake PayPal's 'payment completed' message | 6 | Blocked | Forged events got HTTP 400 unsigned and 400 with stolen signature headers, and changed nothing: order FOG-F9F761 stayed unpaid. |
| Webhook replay | Resend PayPal's real message to ship again | 7, 8 | Blocked | Event WH-4CJ36458KN3422115-8VA91836JC6883627 for order FOG-DB6380 replayed 3 times byte for byte: no extra label. |
| Late event | Send 'approved' after 'completed' to roll an order back | 9 | Blocked | Order FOG-D62549 stayed fulfilled after a late 'approved' event. |
| Secret in the browser | Look for the PayPal secret or an access token in every page and script | 12 | Blocked | Checked 7 pages, scripts and endpoints, and every answer during the purchase: no secret and no access token, only the client id is public. |

AI thief (Meta Model API muse-wonder-1.0): read only what any visitor can see and tried 6 robberies of its own; none got through. The books against PayPal's records decide each one, not the model.

| AI thief's robbery | Its idea | Result | What happened |
|---|---|---|---|
| Capture transplant to unpaid order | The webhook handler may trust resource.custom_id/invoice_id to choose the shop order and may not globally deduplicate a capture ID or compare its $49 amount with that order's total, even though editing invalidates the original signature. | Blocked | The books still match PayPal's records: nothing taken. |
| Capture-time item upgrade | After genuine approval for one hoodie, the capture handler may trust items supplied in the capture request instead of the items stored when the PayPal order was created. | Blocked | The books still match PayPal's records: nothing taken. |
| Partial-capture amount injection | The capture endpoint may forward a client-supplied capture amount to PayPal, or treat any successful partial capture as full payment, instead of requiring capture of the stored order total. | Blocked | The books still match PayPal's records: nothing taken. |
| Currency-code confusion | The create-order handler may pass a client-selected currency to PayPal while fulfillment validation compares only the numeric value 49.00 and assumes USD. | Blocked | The books still match PayPal's records: nothing taken. |
| Duplicate SKU line split | Pricing may deduplicate repeated SKUs with a map or first-match lookup while fulfillment iterates the raw item lines, causing PayPal to charge for one line but the warehouse to ship both. | Blocked | The books still match PayPal's records: nothing taken. |
| Card route proof and price trust | The separate card-checkout handler may trust client-supplied totals, paid/status fields, or a PayPal capture reference without binding that capture to this new order and amount, bypassing the declined card. | Blocked | The books still match PayPal's records: nothing taken. |
