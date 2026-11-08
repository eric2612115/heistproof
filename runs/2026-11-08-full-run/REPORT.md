# Heistproof evidence report

**Verdict: safe to ship.** 10 of 10 scripted robberies blocked, 0 robbed the shop. The AI thief tried 6 robberies of its own: none got through. Real purchase: paid and shipped once. Tests: pass.

All payments ran in the PayPal sandbox (no real money). Order and capture ids below are PayPal's own and can be looked up in the merchant's sandbox account.

Coding agent: Claude Code (Meta Model API muse-wonder-1.0) with APIMatic's PayPal Context Plugin. Skills it loaded: paypal:typescript-integrate-paypal, paypal:typescript-getting-started, paypal:typescript-error-handling, paypal:typescript-client-initialization, paypal:typescript-authentication, paypal:typescript-calling-endpoints, paypal:typescript-models, paypal:typescript-configuration-resilience, paypal:typescript-testing, heistproof:paypal-web-sdk-v6, heistproof:checkout-hardening.

## Round 1: first check

- Tests: pass
- Buttons shown: paypal yes, venmo yes, paylater yes; Pay Later message: "Pay in 4 interest-free payments of $12.25. Learn more"
- Purchase: Capture APPROVED; shop order FOG-AEE253 is pending with 0 labels.
  - PayPal order `0T870764UE612423C`, amount USD 49.00 (bag total $49.00), capture `none` APPROVED
- Webhook: PayPal did not deliver the PAYMENT.CAPTURE.COMPLETED event during this run
- Books: 0 PayPal order(s) the shop calls paid, checked against PayPal's records: each backed by a completed capture that covers it, none shipped more than once

| Robbery | What it tries | Rules | Result | What happened |
|---|---|---|---|---|
| Price tampering | Pay $0.01 for the $49 hoodie | 1, 2 | Blocked | Every tampered request still produced a PayPal order for USD 49.00 or more, or none (the unchanged request did produce one). |
| Negative quantity | Buy -1, 0.5 or 1,000 of an item, a product that doesn't exist, or a bag with a negative line | 11 | Blocked | All 6 bad bags were refused before any PayPal order was created (the unchanged bag did create one). |
| Payment nobody approved | Claim payment for an order no buyer approved | 4 | Blocked | PayPal refused the capture (order 61J57861FM2761718 is CREATED); the shop kept it unpaid. |
| Approval without payment | Get it shipped before PayPal takes the money | 4, 8 | Blocked | Buyer approved order 8F419478DS108973T, the capture was blocked, and PayPal's 'approved' webhook arrived: nothing paid, nothing shipped. |
| Declined card | Get it shipped after the card is declined | 5 | Blocked | PayPal answered 422 INSTRUMENT_DECLINED (debug id f170630194c79); the shop kept the order unpaid. |
| Double click | Capture twice at once to get two shipments | 8, 10 | Not run | Neither of two simultaneous capture requests captured order 8F419478DS108973T (shop answered 415 and 409), so the capture route does not work and a double capture tests nothing. |
| Forged webhook | Fake PayPal's 'payment completed' message | 6 | Not run | PayPal delivered no PAYMENT.CAPTURE.COMPLETED webhook in time to forge from. |
| Webhook replay | Resend PayPal's real message to ship again | 7, 8 | Not run | PayPal delivered no PAYMENT.CAPTURE.COMPLETED webhook about this shop's orders in time to replay. |
| Late event | Send 'approved' after 'completed' to roll an order back | 9 | Blocked | Order FOG-AEE253 stayed pending after a late 'approved' event. |
| Secret in the browser | Look for the PayPal secret or an access token in every page and script | 12 | Blocked | Checked 7 pages, scripts and endpoints, and every answer during the purchase: no secret and no access token, only the client id is public. |

AI thief (Meta Model API muse-wonder-1.0): read only what any visitor can see and tried 6 robberies of its own; none got through. The books against PayPal's records decide each one, not the model.

| AI thief's robbery | Its idea | Result | What happened |
|---|---|---|---|
| Retargeted capture webhook | The webhook handler trusts resource.custom_id and does not check that the capture was already consumed by another order or that its related PayPal order matches the target order. | Blocked | The books still match PayPal's records: nothing taken. |
| Capture applied to larger order | The capture endpoint selects the shop order from client-supplied body fields instead of the shop order immutably bound to the approved PayPal order, and does not compare totals. | Blocked | The books still match PayPal's records: nothing taken. |
| Duplicate SKU-line aggregation | Each duplicate line has a valid SKU and quantity, but pricing may deduplicate lines by SKU while fulfillment retains every raw line, or the reverse validation mismatch occurs. | Blocked | The books still match PayPal's records: nothing taken. |
| Partial capture, full fulfillment | Creation and approval are honestly for $49, but the capture stage forwards a client-chosen capture amount or marks the order fulfilled for any completed partial capture without checking the captured total. | Blocked | The books still match PayPal's records: nothing taken. |
| Currency-unit confusion | The numeric amount remains 49.00, but a client-supplied currency changes the PayPal charge to yen while the shop compares only the numeric value or treats the result as USD. | Blocked | The books still match PayPal's records: nothing taken. |
| Post-approval basket mutation | After a $49 PayPal order is approved, a second create-order call supplying the existing PayPal and shop IDs may upsert or rebind that payment to a larger basket instead of treating the approved basket as immutable. | Blocked | The books still match PayPal's records: nothing taken. |

## Round 2: after fix 1

- Tests: pass
- Buttons shown: paypal yes, venmo yes, paylater yes; Pay Later message: "Pay in 4 interest-free payments of $12.25. Learn more"
- Purchase: Paid $49.00: capture 25S122173U204322F COMPLETED, shop order FOG-805CE8 fulfilled, 1 label.
  - PayPal order `2WC16873X0724890J`, amount USD 49.00 (bag total $49.00), capture `25S122173U204322F` COMPLETED
- Webhook: PayPal's genuine PAYMENT.CAPTURE.COMPLETED event for this order was accepted (HTTP 2xx) (event WH-5R508209TT676330J-77D56520TS761352W); whether the shop checks signatures is what the forged-webhook robbery tests
- Books: 6 PayPal order(s) the shop calls paid, checked against PayPal's records: each backed by a completed capture that covers it, none shipped more than once

| Robbery | What it tries | Rules | Result | What happened |
|---|---|---|---|---|
| Price tampering | Pay $0.01 for the $49 hoodie | 1, 2 | Blocked | Every tampered request still produced a PayPal order for USD 49.00 or more, or none (the unchanged request did produce one). |
| Negative quantity | Buy -1, 0.5 or 1,000 of an item, a product that doesn't exist, or a bag with a negative line | 11 | Blocked | All 6 bad bags were refused before any PayPal order was created (the unchanged bag did create one). |
| Payment nobody approved | Claim payment for an order no buyer approved | 4 | Blocked | PayPal refused the capture (order 44X62598EA596535Y is CREATED); the shop kept it unpaid. |
| Approval without payment | Get it shipped before PayPal takes the money | 4, 8 | Blocked | Buyer approved order 42W82773K6062100P, the capture was blocked, and PayPal's 'approved' webhook arrived: nothing paid, nothing shipped. |
| Declined card | Get it shipped after the card is declined | 5 | Blocked | PayPal answered 422 INSTRUMENT_DECLINED (debug id ca570fa1eba90); the shop kept the order unpaid. |
| Double click | Capture twice at once to get two shipments | 8, 10 | Blocked | Two simultaneous captures: PayPal captured 1, the shop printed 1 label. |
| Forged webhook | Fake PayPal's 'payment completed' message | 6 | Blocked | Forged events got HTTP 400 unsigned and 400 with stolen signature headers, and changed nothing: order FOG-7E4C76 stayed unpaid. |
| Webhook replay | Resend PayPal's real message to ship again | 7, 8 | Blocked | Event WH-5R508209TT676330J-77D56520TS761352W for order FOG-805CE8 replayed 3 times byte for byte: no extra label. |
| Late event | Send 'approved' after 'completed' to roll an order back | 9 | Blocked | Order FOG-805CE8 stayed fulfilled after a late 'approved' event. |
| Secret in the browser | Look for the PayPal secret or an access token in every page and script | 12 | Blocked | Checked 7 pages, scripts and endpoints, and every answer during the purchase: no secret and no access token, only the client id is public. |

AI thief (Meta Model API muse-wonder-1.0): read only what any visitor can see and tried 6 robberies of its own; none got through. The books against PayPal's records decide each one, not the model.

| AI thief's robbery | Its idea | Result | What happened |
|---|---|---|---|
| Penny final capture | The capture endpoint may forward a client-supplied capture amount to PayPal and then accept any COMPLETED capture without comparing it with the $49 order total. | Blocked | The books still match PayPal's records: nothing taken. |
| Yen instead of dollars | Order creation may preserve the numeric value 49.00 while trusting a client-supplied currency, although fulfillment and total checks treat that value as USD. | Blocked | The books still match PayPal's records: nothing taken. |
| Duplicate SKU lines | Pricing may deduplicate repeated SKUs, as the browser bag does, while fulfillment may retain every raw line sent directly to the API. | Blocked | The books still match PayPal's records: nothing taken. |
| Mass-assigned paid state | The create-order endpoint may copy more client fields than items and email into the shop order, allowing payment status or an existing capture reference to be preset. | Blocked | The books still match PayPal's records: nothing taken. |
| Cross-order capture webhook | The webhook handler may locate an order solely through edited custom_id or invoice_id fields and may not ensure that the signed capture was unused, belonged to that PayPal order, or covered its larger total. | Blocked | The books still match PayPal's records: nothing taken. |
| Post-approval cart swap | After a $49 order is approved, the capture handler may trust items, status, or a capture identifier supplied in the capture request instead of the items snapshot attached to the approved PayPal order. | Blocked | The books still match PayPal's records: nothing taken. |
