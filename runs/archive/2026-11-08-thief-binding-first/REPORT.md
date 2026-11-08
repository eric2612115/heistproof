# Heistproof evidence report

**Verdict: do not ship.** 10 of 10 scripted robberies blocked, 0 robbed the shop. The AI thief tried 6 robberies of its own: none got through. The shop's books do not match PayPal's (1 order). Real purchase: paid and shipped once. Tests: pass.

All payments ran in the PayPal sandbox (no real money). Order and capture ids below are PayPal's own and can be looked up in the merchant's sandbox account.

## Round 1: first check

- Tests: pass
- Buttons shown: paypal yes, venmo yes, paylater no
- Purchase: Paid $64.00: capture 3X417268TK348611L COMPLETED, shop order KC-D674DF shipped, 1 label.
  - PayPal order `8CV7359956075552A`, amount USD 64.00 (bag total $64.00), capture `3X417268TK348611L` COMPLETED
- Webhook: PayPal's genuine PAYMENT.CAPTURE.COMPLETED event for this order was accepted (HTTP 2xx) (event WH-53R42193LE608151T-8PL55019TT684261H); whether the shop checks signatures is what the forged-webhook robbery tests
- Books: DO NOT MATCH PayPal's records on 1 order(s): one payment paying for two orders. Order KC-DEDF8E: paid by capture 7GG47783PL114422R, which already pays for order KC-2881FC

| Robbery | What it tries | Rules | Result | What happened |
|---|---|---|---|---|
| Price tampering | Pay $0.01 for the $64 kettle | 1, 2 | Blocked | Every tampered request still produced a PayPal order for USD 64.00 or more, or none (the unchanged request did produce one). |
| Negative quantity | Buy -1, 0.5 or 1,000 of an item, a product that doesn't exist, or a bag with a negative line | 11 | Blocked | All 6 bad bags were refused before any PayPal order was created (the unchanged bag did create one). |
| Payment nobody approved | Claim payment for an order no buyer approved | 4 | Blocked | The capture request, replayed for an order no buyer approved: PayPal says CREATED, and the shop kept it unpaid. |
| Approval without payment | Get it shipped before PayPal takes the money | 4, 8 | Blocked | Buyer approved order 5UF20151LJ684712D, the capture was blocked, and PayPal's 'approved' webhook arrived: nothing paid, nothing shipped. |
| Declined card | Get it shipped after the card is declined | 5 | Blocked | PayPal answered 422 INSTRUMENT_DECLINED (debug id f510349ec54f2); the shop kept the order unpaid. |
| Double click | Capture twice at once to get two shipments | 8, 10 | Blocked | Two simultaneous captures: PayPal captured 1, the shop printed 1 label. |
| Forged webhook | Fake PayPal's 'payment completed' message | 6 | Blocked | Forged events got HTTP 400 unsigned and 400 with stolen signature headers, and changed nothing: order KC-921161 stayed unpaid. |
| Webhook replay | Resend PayPal's real message to ship again | 7, 8 | Blocked | Event WH-53R42193LE608151T-8PL55019TT684261H for order KC-A89223 replayed 3 times byte for byte: no extra label. |
| Late event | Send 'approved' after 'completed' to roll an order back | 9 | Blocked | Order KC-A89223 stayed shipped after a late 'approved' event. |
| Secret in the browser | Look for the PayPal secret or an access token in every page and script | 12 | Blocked | Checked 7 pages, scripts and endpoints, and every answer during the purchase: no secret and no access token, only the client id is public. |

AI thief (Meta Model API muse-wonder-1.0): read what any visitor can see and tried 6 robberies of its own; none got through. The books against PayPal's records decide each one, not the model.

| AI thief's robbery | Its idea | Result | What happened |
|---|---|---|---|
| Duplicate line, pay once fulfil twice | The shop may price the PayPal order from a de-duplicated or first matching line, as the browser cart does, while fulfilment sums every submitted line for the same SKU. | Blocked | The books still match PayPal's records: nothing taken. |
| Approve small order, swap session cart, capture old order | The capture handler may resolve the shop order from the latest checkout stored in the session rather than from the PayPal order being captured. | Blocked | The books still match PayPal's records: nothing taken. |
| Reuse a completed capture through capture-body identifiers | The capture endpoint may trust capture, order, reference, or status fields supplied in its JSON body and verify that the named capture is genuinely COMPLETED, without checking that it belongs to the PayPal order in the URL. | Blocked | The books still match PayPal's records: nothing taken. |
| Transplant a real capture webhook onto a fresh order | The webhook handler may locate the order using the body's custom_id and accept the event because its capture ID is a real completed PayPal capture, without binding that capture to the fresh order's PayPal order or rejecting the retained signature after editing. | Blocked | The books still match PayPal's records: nothing taken. |
| Capture another approved PayPal order for my checkout | The capture route may not verify that the PayPal order in the URL was created by, or belongs to, the current shopper/session, and may credit it to the current or supplied shop reference. | Blocked | The books still match PayPal's records: nothing taken. |
| Pay 64 yen instead of 64 dollars | Checkout creation may forward an attacker-supplied currency to PayPal while later payment checks compare only the numeric amount 64.00 and ignore the currency code. | Blocked | Nothing taken by this robbery; meanwhile late PayPal events changed orders it never touched (KC-DEDF8E), counted in the round's books. |
