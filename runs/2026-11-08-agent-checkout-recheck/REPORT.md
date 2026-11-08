# Heistproof evidence report

**Verdict: safe to ship.** 10 of 10 scripted robberies blocked, 0 robbed the shop. The AI thief tried 6 robberies of its own: none got through. Real purchase: paid and shipped once. Tests: pass.

All payments ran in the PayPal sandbox (no real money). Order and capture ids below are PayPal's own and can be looked up in the merchant's sandbox account.

## Round 1: first check

- Tests: pass
- Buttons shown: paypal yes, venmo yes, paylater yes; Pay Later message: "Buy now, pay later. Learn more"
- Purchase: Paid $49.00: capture 4UE23465BJ204744J COMPLETED, shop order FOG-E2BA4B fulfilled, 1 label.
  - PayPal order `66N927835D354941Y`, amount USD 49.00 (bag total $49.00), capture `4UE23465BJ204744J` COMPLETED
- Webhook: PayPal's genuine PAYMENT.CAPTURE.COMPLETED event for this order was accepted (HTTP 2xx) (event WH-50A81783PU575494Y-1XF5799884837322W); whether the shop checks signatures is what the forged-webhook robbery tests
- Books: 6 PayPal order(s) the shop calls paid, checked against PayPal's records: each backed by a completed capture that covers it, none shipped more than once (1 paid another way, not PayPal's to check)

| Robbery | What it tries | Rules | Result | What happened |
|---|---|---|---|---|
| Price tampering | Pay $0.01 for the $49 hoodie | 1, 2 | Blocked | Every tampered request still produced a PayPal order for USD 49.00 or more, or none (the unchanged request did produce one). |
| Negative quantity | Buy -1, 0.5 or 1,000 of an item, a product that doesn't exist, or a bag with a negative line | 11 | Blocked | All 6 bad bags were refused before any PayPal order was created (the unchanged bag did create one). |
| Payment nobody approved | Claim payment for an order no buyer approved | 4 | Blocked | The capture request, replayed for an order no buyer approved: PayPal says CREATED, and the shop kept it unpaid. |
| Approval without payment | Get it shipped before PayPal takes the money | 4, 8 | Blocked | Buyer approved order 1CU74512949303923, the capture was blocked, and PayPal's 'approved' webhook arrived: nothing paid, nothing shipped. |
| Declined card | Get it shipped after the card is declined | 5 | Blocked | PayPal answered 422 INSTRUMENT_DECLINED (debug id f9677814354af); the shop kept the order unpaid. |
| Double click | Capture twice at once to get two shipments | 8, 10 | Blocked | Two simultaneous captures: PayPal captured 1, the shop printed 1 label. |
| Forged webhook | Fake PayPal's 'payment completed' message | 6 | Blocked | Forged events got HTTP 400 unsigned and 400 with stolen signature headers, and changed nothing: order FOG-BEA816 stayed unpaid. |
| Webhook replay | Resend PayPal's real message to ship again | 7, 8 | Blocked | Event WH-50A81783PU575494Y-1XF5799884837322W for order FOG-E2BA4B replayed 3 times byte for byte: no extra label. |
| Late event | Send 'approved' after 'completed' to roll an order back | 9 | Blocked | Order FOG-C3FEB1 stayed fulfilled after a late 'approved' event. |
| Secret in the browser | Look for the PayPal secret or an access token in every page and script | 12 | Blocked | Checked 7 pages, scripts and endpoints, and every answer during the purchase: no secret and no access token, only the client id is public. |

AI thief (Meta Model API muse-wonder-1.0): read what any visitor can see and tried 6 robberies of its own; none got through. The books against PayPal's records decide each one, not the model.

| AI thief's robbery | Its idea | Result | What happened |
|---|---|---|---|
| Webhook redirected to bulk order | The webhook trusts resource.custom_id/invoice_id to choose which shop order to fulfill, without binding the capture ID to its original order or checking that the $49 capture covers the target order's total. | Blocked | The books still match PayPal's records: nothing taken. |
| Item swap at capture time | The capture endpoint fulfills items sent in the capture request instead of the items snapshotted when the $49 PayPal order was created and approved. | Blocked | The books still match PayPal's records: nothing taken. |
| Paid flags planted at creation | The create-order handler stores extra client-supplied payment fields on the shop order, and the capture handler short-circuits an order already marked paid instead of asking PayPal to capture. | Blocked | The books still match PayPal's records: nothing taken. |
| Currency-unit confusion | The server lets the client choose the PayPal currency but capture validation compares only the numeric value 49.00, ignoring that 49 JPY is not 49 USD. | Blocked | The books still match PayPal's records: nothing taken. |
| Stranger's approved PayPal order | The capture endpoint does not require the PayPal order to have been created by this shop session; it captures any approved PayPal order and fulfills the shop reference inside it. The APPROVED event for 0AP640430R1195602 (FOG-D5417D) has no matching capture event. | Blocked | The books still match PayPal's records: nothing taken. |
| Duplicate card lines, priced once | Card checkout deduplicates lines by SKU when pricing or charging (e.g. a Map keyed by SKU) but fulfillment iterates the raw line list, so split lines slip past per-line quantity logic. | Blocked | The books still match PayPal's records: nothing taken. |
