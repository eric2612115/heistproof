# Heistproof evidence report

**Verdict: incomplete; nothing got through, but not every robbery ran, so run it again.** 7 of 10 scripted robberies blocked, 0 robbed the shop. The AI thief tried 6 robberies of its own: none got through. Real purchase: paid and shipped once. Tests: pass.

All payments ran in the PayPal sandbox (no real money). Order and capture ids below are PayPal's own and can be looked up in the merchant's sandbox account.

## Round 1: first check

- Tests: pass
- Buttons shown: paypal yes, venmo yes, paylater no
- Purchase: Paid $64.00: capture 0GK5123590704015S COMPLETED, shop order KC-326E8E shipped, 1 label.
  - PayPal order `8EY53815X0040342N`, amount USD 64.00 (bag total $64.00), capture `0GK5123590704015S` COMPLETED
- Webhook: PayPal's genuine PAYMENT.CAPTURE.COMPLETED event for this order was accepted (HTTP 2xx) (event WH-5C591507B2106840M-3GA03614CW0742201); whether the shop checks signatures is what the forged-webhook robbery tests
- Books: 6 PayPal order(s) the shop calls paid, checked against PayPal's records: each backed by a completed capture that covers it, none shipped more than once

| Robbery | What it tries | Rules | Result | What happened |
|---|---|---|---|---|
| Price tampering | Pay $0.01 for the $49 hoodie | 1, 2 | Blocked | Every tampered request still produced a USD 64.00 PayPal order, or none (the unchanged request did produce one). |
| Negative quantity | Buy -1, 0.5 or 1,000 hoodies, or a product that doesn't exist | 11 | Blocked | All five bad bags were refused before any PayPal order was created (the unchanged bag did create one). |
| Payment nobody approved | Claim payment for an order no buyer approved | 4 | Blocked | PayPal refused the capture (order 0DP10072F60787904 is CREATED); the shop kept it unpaid. |
| Approval without payment | Get it shipped before PayPal takes the money | 4, 8 | Blocked | Buyer approved order 0W555507FT4399826, the capture was blocked, and PayPal's 'approved' webhook arrived: nothing paid, nothing shipped. |
| Declined card | Get it shipped after the card is declined | 5 | Blocked | PayPal answered 422 INSTRUMENT_DECLINED (debug id f7478105e59cb); the shop kept the order unpaid. |
| Forged webhook | Fake PayPal's 'payment completed' message | 6 | Not run | PayPal delivered no PAYMENT.CAPTURE.COMPLETED webhook in time to forge from. |
| Webhook replay | Resend PayPal's real message to ship again | 7, 8 | Not run | PayPal delivered no PAYMENT.CAPTURE.COMPLETED webhook about this shop's orders in time to replay. |
| Late event | Send 'approved' after 'completed' to roll an order back | 9 | Not run | PayPal sent no CHECKOUT.ORDER.APPROVED event for any paid order of this shop. |
| Double click | Capture twice at once to get two shipments | 8, 10 | Blocked | Two simultaneous captures: PayPal captured 1, the shop printed 1 label. |
| Secret in the browser | Look for the PayPal secret in every page and script | 12 | Blocked | Checked 7 pages, scripts and endpoints, and every answer during the purchase: only the client id is public. |

AI thief (Meta Model API muse-wonder-1.0): read only what any visitor can see and tried 6 robberies of its own; none got through. The books against PayPal's records decide each one, not the model.

| AI thief's robbery | Its idea | Result | What happened |
|---|---|---|---|
| Latest-order capture mix-up | The shop may bind a capture to its most recently created session order instead of the shop order originally bound to that PayPal order. | Blocked | The books still match PayPal's records: nothing taken. |
| Capture-time basket upsizing | The capture handler may trust lines supplied in the capture request when creating the shipment, even though PayPal captures only the originally approved amount. | Blocked | The books still match PayPal's records: nothing taken. |
| Legitimate capture, different beneficiary | The capture endpoint may mark the shop order named in the request body as paid when presented with an already completed legitimate PayPal capture, instead of enforcing the original PayPal-order-to-shop-order binding. | Blocked | The books still match PayPal's records: nothing taken. |
| Webhook retargeted to unpaid order | The webhook handler may select the order solely from resource.custom_id and trust the completed status and edited amount without properly verifying the signature or the capture's original order binding. | Blocked | The books still match PayPal's records: nothing taken. |
| Duplicate-line split brain | Pricing may collapse duplicate product lines by SKU while fulfilment iterates every raw line, creating a discrepancy between the charged and shipped quantities. | Blocked | The books still match PayPal's records: nothing taken. |
| Currency-unit confusion | The shop may keep the numeric total at 64 while passing a client-supplied currency to PayPal, then record the captured order as a completed USD payment without checking the captured currency. | Blocked | The books still match PayPal's records: nothing taken. |
