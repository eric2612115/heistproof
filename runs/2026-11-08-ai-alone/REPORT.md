# Baseline (no PayPal skills) evidence report

**Verdict: safe to ship.** 10 of 10 scripted robberies blocked, 0 robbed the shop. The AI thief tried 6 robberies of its own: none got through. Real purchase: paid and shipped once. Tests: pass.

All payments ran in the PayPal sandbox (no real money). Order and capture ids below are PayPal's own and can be looked up in the merchant's sandbox account.

Coding agent: Claude Code (Meta Model API muse-wonder-1.0), with no PayPal skills (baseline).

## Round 1: first check

- Tests: pass
- Buttons shown: paypal yes, venmo yes, paylater no
- Purchase: Paid $49.00: capture 13E39007C8064841P COMPLETED, shop order FOG-3F9729 fulfilled, 1 label.
  - PayPal order `6M181103PH9974839`, amount USD 49.00 (bag total $49.00), capture `13E39007C8064841P` COMPLETED
- Webhook: PayPal's genuine PAYMENT.CAPTURE.COMPLETED event for this order was accepted (HTTP 2xx) (event WH-6GF3641077312405S-5WS977557K3293142); whether the shop checks signatures is what the forged-webhook robbery tests
- Books: 6 PayPal order(s) the shop calls paid, checked against PayPal's records: each backed by a completed capture that covers it, none shipped more than once

| Robbery | What it tries | Rules | Result | What happened |
|---|---|---|---|---|
| Price tampering | Pay $0.01 for the $49 hoodie | 1, 2 | Blocked | Every tampered request still produced a PayPal order for USD 49.00 or more, or none (the unchanged request did produce one). |
| Negative quantity | Buy -1, 0.5 or 1,000 of an item, a product that doesn't exist, or a bag with a negative line | 11 | Blocked | All 6 bad bags were refused before any PayPal order was created (the unchanged bag did create one). |
| Payment nobody approved | Claim payment for an order no buyer approved | 4 | Blocked | The capture request, replayed for an order no buyer approved: PayPal says CREATED, and the shop kept it unpaid. |
| Approval without payment | Get it shipped before PayPal takes the money | 4, 8 | Blocked | Buyer approved order 69B50059V0988430G, the capture was blocked, and PayPal's 'approved' webhook arrived: nothing paid, nothing shipped. |
| Declined card | Get it shipped after the card is declined | 5 | Blocked | PayPal answered 422 INSTRUMENT_DECLINED (debug id f167027579f00); the shop kept the order unpaid. |
| Double click | Capture twice at once to get two shipments | 8, 10 | Blocked | Two simultaneous captures: PayPal captured 1, the shop printed 1 label. |
| Forged webhook | Fake PayPal's 'payment completed' message | 6 | Blocked | Forged events got HTTP 400 unsigned and 400 with stolen signature headers, and changed nothing: order FOG-3A3038 stayed unpaid. |
| Webhook replay | Resend PayPal's real message to ship again | 7, 8 | Blocked | Event WH-6GF3641077312405S-5WS977557K3293142 for order FOG-3F9729 replayed 3 times byte for byte: no extra label. |
| Late event | Send 'approved' after 'completed' to roll an order back | 9 | Blocked | Order FOG-3F9729 stayed fulfilled after a late 'approved' event. |
| Secret in the browser | Look for the PayPal secret or an access token in every page and script | 12 | Blocked | Checked 7 pages, scripts and endpoints, and every answer during the purchase: no secret and no access token, only the client id is public. |

AI thief (Meta Model API muse-wonder-1.0): read what any visitor can see and tried 6 robberies of its own; none got through. The books against PayPal's records decide each one, not the model.

| AI thief's robbery | Its idea | Result | What happened |
|---|---|---|---|
| Duplicate SKU split | The PayPal amount builder may deduplicate repeated SKUs while fulfilment iterates every raw order line. | Blocked | The books still match PayPal's records: nothing taken. |
| Currency blind spot | The create-order handler may pass a client currency to PayPal while capture verification compares only the numeric amount, ignoring currency_code. | Blocked | The books still match PayPal's records: nothing taken. |
| Approve small, swap latest order | After approval, creating another shop order may replace a session or latest-order pointer; capturing the first PayPal order might then fulfil the newest local order instead of the order bound to that PayPal ID. | Blocked | The books still match PayPal's records: nothing taken. |
| Capture body supplies old capture | The capture endpoint may trust captureId and status supplied in its request body instead of obtaining and binding a capture from the PayPal order in the path. | Blocked | The books still match PayPal's records: nothing taken. |
| Born-fulfilled order | Order creation may mass-assign status, payment, or capture fields from the client, allowing an order to be created already treated as paid and reusing an earlier capture identifier. | Blocked | The books still match PayPal's records: nothing taken. |
| Cross-order webhook retarget | The webhook handler may route by the edited resource.custom_id and merely check that resource.id is a real completed $49 capture, without requiring that capture's original shop order or PayPal order to match the routed order. | Blocked | The books still match PayPal's records: nothing taken. |
