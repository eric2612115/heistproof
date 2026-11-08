# Heistproof evidence report

**Verdict: safe to ship.** 10 of 10 scripted robberies blocked, 0 robbed the shop. The AI thief tried 6 robberies of its own: none got through. Real purchase: paid and shipped once. Tests: pass.

All payments ran in the PayPal sandbox (no real money). Order and capture ids below are PayPal's own and can be looked up in the merchant's sandbox account.

## Round 1: first check

- Tests: pass
- Buttons shown: paypal yes, venmo yes, paylater no
- Purchase: Paid $64.00: capture 6GU02948GG741750L COMPLETED, shop order KC-CAEDD9 shipped, 1 label.
  - PayPal order `2UR242914J179933J`, amount USD 64.00 (bag total $64.00), capture `6GU02948GG741750L` COMPLETED
- Webhook: PayPal's genuine PAYMENT.CAPTURE.COMPLETED event for this order was accepted (HTTP 2xx) (event WH-9J333152SD6374516-5E179345B54039135); whether the shop checks signatures is what the forged-webhook robbery tests
- Books: 6 PayPal order(s) the shop calls paid, checked against PayPal's records: each backed by a completed capture that covers it, none shipped more than once

| Robbery | What it tries | Rules | Result | What happened |
|---|---|---|---|---|
| Price tampering | Pay $0.01 for the $64 kettle | 1, 2 | Blocked | Every tampered request still produced a PayPal order for USD 64.00 or more, or none (the unchanged request did produce one). |
| Negative quantity | Buy -1, 0.5 or 1,000 of an item, a product that doesn't exist, or a bag with a negative line | 11 | Blocked | All 6 bad bags were refused before any PayPal order was created (the unchanged bag did create one). |
| Payment nobody approved | Claim payment for an order no buyer approved | 4 | Blocked | PayPal refused the capture (order 6UC18918NM273353X is CREATED); the shop kept it unpaid. |
| Approval without payment | Get it shipped before PayPal takes the money | 4, 8 | Blocked | Buyer approved order 5CT22900JX526190K, the capture was blocked, and PayPal's 'approved' webhook arrived: nothing paid, nothing shipped. |
| Declined card | Get it shipped after the card is declined | 5 | Blocked | PayPal answered 422 INSTRUMENT_DECLINED (debug id f972233689bae); the shop kept the order unpaid. |
| Double click | Capture twice at once to get two shipments | 8, 10 | Blocked | Two simultaneous captures: PayPal captured 1, the shop printed 1 label. |
| Forged webhook | Fake PayPal's 'payment completed' message | 6 | Blocked | Forged events got HTTP 400 unsigned and 400 with stolen signature headers, and changed nothing: order KC-F61F85 stayed unpaid. |
| Webhook replay | Resend PayPal's real message to ship again | 7, 8 | Blocked | Event WH-9J333152SD6374516-5E179345B54039135 for order KC-CAEDD9 replayed 3 times byte for byte: no extra label. |
| Late event | Send 'approved' after 'completed' to roll an order back | 9 | Blocked | Order KC-CAEDD9 stayed shipped after a late 'approved' event. |
| Secret in the browser | Look for the PayPal secret or an access token in every page and script | 12 | Blocked | Checked 7 pages, scripts and endpoints, and every answer during the purchase: no secret and no access token, only the client id is public. |

AI thief (Meta Model API muse-wonder-1.0): read only what any visitor can see and tried 6 robberies of its own; none got through. The books against PayPal's records decide each one, not the model.

| AI thief's robbery | Its idea | Result | What happened |
|---|---|---|---|
| Partial capture amount | The create-order price is checked, but the capture endpoint forwards a client-supplied capture amount to PayPal or fails to compare the captured amount with the $64 order total. | Blocked | The books still match PayPal's records: nothing taken. |
| Duplicate-line split | Pricing deduplicates repeated SKUs, as the browser cart does, while fulfilment sums the raw order lines. | Blocked | The books still match PayPal's records: nothing taken. |
| Cross-order webhook credit | The webhook handler confirms that the supplied capture ID is a real completed PayPal capture, but credits the shop order named by editable body fields without binding that capture to its original order or checking that it was already used. | Blocked | The books still match PayPal's records: nothing taken. |
| Planted payment identity | Order creation accepts client-supplied shop-reference, PayPal-order, invoice, or capture identifiers, allowing a new order to share the legitimate paid order's identity; a completely unedited signed webhook then credits the newest matching order. | Blocked | The books still match PayPal's records: nothing taken. |
| Currency denomination swap | The shop forwards a client-selected currency or validates only the numeric amount 64.00 without requiring USD, so 64 JPY is treated as payment of a $64 basket. | Blocked | The books still match PayPal's records: nothing taken. |
| Interleaved capture binding | The capture handler inconsistently resolves the shop order from session/latest-order state instead of strictly from the PayPal order in the path, and a later sequential capture attempt trusts the already-completed capture to ship the remaining order. | Blocked | The books still match PayPal's records: nothing taken. |
