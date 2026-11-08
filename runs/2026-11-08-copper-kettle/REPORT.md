# Heistproof evidence report

**Verdict: safe to ship.** 10 of 10 scripted robberies blocked, 0 robbed the shop. The AI thief tried 6 robberies of its own: none got through. Real purchase: paid and shipped once. Tests: pass.

All payments ran in the PayPal sandbox (no real money). Order and capture ids below are PayPal's own and can be looked up in the merchant's sandbox account.

## Round 1: first check

- Tests: pass
- Buttons shown: paypal yes, venmo yes, paylater no
- Purchase: Paid $64.00: capture 4GP111190N765702R COMPLETED, shop order KC-F29139 shipped, 1 label.
  - PayPal order `89S78320TY4097727`, amount USD 64.00 (bag total $64.00), capture `4GP111190N765702R` COMPLETED
- Webhook: PayPal's genuine PAYMENT.CAPTURE.COMPLETED event for this order was accepted (HTTP 2xx) (event WH-57W56015PA424723M-4EL65539RA819081A); whether the shop checks signatures is what the forged-webhook robbery tests
- Books: 5 PayPal order(s) the shop calls paid, checked against PayPal's records: each backed by a completed capture that covers it, none shipped more than once

| Robbery | What it tries | Rules | Result | What happened |
|---|---|---|---|---|
| Price tampering | Pay $0.01 for the $64 kettle | 1, 2 | Blocked | Every tampered request still produced a PayPal order for USD 64.00 or more, or none (the unchanged request did produce one). |
| Negative quantity | Buy -1, 0.5 or 1,000 of an item, a product that doesn't exist, or a bag with a negative line | 11 | Blocked | All 6 bad bags were refused before any PayPal order was created (the unchanged bag did create one). |
| Payment nobody approved | Claim payment for an order no buyer approved | 4 | Blocked | The capture request, replayed for an order no buyer approved: PayPal says CREATED, and the shop kept it unpaid. |
| Approval without payment | Get it shipped before PayPal takes the money | 4, 8 | Blocked | Buyer approved order 7M007393GR1361023, the capture was blocked, and PayPal's 'approved' webhook arrived: nothing paid, nothing shipped. |
| Declined card | Get it shipped after the card is declined | 5 | Blocked | PayPal answered 422 INSTRUMENT_DECLINED (debug id ca572c4394b41); the shop kept the order unpaid. |
| Double click | Capture twice at once to get two shipments | 8, 10 | Blocked | Two simultaneous captures: PayPal captured 1, the shop printed 1 label. |
| Forged webhook | Fake PayPal's 'payment completed' message | 6 | Blocked | Forged events got HTTP 400 unsigned and 400 with stolen signature headers, and changed nothing: order KC-BB1088 stayed unpaid. |
| Webhook replay | Resend PayPal's real message to ship again | 7, 8 | Blocked | Event WH-57W56015PA424723M-4EL65539RA819081A for order KC-F29139 replayed 3 times byte for byte: no extra label. |
| Late event | Send 'approved' after 'completed' to roll an order back | 9 | Blocked | Order KC-F29139 stayed shipped after a late 'approved' event. |
| Secret in the browser | Look for the PayPal secret or an access token in every page and script | 12 | Blocked | Checked 7 pages, scripts and endpoints, and every answer during the purchase: no secret and no access token, only the client id is public. |

AI thief (Meta Model API muse-wonder-1.0): read what any visitor can see and tried 6 robberies of its own; none got through. The books against PayPal's records decide each one, not the model.

| AI thief's robbery | Its idea | Result | What happened |
|---|---|---|---|
| Old PayPal order, new shop order | The capture endpoint may validate only that the PayPal order in the URL is completed for $64, without checking that its purchase-unit reference was not already consumed by KC-F29139 or that it belongs to the newest shop order in the session. | Blocked | The books still match PayPal's records: nothing taken. |
| Swap basket after approval | Capture may resolve the shipment from the latest shop order or cart in the session instead of the shop order permanently bound to the approved PayPal order. | Blocked | The books still match PayPal's records: nothing taken. |
| Duplicate lines split pricing and fulfilment | The browser cart is a Map, so it never sends duplicate SKUs. The server may collapse duplicate lines by product when pricing, while fulfilment may sum the raw lines, or vice versa. | Blocked | The books still match PayPal's records: nothing taken. |
| Capture proof supplied in capture body | The capture handler may trust a client-supplied capture ID or status, or may verify the legitimate capture globally without binding its related order, custom_id, and payee to this shop order. | Blocked | The books still match PayPal's records: nothing taken. |
| Duplicate reference plus genuine webhook | Order creation may mass-assign reference or PayPal-order fields, creating a distinct unpaid record sharing the legitimate order identity. An unedited, correctly signed capture webhook may then be deduplicated against the original record but transition this duplicate record. | Blocked | The books still match PayPal's records: nothing taken. |
| Partial amount at capture stage | The order may be created and approved for the correct $64, while the separate capture endpoint may forward a client-supplied amount to PayPal or ship on any successful capture without comparing the captured amount with the order total. | Blocked | The books still match PayPal's records: nothing taken. |
