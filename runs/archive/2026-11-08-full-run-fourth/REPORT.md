# Heistproof evidence report

**Verdict: safe to ship.** 10 of 10 scripted robberies blocked, 0 robbed the shop. The AI thief tried 6 robberies of its own: none got through. Real purchase: paid and shipped once. Tests: pass.

All payments ran in the PayPal sandbox (no real money). Order and capture ids below are PayPal's own and can be looked up in the merchant's sandbox account.

Coding agent: Claude Code (Meta Model API muse-wonder-1.0) with APIMatic's PayPal Context Plugin. Skills it loaded: paypal:typescript-integrate-paypal, paypal:typescript-getting-started, paypal:typescript-error-handling, heistproof:paypal-web-sdk-v6, heistproof:checkout-hardening, paypal:typescript-client-initialization, paypal:typescript-authentication, paypal:typescript-calling-endpoints, paypal:typescript-models, paypal:typescript-configuration-resilience, paypal:typescript-testing.

## Round 1: first check

- Tests: pass
- Buttons shown: paypal yes, venmo yes, paylater yes; Pay Later message: "Pay in 4 interest-free payments of $12.25. Learn more"
- Purchase: Capture APPROVED; shop order FOG-1D6BB8 is pending with 0 labels.
  - PayPal refused `POST /v2/checkout/orders/81J53453W81649536/capture`: HTTP 415 UNSUPPORTED_MEDIA_TYPE, "The request payload is not supported", debug id `ca571d11c6846`
  - PayPal order `81J53453W81649536`, amount USD 49.00 (bag total $49.00), capture `none` APPROVED
- Webhook: PayPal did not deliver the PAYMENT.CAPTURE.COMPLETED event during this run
- Books: 0 PayPal order(s) the shop calls paid, checked against PayPal's records: each backed by a completed capture that covers it, none shipped more than once

| Robbery | What it tries | Rules | Result | What happened |
|---|---|---|---|---|
| Price tampering | Pay $0.01 for the $49 hoodie | 1, 2 | Blocked | Every tampered request still produced a PayPal order for USD 49.00 or more, or none (the unchanged request did produce one). |
| Negative quantity | Buy -1, 0.5 or 1,000 of an item, a product that doesn't exist, or a bag with a negative line | 11 | Blocked | All 6 bad bags were refused before any PayPal order was created (the unchanged bag did create one). |
| Payment nobody approved | Claim payment for an order no buyer approved | 4 | Blocked | The capture request, replayed for an order no buyer approved: PayPal says CREATED, and the shop kept it unpaid. |
| Approval without payment | Get it shipped before PayPal takes the money | 4, 8 | Blocked | Buyer approved order 6P749026XS396484Y, the capture was blocked, and PayPal's 'approved' webhook arrived: nothing paid, nothing shipped. |
| Declined card | Get it shipped after the card is declined | 5 | Blocked | PayPal answered 422 INSTRUMENT_DECLINED (debug id ca571d2f21803); the shop kept the order unpaid. |
| Double click | Capture twice at once to get two shipments | 8, 10 | Not run | Neither of two simultaneous capture requests captured order 6P749026XS396484Y (shop answered 415 and 409), so the capture route does not work and a double capture tests nothing. |
| Forged webhook | Fake PayPal's 'payment completed' message | 6 | Not run | PayPal delivered no PAYMENT.CAPTURE.COMPLETED webhook in time to forge from. |
| Webhook replay | Resend PayPal's real message to ship again | 7, 8 | Not run | PayPal delivered no PAYMENT.CAPTURE.COMPLETED webhook about this shop's orders in time to replay. |
| Late event | Send 'approved' after 'completed' to roll an order back | 9 | Not run | Order FOG-1D6BB8 was never paid (pending), so a late 'approved' event has nothing to roll back. |
| Secret in the browser | Look for the PayPal secret or an access token in every page and script | 12 | Blocked | Checked 7 pages, scripts and endpoints, and every answer during the purchase: no secret and no access token, only the client id is public. |

AI thief: not run (the shop's capture did not work, so nothing could be paid for the thief to steal).

## Round 2: after fix 1

- Tests: pass
- Buttons shown: paypal yes, venmo yes, paylater yes; Pay Later message: "Pay in 4 interest-free payments of $12.25. Learn more"
- Purchase: Paid $49.00: capture 719605298L643003X COMPLETED, shop order FOG-59ED39 fulfilled, 1 label.
  - PayPal order `8NH0429814376320W`, amount USD 49.00 (bag total $49.00), capture `719605298L643003X` COMPLETED
- Webhook: PayPal's genuine PAYMENT.CAPTURE.COMPLETED event for this order was accepted (HTTP 2xx) (event WH-3MF329485C939891V-6VF803443C952664A); whether the shop checks signatures is what the forged-webhook robbery tests
- Books: 5 PayPal order(s) the shop calls paid, checked against PayPal's records: each backed by a completed capture that covers it, none shipped more than once

| Robbery | What it tries | Rules | Result | What happened |
|---|---|---|---|---|
| Price tampering | Pay $0.01 for the $49 hoodie | 1, 2 | Blocked | Every tampered request still produced a PayPal order for USD 49.00 or more, or none (the unchanged request did produce one). |
| Negative quantity | Buy -1, 0.5 or 1,000 of an item, a product that doesn't exist, or a bag with a negative line | 11 | Blocked | All 6 bad bags were refused before any PayPal order was created (the unchanged bag did create one). |
| Payment nobody approved | Claim payment for an order no buyer approved | 4 | Blocked | The capture request, replayed for an order no buyer approved: PayPal says CREATED, and the shop kept it unpaid. |
| Approval without payment | Get it shipped before PayPal takes the money | 4, 8 | Blocked | Buyer approved order 1UJ756681X4049458, the capture was blocked, and PayPal's 'approved' webhook arrived: nothing paid, nothing shipped. |
| Declined card | Get it shipped after the card is declined | 5 | Blocked | PayPal answered 422 INSTRUMENT_DECLINED (debug id ca571daf4cd78); the shop kept the order unpaid. |
| Double click | Capture twice at once to get two shipments | 8, 10 | Blocked | Two simultaneous captures: PayPal captured 1, the shop printed 1 label. |
| Forged webhook | Fake PayPal's 'payment completed' message | 6 | Blocked | Forged events got HTTP 400 unsigned and 400 with stolen signature headers, and changed nothing: order FOG-6018D2 stayed unpaid. |
| Webhook replay | Resend PayPal's real message to ship again | 7, 8 | Blocked | Event WH-3MF329485C939891V-6VF803443C952664A for order FOG-59ED39 replayed 3 times byte for byte: no extra label. |
| Late event | Send 'approved' after 'completed' to roll an order back | 9 | Blocked | Order FOG-1632F1 stayed fulfilled after a late 'approved' event. |
| Secret in the browser | Look for the PayPal secret or an access token in every page and script | 12 | Blocked | Checked 7 pages, scripts and endpoints, and every answer during the purchase: no secret and no access token, only the client id is public. |

AI thief (Meta Model API muse-wonder-1.0): read what any visitor can see and tried 6 robberies of its own; none got through. The books against PayPal's records decide each one, not the model.

| AI thief's robbery | Its idea | Result | What happened |
|---|---|---|---|
| Capture once, fulfil twice via body order ID | The capture endpoint may fulfil the shop order named in the request body, or both that order and the PayPal order in the URL, instead of binding fulfilment only to the captured PayPal order. | Blocked | The books still match PayPal's records: nothing taken. |
| Orphan capture webhook transplant | A real $49 capture belonging to FOG-1632F1 may be reusable if the webhook handler routes solely by custom_id/invoice_id and does not bind the capture ID to its original PayPal order or reject its use for another shop order. | Blocked | The books still match PayPal's records: nothing taken. |
| Rail switch after PayPal approval | After a PayPal order is approved but its capture is blocked, switching to the card route for the same session/order may make the shop treat the earlier approval as payment despite the card being declined. | Blocked | The books still match PayPal's records: nothing taken. |
| Duplicate SKU line split | The PayPal order builder may deduplicate or aggregate duplicate SKU lines when charging, while fulfilment may process every line separately. | Blocked | The books still match PayPal's records: nothing taken. |
| Currency code mismatch | The shop may verify only the numeric amount 49.00 and ignore the currency code, allowing the PayPal order to be created and approved in a much weaker currency. | Blocked | The books still match PayPal's records: nothing taken. |
| Client-written payment status | Order creation or the order resource may mass-assign client-supplied status, paid, or capture fields instead of deriving payment status only from PayPal. | Blocked | The books still match PayPal's records: nothing taken. |
