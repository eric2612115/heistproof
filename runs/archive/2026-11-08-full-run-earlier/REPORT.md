# Heistproof evidence report

**Verdict: safe to ship.** 10 of 10 scripted robberies blocked, 0 robbed the shop. The AI thief tried 6 robberies of its own: none got through. Real purchase: paid and shipped once. Tests: pass.

All payments ran in the PayPal sandbox (no real money). Order and capture ids below are PayPal's own and can be looked up in the merchant's sandbox account.

Coding agent: Claude Code (Meta Model API muse-wonder-1.0) with APIMatic's PayPal Context Plugin. Skills it loaded: paypal:typescript-integrate-paypal, paypal:typescript-getting-started, paypal:typescript-error-handling, paypal:typescript-client-initialization, paypal:typescript-authentication, paypal:typescript-calling-endpoints, paypal:typescript-models, paypal:typescript-configuration-resilience, paypal:typescript-testing, heistproof:paypal-web-sdk-v6, heistproof:checkout-hardening.

## Round 1: first check

- Tests: pass
- Buttons shown: paypal yes, venmo yes, paylater yes; Pay Later message: "Pay in 4 interest-free payments of $12.25. Learn more"
- Purchase: Capture APPROVED; shop order FOG-DC0A9F is pending with 0 labels.
  - PayPal order `64W525091U2356921`, amount USD 49.00 (bag total $49.00), capture `none` APPROVED
- Webhook: PayPal did not deliver the PAYMENT.CAPTURE.COMPLETED event during this run
- Books: 0 PayPal order(s) the shop calls paid, checked against PayPal's records: each backed by a completed capture that covers it, none shipped more than once

| Robbery | What it tries | Rules | Result | What happened |
|---|---|---|---|---|
| Price tampering | Pay $0.01 for the $49 hoodie | 1, 2 | Blocked | Every tampered request still produced a USD 49.00 PayPal order, or none (the unchanged request did produce one). |
| Negative quantity | Buy -1, 0.5 or 1,000 hoodies, or a product that doesn't exist | 11 | Blocked | All five bad bags were refused before any PayPal order was created (the unchanged bag did create one). |
| Payment nobody approved | Claim payment for an order no buyer approved | 4 | Blocked | PayPal refused the capture (order 0JX47211P97482637 is CREATED); the shop kept it unpaid. |
| Approval without payment | Get it shipped before PayPal takes the money | 4, 8 | Blocked | Buyer approved order 81C322959P379284M, the capture was blocked, and PayPal's 'approved' webhook arrived: nothing paid, nothing shipped. |
| Declined card | Get it shipped after the card is declined | 5 | Blocked | PayPal answered 422 INSTRUMENT_DECLINED (debug id ca56fdf208bfb); the shop kept the order unpaid. |
| Forged webhook | Fake PayPal's 'payment completed' message | 6 | Not run | PayPal delivered no PAYMENT.CAPTURE.COMPLETED webhook in time to forge from. |
| Webhook replay | Resend PayPal's real message to ship again | 7, 8 | Not run | PayPal delivered no PAYMENT.CAPTURE.COMPLETED webhook about this shop's orders in time to replay. |
| Late event | Send 'approved' after 'completed' to roll an order back | 9 | Blocked | Order FOG-DC0A9F stayed pending after a late 'approved' event. |
| Double click | Capture twice at once to get two shipments | 8, 10 | Blocked | Two simultaneous captures: PayPal captured 0, the shop printed 0 label. |
| Secret in the browser | Look for the PayPal secret in every page and script | 12 | Blocked | Checked 7 pages, scripts and endpoints, and every answer during the purchase: only the client id is public. |

AI thief (Meta Model API muse-wonder-1.0): read only what any visitor can see and tried 6 robberies of its own; none got through. The books against PayPal's records decide each one, not the model.

| AI thief's robbery | Its idea | Result | What happened |
|---|---|---|---|
| Duplicate SKU lines | The server may deduplicate SKUs when pricing the PayPal order but sum the original lines when fulfilling it. | Blocked | The books still match PayPal's records: nothing taken. |
| Capture-body item inflation | The capture handler may build or update the shipment from items supplied in the capture request instead of the items stored when the $49 PayPal order was created. | Blocked | The books still match PayPal's records: nothing taken. |
| Latest-order capture swap | Capture may be associated with the shopper session's most recently created shop order rather than the shop order mapped to the PayPal order in the URL. | Blocked | The books still match PayPal's records: nothing taken. |
| Cross-order capture target | The capture handler may trust a client-supplied shop-order identifier, and a later normal capture may treat the already-captured PayPal order as proof for its original shop order without checking that the capture was already consumed. | Blocked | The books still match PayPal's records: nothing taken. |
| Bind new order to captured PayPal order | Order creation may accept supplied PayPal order or capture identifiers instead of always generating and binding a fresh PayPal order; a subsequent capture-status check may then treat the old completed capture as payment for the new, larger order. | Blocked | The books still match PayPal's records: nothing taken. |
| Cross-order capture webhook | The webhook handler may fulfil whichever shop order is named by the edited custom_id and may not bind the capture ID to its original PayPal order or reject a capture already used for another order, even when the retained signature no longer matches the edited body. | Blocked | The books still match PayPal's records: nothing taken. |

## Round 2: after fix 1

- Tests: pass
- Buttons shown: paypal yes, venmo yes, paylater yes; Pay Later message: "Buy now, pay later. Learn more"
- Purchase: Paid $49.00: capture 57S87572LP692632K COMPLETED, shop order FOG-68FC2F fulfilled, 1 label.
  - PayPal order `84250110LD9454635`, amount USD 49.00 (bag total $49.00), capture `57S87572LP692632K` COMPLETED
- Webhook: PayPal's genuine PAYMENT.CAPTURE.COMPLETED event for this order was accepted (HTTP 2xx) (event WH-68P05411MF1197533-0FX89461YT3101719); whether the shop checks signatures is what the forged-webhook robbery tests
- Books: 6 PayPal order(s) the shop calls paid, checked against PayPal's records: each backed by a completed capture that covers it, none shipped more than once

| Robbery | What it tries | Rules | Result | What happened |
|---|---|---|---|---|
| Price tampering | Pay $0.01 for the $49 hoodie | 1, 2 | Blocked | Every tampered request still produced a USD 49.00 PayPal order, or none (the unchanged request did produce one). |
| Negative quantity | Buy -1, 0.5 or 1,000 hoodies, or a product that doesn't exist | 11 | Blocked | All five bad bags were refused before any PayPal order was created (the unchanged bag did create one). |
| Payment nobody approved | Claim payment for an order no buyer approved | 4 | Blocked | PayPal refused the capture (order 4TR95435BC689202H is CREATED); the shop kept it unpaid. |
| Approval without payment | Get it shipped before PayPal takes the money | 4, 8 | Blocked | Buyer approved order 0K809194J5443704C, the capture was blocked, and PayPal's 'approved' webhook arrived: nothing paid, nothing shipped. |
| Declined card | Get it shipped after the card is declined | 5 | Blocked | PayPal answered 422 INSTRUMENT_DECLINED (debug id f849134aeae4b); the shop kept the order unpaid. |
| Forged webhook | Fake PayPal's 'payment completed' message | 6 | Blocked | Forged events were refused (HTTP 400 unsigned, 400 with stolen headers); order FOG-379813 stayed unpaid. |
| Webhook replay | Resend PayPal's real message to ship again | 7, 8 | Blocked | Event WH-68P05411MF1197533-0FX89461YT3101719 for order FOG-68FC2F replayed 3 times byte for byte: no extra label. |
| Late event | Send 'approved' after 'completed' to roll an order back | 9 | Blocked | Order FOG-68FC2F stayed fulfilled after a late 'approved' event. |
| Double click | Capture twice at once to get two shipments | 8, 10 | Blocked | Two simultaneous captures: PayPal captured 1, the shop printed 1 label. |
| Secret in the browser | Look for the PayPal secret in every page and script | 12 | Blocked | Checked 7 pages, scripts and endpoints, and every answer during the purchase: only the client id is public. |

AI thief (Meta Model API muse-wonder-1.0): read only what any visitor can see and tried 6 robberies of its own; none got through. The books against PayPal's records decide each one, not the model.

| AI thief's robbery | Its idea | Result | What happened |
|---|---|---|---|
| Rebind old capture to big order | The webhook handler trusts resource.custom_id/invoice_id to choose the shop order and trusts the reused capture ID, without checking that PayPal's captured order, capture amount, or invoice actually belong to that shop order. | Blocked | The books still match PayPal's records: nothing taken. |
| One-dollar partial capture | After approval for the full $49 PayPal order, the capture endpoint may forward a client-supplied capture amount to PayPal, or accept it locally, and then treat any COMPLETED capture as payment in full without comparing the captured amount with the shop order total. | Blocked | The books still match PayPal's records: nothing taken. |
| Pay in yen, fulfil in dollars | The create-order endpoint may pass a client-supplied currency through to PayPal while the shop still compares only the numeric value 49.00 and fulfils as though 49 USD had been paid. | Blocked | The books still match PayPal's records: nothing taken. |
| Duplicate lines, single charge | Pricing or PayPal item creation may deduplicate repeated SKUs by keeping or overwriting one line, while fulfilment may sum every submitted line; the normal bag never produces duplicate lines, so this split may be untested. | Blocked | The books still match PayPal's records: nothing taken. |
| Inject old capture into new capture | The capture endpoint may trust captureId/status fields in its request body, or fetch the supplied capture and check only that it is COMPLETED, without binding that capture to the PayPal order in the path or to the new shop order. | Blocked | The books still match PayPal's records: nothing taken. |
| Swap the bag after approval | Capture may fulfil the session's or email's latest pending shop order rather than the shop order immutably bound to the PayPal order ID in the capture path, allowing the bag/order to be changed after approval but before capture. | Blocked | The books still match PayPal's records: nothing taken. |
