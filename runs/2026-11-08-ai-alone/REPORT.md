# Baseline (no PayPal skills) evidence report

**Verdict: safe to ship.** 10 of 10 scripted robberies blocked, 0 robbed the shop. The AI thief tried 6 robberies of its own: none got through. Real purchase: paid and shipped once. Tests: pass.

All payments ran in the PayPal sandbox (no real money). Order and capture ids below are PayPal's own and can be looked up in the merchant's sandbox account.

Coding agent: Claude Code (Meta Model API muse-wonder-1.0), with no PayPal skills (baseline).

## Round 1: first check

- Tests: pass
- Buttons shown: paypal yes, venmo yes, paylater yes
- Purchase: Paid $49.00: capture 4HY09955A0637800K COMPLETED, shop order FOG-BFEA3F fulfilled, 1 label.
  - PayPal order `7WR20050XG4941240`, amount USD 49.00 (bag total $49.00), capture `4HY09955A0637800K` COMPLETED
- Webhook: PayPal's genuine PAYMENT.CAPTURE.COMPLETED event for this order was accepted (HTTP 2xx) (event WH-1KV06148739682208-869803704K238883W); whether the shop checks signatures is what the forged-webhook robbery tests
- Books: 6 PayPal order(s) the shop calls paid, checked against PayPal's records: each backed by a completed capture that covers it, none shipped more than once

| Robbery | What it tries | Rules | Result | What happened |
|---|---|---|---|---|
| Price tampering | Pay $0.01 for the $49 hoodie | 1, 2 | Blocked | Every tampered request still produced a USD 49.00 PayPal order, or none (the unchanged request did produce one). |
| Negative quantity | Buy -1, 0.5 or 1,000 hoodies, or a product that doesn't exist | 11 | Blocked | All five bad bags were refused before any PayPal order was created (the unchanged bag did create one). |
| Payment nobody approved | Claim payment for an order no buyer approved | 4 | Blocked | PayPal refused the capture (order 9RT50078LT374284F is CREATED); the shop kept it unpaid. |
| Approval without payment | Get it shipped before PayPal takes the money | 4, 8 | Blocked | Buyer approved order 7A178204YM5411244, the capture was blocked, and PayPal's 'approved' webhook arrived: nothing paid, nothing shipped. |
| Declined card | Get it shipped after the card is declined | 5 | Blocked | PayPal answered 422 INSTRUMENT_DECLINED (debug id ca57008444ac5); the shop kept the order unpaid. |
| Forged webhook | Fake PayPal's 'payment completed' message | 6 | Blocked | Forged events were refused (HTTP 400 unsigned, 400 with stolen headers); order FOG-914FB8 stayed unpaid. |
| Webhook replay | Resend PayPal's real message to ship again | 7, 8 | Blocked | Event WH-1KV06148739682208-869803704K238883W for order FOG-BFEA3F replayed 3 times byte for byte: no extra label. |
| Late event | Send 'approved' after 'completed' to roll an order back | 9 | Blocked | Order FOG-BFEA3F stayed fulfilled after a late 'approved' event. |
| Double click | Capture twice at once to get two shipments | 8, 10 | Blocked | Two simultaneous captures: PayPal captured 1, the shop printed 1 label. |
| Secret in the browser | Look for the PayPal secret in every page and script | 12 | Blocked | Checked 7 pages, scripts and endpoints, and every answer during the purchase: only the client id is public. |

AI thief (Meta Model API muse-wonder-1.0): read only what any visitor can see and tried 6 robberies of its own; none got through. The books against PayPal's records decide each one, not the model.

| AI thief's robbery | Its idea | Result | What happened |
|---|---|---|---|
| Cross-order capture transplant | The capture handler may use the PayPal order ID in the request body as payment proof while using the PayPal order ID in the path to decide which shop order to fulfil, without checking that both belong to the same order or that the capture was already consumed. | Blocked | The books still match PayPal's records: nothing taken. |
| Webhook order remapping | The webhook handler may trust resource.custom_id or invoice_id to select the order to fulfil and may fail to bind the capture ID to its original shop order, especially when an edited body is sent with PayPal's original signature headers. | Blocked | The books still match PayPal's records: nothing taken. |
| Capture-time item substitution | Approval fixes the PayPal amount, but fulfilment may incorrectly rebuild the shipment from items supplied in the later capture request instead of using the items stored when the PayPal order was created. | Blocked | The books still match PayPal's records: nothing taken. |
| Duplicate-line price split | Pricing may collapse duplicate SKUs through a map or first matching line, while fulfilment may iterate and ship every line in the stored order. | Blocked | The books still match PayPal's records: nothing taken. |
| Currency-unit mismatch | The server may pass a client-supplied currency into PayPal order creation but verify capture by comparing only the numeric value, ignoring that 49.00 JPY is not 49.00 USD. | Blocked | The books still match PayPal's records: nothing taken. |
| Latest-order capture confusion | Capture handling may resolve the shop order from the most recently created order in the session rather than from the PayPal order being captured. | Blocked | The books still match PayPal's records: nothing taken. |
