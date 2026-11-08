# Heistproof evidence report

**Verdict: safe to ship.** 10 of 10 scripted robberies blocked, 0 robbed the shop. The AI thief tried 6 robberies of its own: none got through. Real purchase: paid and shipped once. Tests: pass.

All payments ran in the PayPal sandbox (no real money). Order and capture ids below are PayPal's own and can be looked up in the merchant's sandbox account.

## Round 1: first check

- Tests: pass
- Buttons shown: paypal yes, venmo yes, paylater no
- Purchase: Paid $64.00: capture 0MF04490L3408964R COMPLETED, shop order KC-1A83B8 shipped, 1 label.
  - PayPal order `10G27384JA620194C`, amount USD 64.00 (bag total $64.00), capture `0MF04490L3408964R` COMPLETED
- Webhook: PayPal's genuine PAYMENT.CAPTURE.COMPLETED event for this order was accepted (HTTP 2xx) (event WH-4GY54104U3453692X-0AM95963U2414422F); whether the shop checks signatures is what the forged-webhook robbery tests
- Books: 6 PayPal order(s) the shop calls paid, checked against PayPal's records: each backed by a completed capture that covers it, none shipped more than once

| Robbery | What it tries | Rules | Result | What happened |
|---|---|---|---|---|
| Price tampering | Pay $0.01 for the $64 kettle | 1, 2 | Blocked | Every tampered request still produced a PayPal order for USD 64.00 or more, or none (the unchanged request did produce one). |
| Negative quantity | Buy -1, 0.5 or 1,000 of an item, a product that doesn't exist, or a bag with a negative line | 11 | Blocked | All 6 bad bags were refused before any PayPal order was created (the unchanged bag did create one). |
| Payment nobody approved | Claim payment for an order no buyer approved | 4 | Blocked | The capture request, replayed for an order no buyer approved: PayPal says CREATED, and the shop kept it unpaid. |
| Approval without payment | Get it shipped before PayPal takes the money | 4, 8 | Blocked | Buyer approved order 0MU099253L6880903, the capture was blocked, and PayPal's 'approved' webhook arrived: nothing paid, nothing shipped. |
| Declined card | Get it shipped after the card is declined | 5 | Blocked | PayPal answered 422 INSTRUMENT_DECLINED (debug id ca57468ef2f69); the shop kept the order unpaid. |
| Double click | Capture twice at once to get two shipments | 8, 10 | Blocked | Two simultaneous captures: PayPal captured 1, the shop printed 1 label. |
| Forged webhook | Fake PayPal's 'payment completed' message | 6 | Blocked | Forged events got HTTP 400 unsigned and 400 with stolen signature headers, and changed nothing: order KC-1D308E stayed unpaid. |
| Webhook replay | Resend PayPal's real message to ship again | 7, 8 | Blocked | Event WH-4GY54104U3453692X-0AM95963U2414422F for order KC-1A83B8 replayed 3 times byte for byte: no extra label. |
| Late event | Send 'approved' after 'completed' to roll an order back | 9 | Blocked | Order KC-055FDD stayed shipped after a late 'approved' event. |
| Secret in the browser | Look for the PayPal secret or an access token in every page and script | 12 | Blocked | Checked 7 pages, scripts and endpoints, and every answer during the purchase: no secret and no access token, only the client id is public. |

AI thief (Meta Model API muse-wonder-1.0): read what any visitor can see and tried 6 robberies of its own; none got through. The books against PayPal's records decide each one, not the model.

| AI thief's robbery | Its idea | Result | What happened |
|---|---|---|---|
| Mutate the approved order before capture | The capture handler may use the session's latest shop order, or a second create call may upsert the same ref/PayPal order, without rechecking that the captured amount still matches the fulfilled lines. | Blocked | The books still match PayPal's records: nothing taken. |
| Duplicate-line price/fulfilment split | Pricing may collapse duplicate SKUs through a map or object while fulfilment iterates the raw lines, or the reverse validation may assume the storefront cart can never contain duplicates. | Blocked | The books still match PayPal's records: nothing taken. |
| Transplant a completed capture at capture time | The capture endpoint may trust capture identifiers or completion fields supplied in its request body, or verify the supplied old PayPal order while marking the order named in the path as paid, without checking custom_id linkage. | Blocked | The books still match PayPal's records: nothing taken. |
| Retarget a real capture webhook | The webhook handler may look up the shop order solely from edited custom_id/invoice fields and may not confirm that the capture belongs to that order or that this capture was not already consumed by another order. | Blocked | The books still match PayPal's records: nothing taken. |
| Capture another shopper's approved order | PayPal order 77Y56638MF767953X for shop order KC-C05F7E was approved but had no capture in the events; the capture route may not bind a PayPal order to the session that created or approved it. | Blocked | The books still match PayPal's records: nothing taken. |
| Currency denomination swap | Extra currency or purchase-unit fields may be passed through to PayPal, or capture validation may compare only the numeric value and ignore the currency code. | Blocked | The books still match PayPal's records: nothing taken. |
