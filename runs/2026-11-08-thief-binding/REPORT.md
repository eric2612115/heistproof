# Heistproof evidence report

**Verdict: do not ship.** 10 of 10 scripted robberies blocked, 0 robbed the shop. The AI thief tried 6 robberies of its own: 1 GOT THROUGH. The shop's books do not match PayPal's (1 order). Real purchase: paid and shipped once. Tests: pass.

All payments ran in the PayPal sandbox (no real money). Order and capture ids below are PayPal's own and can be looked up in the merchant's sandbox account.

## Round 1: first check

- Tests: pass
- Buttons shown: paypal yes, venmo yes, paylater no
- Purchase: Paid $64.00: capture 8RK062132J345092R COMPLETED, shop order KC-C3C91F shipped, 1 label.
  - PayPal order `4SB597749C5269217`, amount USD 64.00 (bag total $64.00), capture `8RK062132J345092R` COMPLETED
- Webhook: PayPal's genuine PAYMENT.CAPTURE.COMPLETED event for this order was accepted (HTTP 2xx) (event WH-41K62719S45755419-9B286117VR4644910); whether the shop checks signatures is what the forged-webhook robbery tests
- Books: DO NOT MATCH PayPal's records on 1 order(s): one payment paying for two orders. Order KC-01FCAB: paid by capture 8RK062132J345092R, which already pays for order KC-C3C91F

| Robbery | What it tries | Rules | Result | What happened |
|---|---|---|---|---|
| Price tampering | Pay $0.01 for the $64 kettle | 1, 2 | Blocked | Every tampered request still produced a PayPal order for USD 64.00 or more, or none (the unchanged request did produce one). |
| Negative quantity | Buy -1, 0.5 or 1,000 of an item, a product that doesn't exist, or a bag with a negative line | 11 | Blocked | All 6 bad bags were refused before any PayPal order was created (the unchanged bag did create one). |
| Payment nobody approved | Claim payment for an order no buyer approved | 4 | Blocked | The capture request, replayed for an order no buyer approved: PayPal says CREATED, and the shop kept it unpaid. |
| Approval without payment | Get it shipped before PayPal takes the money | 4, 8 | Blocked | Buyer approved order 1XE61001JJ724604M, the capture was blocked, and PayPal's 'approved' webhook arrived: nothing paid, nothing shipped. |
| Declined card | Get it shipped after the card is declined | 5 | Blocked | PayPal answered 422 INSTRUMENT_DECLINED (debug id f226750d20fa8); the shop kept the order unpaid. |
| Double click | Capture twice at once to get two shipments | 8, 10 | Blocked | Two simultaneous captures: PayPal captured 1, the shop printed 1 label. |
| Forged webhook | Fake PayPal's 'payment completed' message | 6 | Blocked | Forged events got HTTP 400 unsigned and 400 with stolen signature headers, and changed nothing: order KC-505195 stayed unpaid. |
| Webhook replay | Resend PayPal's real message to ship again | 7, 8 | Blocked | Event WH-41K62719S45755419-9B286117VR4644910 for order KC-C3C91F replayed 3 times byte for byte: no extra label. |
| Late event | Send 'approved' after 'completed' to roll an order back | 9 | Blocked | Order KC-C3C91F stayed shipped after a late 'approved' event. |
| Secret in the browser | Look for the PayPal secret or an access token in every page and script | 12 | Blocked | Checked 7 pages, scripts and endpoints, and every answer during the purchase: no secret and no access token, only the client id is public. |

AI thief (Meta Model API muse-wonder-1.0): read what any visitor can see and tried 6 robberies of its own; 1 GOT THROUGH. The books against PayPal's records decide each one, not the model.

| AI thief's robbery | Its idea | Result | What happened |
|---|---|---|---|
| Partial capture at capture time | The create order is correctly priced at $64, but the capture endpoint may forward a client-supplied capture amount to PayPal or trust it when marking the order paid. | Blocked | The books still match PayPal's records: nothing taken. |
| Paid-state injection at creation | Order creation may copy client-supplied status fields into the new order record instead of allowing only the server to set paid or shipped state. | Blocked | The books still match PayPal's records: nothing taken. |
| Transplant legit capture via capture API | The capture endpoint may trust a capture ID, PayPal order ID, status, or shop reference supplied in its request body rather than binding the verified capture to the order identified in the path. | ROBBED | Got through: order KC-01FCAB paid by capture 8RK062132J345092R, which already pays for order KC-C3C91F. |
| Retargeted approved-then-completed webhooks | The webhook handler may locate the order solely from editable custom_id, reference_id, invoice_id, or related order fields, without binding the real capture to the PayPal order that actually produced it. | Blocked | The books still match PayPal's records: nothing taken. |
| Swap cart after approval, before capture | Capture may fulfill the session's latest shop order instead of the items belonging to the PayPal order actually approved and captured. | Blocked | The books still match PayPal's records: nothing taken. |
| Split duplicate lines | Pricing may deduplicate repeated SKUs with a map while fulfillment may sum every raw line, creating a disagreement between the amount charged and the quantity shipped. | Blocked | The books still match PayPal's records: nothing taken. |
