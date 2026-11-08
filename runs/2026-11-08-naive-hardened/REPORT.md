# Heistproof evidence report

**Verdict: safe to ship.** 10 of 10 scripted robberies blocked, 0 robbed the shop. The AI thief tried 6 robberies of its own: none got through. Real purchase: paid and shipped once. Tests: pass.

All payments ran in the PayPal sandbox (no real money). Order and capture ids below are PayPal's own and can be looked up in the merchant's sandbox account.

Coding agent: Claude Code (Meta Model API muse-wonder-1.0) with APIMatic's PayPal Context Plugin. Skills it loaded: heistproof:checkout-hardening, paypal:typescript-error-handling, heistproof:paypal-web-sdk-v6.

## Round 1: first check

- Tests: pass
- Buttons shown: paypal yes, venmo no, paylater no
- Purchase: PayPal would charge $4900.00 for a $49.00 bag.
  - PayPal order `5XH77902V0252363N`, amount USD 4900.00 (bag total $49.00), capture `none` 
- Webhook: PayPal did not deliver the PAYMENT.CAPTURE.COMPLETED event during this run
- Books: not matched (the back office shows no PayPal ids)

| Robbery | What it tries | Rules | Result | What happened |
|---|---|---|---|---|
| Price tampering | Pay $0.01 for the $49 hoodie | 1, 2 | ROBBED | Shipped the $49 hoodie after PayPal captured USD 0.01 (order 2M739916V2141413Y); the shop's back office says fulfilled. |
| Negative quantity | Buy -1, 0.5 or 1,000 of an item, a product that doesn't exist, or a bag with a negative line | 11 | Blocked | All 6 bad bags were refused before any PayPal order was created (the unchanged bag did create one). |
| Payment nobody approved | Claim payment for an order no buyer approved | 4 | ROBBED | /api/paypal/orders/76C789280B9221313/capture, sent for order 76C789280B9221313, which no buyer approved, made the shop mark it paid although PayPal says CREATED. |
| Secret in the browser | Look for the PayPal secret or an access token in every page and script | 12 | Blocked | Checked 8 pages, scripts and endpoints, and every answer during the purchase: no secret and no access token, only the client id is public. |

AI thief: not run (the real purchase never reached a buyer's approval, so there was no checkout to rob).

## Round 2: after fix 1

- Tests: pass
- Buttons shown: paypal yes, venmo no, paylater no
- Purchase: Paid $49.00: capture 5L048926NX296783F COMPLETED, shop order FOG-1B7782 fulfilled, 1 label.
  - PayPal order `7J852647XX130910K`, amount USD 49.00 (bag total $49.00), capture `5L048926NX296783F` COMPLETED
- Webhook: PayPal's genuine PAYMENT.CAPTURE.COMPLETED event for this order was accepted (HTTP 2xx) (event WH-30752836E8620131A-3F1391504H093953D); whether the shop checks signatures is what the forged-webhook robbery tests
- Books: 6 PayPal order(s) the shop calls paid, checked against PayPal's records: each backed by a completed capture that covers it, none shipped more than once

| Robbery | What it tries | Rules | Result | What happened |
|---|---|---|---|---|
| Price tampering | Pay $0.01 for the $49 hoodie | 1, 2 | Blocked | Every tampered request still produced a PayPal order for USD 49.00 or more, or none (the unchanged request did produce one). |
| Negative quantity | Buy -1, 0.5 or 1,000 of an item, a product that doesn't exist, or a bag with a negative line | 11 | Blocked | All 6 bad bags were refused before any PayPal order was created (the unchanged bag did create one). |
| Payment nobody approved | Claim payment for an order no buyer approved | 4 | Blocked | The capture request, replayed for an order no buyer approved: PayPal says CREATED, and the shop kept it unpaid. |
| Approval without payment | Get it shipped before PayPal takes the money | 4, 8 | Blocked | Buyer approved order 56W03032YV8489814, the capture was blocked, and PayPal's 'approved' webhook arrived: nothing paid, nothing shipped. |
| Declined card | Get it shipped after the card is declined | 5 | Blocked | PayPal answered 422 INSTRUMENT_DECLINED (debug id ca5748dbbeebc); the shop kept the order unpaid. |
| Double click | Capture twice at once to get two shipments | 8, 10 | Blocked | Two simultaneous captures: PayPal captured 1, the shop printed 1 label. |
| Forged webhook | Fake PayPal's 'payment completed' message | 6 | Blocked | Forged events got HTTP 400 unsigned and 400 with stolen signature headers, and changed nothing: order FOG-AC8A4A stayed unpaid. |
| Webhook replay | Resend PayPal's real message to ship again | 7, 8 | Blocked | Event WH-30752836E8620131A-3F1391504H093953D for order FOG-D4C0CB replayed 3 times byte for byte: no extra label. |
| Late event | Send 'approved' after 'completed' to roll an order back | 9 | Blocked | Order FOG-1B7782 stayed fulfilled after a late 'approved' event. |
| Secret in the browser | Look for the PayPal secret or an access token in every page and script | 12 | Blocked | Checked 8 pages, scripts and endpoints, and every answer during the purchase: no secret and no access token, only the client id is public. |

AI thief (Meta Model API muse-wonder-1.0): read what any visitor can see and tried 6 robberies of its own; none got through. The books against PayPal's records decide each one, not the model.

| AI thief's robbery | Its idea | Result | What happened |
|---|---|---|---|
| Duplicate lines, split totals | The PayPal pricing code deduplicates items by SKU while the shop-order code sums every submitted line, so two identical lines are charged once but fulfilled twice. | Blocked | The books still match PayPal's records: nothing taken. |
| Yen amount, dollar goods | The server forwards a client-supplied currency to PayPal but compares only the numeric capture value with the USD total, ignoring currency_code during fulfillment. | Blocked | The books still match PayPal's records: nothing taken. |
| Capture pointed at pricier order | The capture handler trusts a shop-order identifier supplied in the capture request body or header instead of deriving the shop order exclusively from the captured PayPal order. | Blocked | The books still match PayPal's records: nothing taken. |
| Real capture webhook, new beneficiary | The webhook handler fulfills whichever shop order is named by resource.custom_id or invoice_id without proving that the referenced capture belongs to that order or was not already consumed by another order. | Blocked | The books still match PayPal's records: nothing taken. |
| Card checkout with prepaid proof | The card-order handler trusts client-supplied payment status or an existing PayPal capture proof, or creates a fulfilled order before validating that a usable card was supplied; this differs from submitting a formally declined card. | Blocked | The books still match PayPal's records: nothing taken. |
| Write the order paid directly | Although the browser only reads /api/orders/{id}, the same resource may accept an unauthenticated POST that merges status and payment fields into the stored pending order. | Blocked | The books still match PayPal's records: nothing taken. |
