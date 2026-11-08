# Heistproof evidence report

**Verdict: safe to ship.** 10 of 10 scripted robberies blocked, 0 robbed the shop. The AI thief tried 6 robberies of its own: none got through. Real purchase: paid and shipped once. Tests: pass.

All payments ran in the PayPal sandbox (no real money). Order and capture ids below are PayPal's own and can be looked up in the merchant's sandbox account.

## Round 1: first check

- Tests: pass
- Buttons shown: paypal yes, venmo yes, paylater no
- Purchase: Paid $64.00: capture 5NX80798R4055935L COMPLETED, shop order KC-C0C48F shipped, 1 label.
  - PayPal order `7PP74640453885402`, amount USD 64.00 (bag total $64.00), capture `5NX80798R4055935L` COMPLETED
- Webhook: PayPal's genuine PAYMENT.CAPTURE.COMPLETED event for this order was accepted (HTTP 2xx) (event WH-7JN339695G0665602-31E4886320265053L); whether the shop checks signatures is what the forged-webhook robbery tests
- Books: 7 PayPal order(s) the shop calls paid, checked against PayPal's records: each backed by a completed capture that covers it, none shipped more than once

| Robbery | What it tries | Rules | Result | What happened |
|---|---|---|---|---|
| Price tampering | Pay $0.01 for the $64 kettle | 1, 2 | Blocked | Every tampered request still produced a PayPal order for USD 64.00 or more, or none (the unchanged request did produce one). |
| Negative quantity | Buy -1, 0.5 or 1,000 of an item, a product that doesn't exist, or a bag with a negative line | 11 | Blocked | All 6 bad bags were refused before any PayPal order was created (the unchanged bag did create one). |
| Payment nobody approved | Claim payment for an order no buyer approved | 4 | Blocked | The capture request, replayed for an order no buyer approved: PayPal says CREATED, and the shop kept it unpaid. |
| Approval without payment | Get it shipped before PayPal takes the money | 4, 8 | Blocked | Buyer approved order 832489003R915641H, the capture was blocked, and PayPal's 'approved' webhook arrived: nothing paid, nothing shipped. |
| Declined card | Get it shipped after the card is declined | 5 | Blocked | PayPal answered 422 INSTRUMENT_DECLINED (debug id f619801f624e5); the shop kept the order unpaid. |
| Double click | Capture twice at once to get two shipments | 8, 10 | Blocked | Two simultaneous captures: PayPal captured 1, the shop printed 1 label. |
| Forged webhook | Fake PayPal's 'payment completed' message | 6 | Blocked | Forged events got HTTP 400 unsigned and 400 with stolen signature headers, and changed nothing: order KC-5620E7 stayed unpaid. |
| Webhook replay | Resend PayPal's real message to ship again | 7, 8 | Blocked | Event WH-7JN339695G0665602-31E4886320265053L for order KC-C0C48F replayed 3 times byte for byte: no extra label. |
| Late event | Send 'approved' after 'completed' to roll an order back | 9 | Blocked | Order KC-279B54 stayed shipped after a late 'approved' event. |
| Secret in the browser | Look for the PayPal secret or an access token in every page and script | 12 | Blocked | Checked 7 pages, scripts and endpoints, and every answer during the purchase: no secret and no access token, only the client id is public. |

AI thief (Meta Model API muse-wonder-1.0): read what any visitor can see and tried 6 robberies of its own; none got through. The books against PayPal's records decide each one, not the model.

| AI thief's robbery | Its idea | Result | What happened |
|---|---|---|---|
| Duplicate SKU split | The server may deduplicate lines by product when pricing or creating the PayPal order, because the browser cart guarantees unique products, while fulfilment may sum every line. | Blocked | The books still match PayPal's records: nothing taken. |
| Capture-time line swap | The capture handler may fulfil lines supplied in the capture request instead of the lines stored when the $64 PayPal order was created and approved. | Blocked | The books still match PayPal's records: nothing taken. |
| Partial final capture | After approving a $640 order, the capture endpoint may forward a buyer-supplied capture amount to PayPal as a final capture while still fulfilling the entire stored order without comparing captured and stored totals. | Blocked | The books still match PayPal's records: nothing taken. |
| Currency denomination swap | The checkout may forward a buyer-supplied currency to PayPal while later payment checks compare only the numeric value 64 and ignore the currency code. | Blocked | The books still match PayPal's records: nothing taken. |
| Order-ref collision replay | Checkout may accept a buyer-supplied shop reference or custom_id. Colliding a new unpaid order with KC-279B54 may let the genuinely signed $64 capture for that reference mark the new order paid, especially if capture-ID deduplication is per-order and the PayPal order binding is not checked. | Blocked | The books still match PayPal's records: nothing taken. |
| Orphan approved order capture | The capture route may treat knowledge of a PayPal order ID as sufficient authority and may not bind it to the session that created or approved it. PayPal order 25S110043Y8419447 was already approved for shop order KC-4A6778 but has no listed capture. | Blocked | The books still match PayPal's records: nothing taken. |
