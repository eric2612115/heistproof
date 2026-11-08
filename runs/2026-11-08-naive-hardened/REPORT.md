# Heistproof evidence report

**Verdict: safe to ship.** 10 of 10 scripted robberies blocked, 0 robbed the shop. The AI thief tried 6 robberies of its own: none got through. Real purchase: paid and shipped once. Tests: pass.

All payments ran in the PayPal sandbox (no real money). Order and capture ids below are PayPal's own and can be looked up in the merchant's sandbox account.

Coding agent: Claude Code (Meta Model API muse-wonder-1.0) with APIMatic's PayPal Context Plugin. Skills it loaded: heistproof:checkout-hardening, heistproof:paypal-web-sdk-v6, paypal:typescript-error-handling, paypal:typescript-calling-endpoints.

## Round 1: first check

- Tests: pass
- Buttons shown: paypal yes, venmo no, paylater no
- Purchase: PayPal would charge $4900.00 for a $49.00 bag.
  - PayPal order `0AL86845CC967422X`, amount USD 4900.00 (bag total $49.00), capture `none` 
- Webhook: PayPal did not deliver the PAYMENT.CAPTURE.COMPLETED event during this run
- Books: not matched (the back office shows no PayPal ids)

| Robbery | What it tries | Rules | Result | What happened |
|---|---|---|---|---|
| Price tampering | Pay $0.01 for the $49 hoodie | 1, 2 | ROBBED | Shipped the $49 hoodie after PayPal captured USD 0.01 (order 3A3916056Y619454T); the shop's back office says fulfilled. |
| Negative quantity | Buy -1, 0.5 or 1,000 of an item, a product that doesn't exist, or a bag with a negative line | 11 | Blocked | All 6 bad bags were refused before any PayPal order was created (the unchanged bag did create one). |
| Payment nobody approved | Claim payment for an order no buyer approved | 4 | ROBBED | The shop marked order 24P03283GC073614H paid although PayPal says CREATED. |
| Secret in the browser | Look for the PayPal secret or an access token in every page and script | 12 | Blocked | Checked 8 pages, scripts and endpoints, and every answer during the purchase: no secret and no access token, only the client id is public. |

## Round 2: after fix 1

- Tests: pass
- Buttons shown: paypal yes, venmo yes, paylater yes; Pay Later message: "Buy now, pay later. Learn more"
- Purchase: Paid $49.00: capture 8E186828C68825102 COMPLETED, shop order FOG-242FE1 fulfilled, 1 label.
  - PayPal order `2WE2460982973304E`, amount USD 49.00 (bag total $49.00), capture `8E186828C68825102` COMPLETED
- Webhook: PayPal's genuine PAYMENT.CAPTURE.COMPLETED event for this order was accepted (HTTP 2xx) (event WH-21L59252CB727250T-59867076268605646); whether the shop checks signatures is what the forged-webhook robbery tests
- Books: 4 PayPal order(s) the shop calls paid, checked against PayPal's records: each backed by a completed capture that covers it, none shipped more than once (1 paid another way, not PayPal's to check)

| Robbery | What it tries | Rules | Result | What happened |
|---|---|---|---|---|
| Price tampering | Pay $0.01 for the $49 hoodie | 1, 2 | Blocked | Every tampered request still produced a PayPal order for USD 49.00 or more, or none (the unchanged request did produce one). |
| Negative quantity | Buy -1, 0.5 or 1,000 of an item, a product that doesn't exist, or a bag with a negative line | 11 | Blocked | All 6 bad bags were refused before any PayPal order was created (the unchanged bag did create one). |
| Payment nobody approved | Claim payment for an order no buyer approved | 4 | Blocked | PayPal refused the capture (order 69H83888H8121412C is CREATED); the shop kept it unpaid. |
| Approval without payment | Get it shipped before PayPal takes the money | 4, 8 | Blocked | Buyer approved order 7RW26754RR9561129, the capture was blocked, and PayPal's 'approved' webhook arrived: nothing paid, nothing shipped. |
| Declined card | Get it shipped after the card is declined | 5 | Blocked | PayPal answered 422 INSTRUMENT_DECLINED (debug id ca5715addede7); the shop kept the order unpaid. |
| Double click | Capture twice at once to get two shipments | 8, 10 | Blocked | Two simultaneous captures: PayPal captured 1, the shop printed 1 label. |
| Forged webhook | Fake PayPal's 'payment completed' message | 6 | Blocked | Forged events got HTTP 400 unsigned and 400 with stolen signature headers, and changed nothing: order FOG-670B56 stayed unpaid. |
| Webhook replay | Resend PayPal's real message to ship again | 7, 8 | Blocked | Event WH-21L59252CB727250T-59867076268605646 for order FOG-03513E replayed 3 times byte for byte: no extra label. |
| Late event | Send 'approved' after 'completed' to roll an order back | 9 | Blocked | Order FOG-03513E stayed fulfilled after a late 'approved' event. |
| Secret in the browser | Look for the PayPal secret or an access token in every page and script | 12 | Blocked | Checked 8 pages, scripts and endpoints, and every answer during the purchase: no secret and no access token, only the client id is public. |

AI thief (Meta Model API muse-wonder-1.0): read only what any visitor can see and tried 6 robberies of its own; none got through. The books against PayPal's records decide each one, not the model.

| AI thief's robbery | Its idea | Result | What happened |
|---|---|---|---|
| Approval-to-capture bag swap | The capture endpoint may associate the approved PayPal payment with the shopper session's most recently created shop order instead of the items immutably bound to that PayPal order at creation. | Blocked | The books still match PayPal's records: nothing taken. |
| Duplicate lines, single charge | PayPal-order pricing may deduplicate repeated SKUs with a map while fulfillment later sums every raw line in the stored bag. | Blocked | The books still match PayPal's records: nothing taken. |
| Yen-denominated 49 | The shop may pass a client-supplied currency through to PayPal but verify only the numeric capture value 49.00 at capture, without checking that the capture currency is USD. | Blocked | The books still match PayPal's records: nothing taken. |
| Old capture, new order via capture body | Although the page sends a null capture body, the capture endpoint may trust a client-supplied shop order, capture ID, or completion status in the body, or may apply an already-completed PayPal order to the session's newest shop order rather than only to its originally mapped order. | Blocked | The books still match PayPal's records: nothing taken. |
| Webhook capture transplant | The webhook handler may select the order to fulfill from the webhook body's custom_id or invoice_id and fail to bind the capture ID uniquely to its original order, or may accept the original signature headers without properly verifying the edited body. | Blocked | The books still match PayPal's records: nothing taken. |
| Card-rail total and line split | The separate card endpoint may charge a client-supplied total or deduplicated amount while its fulfillment record retains all three raw duplicate lines, even if the PayPal path prices correctly. | Blocked | The books still match PayPal's records: nothing taken. |
