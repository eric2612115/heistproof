# Heistproof evidence report

**Verdict: do not ship.** 10 of 10 scripted robberies blocked, 0 robbed the shop. The AI thief tried 6 robberies of its own: 1 GOT THROUGH. The shop's books do not match PayPal's (1 order). Real purchase: paid and shipped once. Tests: pass.

All payments ran in the PayPal sandbox (no real money). Order and capture ids below are PayPal's own and can be looked up in the merchant's sandbox account.

## Round 1: first check

- Tests: pass
- Buttons shown: paypal yes, venmo yes, paylater no
- Purchase: Paid $64.00: capture 4C76889462408674E COMPLETED, shop order KC-4700EF shipped, 1 label.
  - PayPal order `2DE958241U991160E`, amount USD 64.00 (bag total $64.00), capture `4C76889462408674E` COMPLETED
- Webhook: PayPal's genuine PAYMENT.CAPTURE.COMPLETED event for this order was accepted (HTTP 2xx) (event WH-0YK89862NJ930454B-7SR8890358946520F); whether the shop checks signatures is what the forged-webhook robbery tests
- Books: DO NOT MATCH PayPal's records on 1 order(s): one payment paying for two orders. Order KC-AA52F2: paid by capture 4C76889462408674E, which already pays for order KC-4700EF

| Robbery | What it tries | Rules | Result | What happened |
|---|---|---|---|---|
| Price tampering | Pay $0.01 for the $64 kettle | 1, 2 | Blocked | Every tampered request still produced a PayPal order for USD 64.00 or more, or none (the unchanged request did produce one). |
| Negative quantity | Buy -1, 0.5 or 1,000 of an item, a product that doesn't exist, or a bag with a negative line | 11 | Blocked | All 6 bad bags were refused before any PayPal order was created (the unchanged bag did create one). |
| Payment nobody approved | Claim payment for an order no buyer approved | 4 | Blocked | The capture request, replayed for an order no buyer approved: PayPal says CREATED, and the shop kept it unpaid. |
| Approval without payment | Get it shipped before PayPal takes the money | 4, 8 | Blocked | Buyer approved order 4JB39973Y62473318, the capture was blocked, and PayPal's 'approved' webhook arrived: nothing paid, nothing shipped. |
| Declined card | Get it shipped after the card is declined | 5 | Blocked | PayPal answered 422 INSTRUMENT_DECLINED (debug id f506360dba341); the shop kept the order unpaid. |
| Double click | Capture twice at once to get two shipments | 8, 10 | Blocked | Two simultaneous captures: PayPal captured 1, the shop printed 1 label. |
| Forged webhook | Fake PayPal's 'payment completed' message | 6 | Blocked | Forged events got HTTP 400 unsigned and 400 with stolen signature headers, and changed nothing: order KC-B58553 stayed unpaid. |
| Webhook replay | Resend PayPal's real message to ship again | 7, 8 | Blocked | Event WH-0YK89862NJ930454B-7SR8890358946520F for order KC-4700EF replayed 3 times byte for byte: no extra label. |
| Late event | Send 'approved' after 'completed' to roll an order back | 9 | Blocked | Order KC-4700EF stayed shipped after a late 'approved' event. |
| Secret in the browser | Look for the PayPal secret or an access token in every page and script | 12 | Blocked | Checked 7 pages, scripts and endpoints, and every answer during the purchase: no secret and no access token, only the client id is public. |

AI thief (Meta Model API muse-wonder-1.0): read what any visitor can see and tried 6 robberies of its own; 1 GOT THROUGH. The books against PayPal's records decide each one, not the model.

| AI thief's robbery | Its idea | Result | What happened |
|---|---|---|---|
| Duplicate-line split | The shop prices duplicate SKUs through a map that keeps only one line, while fulfilment sums every raw line. | Blocked | The books still match PayPal's records: nothing taken. |
| Enlarge after approval | Creating another order with an already-approved order's reference may mutate its stored lines after PayPal fixed the approved amount at $64, without creating or approving a new PayPal amount. | Blocked | The books still match PayPal's records: nothing taken. |
| Captured-order transplant | The capture handler may trust a client-supplied shop reference, or the latest pending order in the session, after finding that the supplied old PayPal order is already COMPLETED, instead of using the immutable PayPal-order-to-shop-order binding created at checkout. | ROBBED | Got through: order KC-AA52F2 paid by capture 4C76889462408674E, which already pays for order KC-4700EF. |
| Webhook payment transplant | The webhook handler may look up the order solely from resource.custom_id and record idempotency per shop order, rather than per capture ID, while revalidating the genuine capture ID with PayPal instead of relying only on the signature. | Blocked | The books still match PayPal's records: nothing taken. |
| Capture-result spoof | For an unapproved order, the capture handler may trust status, capture ID, or amount fields supplied in the capture request body, or use them as a fallback when PayPal refuses the capture. | Blocked | The books still match PayPal's records: nothing taken. |
| Create-order mass assignment | The create-order handler may copy unknown top-level body fields into the stored order record, allowing the client to set its payment or fulfilment state directly. | Blocked | The books still match PayPal's records: nothing taken. |
