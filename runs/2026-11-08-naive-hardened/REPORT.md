# Heistproof evidence report

**Verdict: safe to ship.** 10 of 10 scripted robberies blocked, 0 robbed the shop. The AI thief tried 6 robberies of its own: none got through. Real purchase: paid and shipped once. Tests: pass.

All payments ran in the PayPal sandbox (no real money). Order and capture ids below are PayPal's own and can be looked up in the merchant's sandbox account.

Coding agent: Claude Code (Meta Model API muse-wonder-1.0) with APIMatic's PayPal Context Plugin. Skills it loaded: heistproof:checkout-hardening, heistproof:paypal-web-sdk-v6, paypal:typescript-error-handling.

## Round 1: first check

- Tests: pass
- Buttons shown: paypal yes, venmo no, paylater no
- Purchase: PayPal would charge $4900.00 for a $49.00 bag.
  - PayPal order `3DA10531EM498910A`, amount USD 4900.00 (bag total $49.00), capture `none` 
- Webhook: PayPal did not deliver the PAYMENT.CAPTURE.COMPLETED event during this run
- Books: not matched (the back office shows no PayPal ids)

| Robbery | What it tries | Rules | Result | What happened |
|---|---|---|---|---|
| Price tampering | Pay $0.01 for the $49 hoodie | 1, 2 | ROBBED | Shipped the $49.00 hoodie after PayPal captured USD 0.01 (order 4PS90950XJ916372R); the shop's back office says fulfilled. |
| Negative quantity | Buy -1, 0.5 or 1,000 hoodies, or a product that doesn't exist | 11 | Blocked | All five bad bags were refused before any PayPal order was created (the unchanged bag did create one). |
| Payment nobody approved | Claim payment for an order no buyer approved | 4 | ROBBED | The shop marked order 7LL39855D3677353C paid although PayPal says CREATED. |
| Secret in the browser | Look for the PayPal secret in every page and script | 12 | Blocked | Checked 8 pages, scripts and endpoints, and every answer during the purchase: only the client id is public. |

## Round 2: after fix 1

- Tests: pass
- Buttons shown: paypal yes, venmo yes, paylater yes
- Purchase: Paid $49.00: capture 64Y225063R196762V COMPLETED, shop order FOG-642A44 fulfilled, 1 label.
  - PayPal order `7AN85483DN811003S`, amount USD 49.00 (bag total $49.00), capture `64Y225063R196762V` COMPLETED
- Webhook: PayPal's genuine PAYMENT.CAPTURE.COMPLETED event for this order was accepted (HTTP 2xx) (event WH-4Y661850GK762694V-4H002060N30939058); whether the shop checks signatures is what the forged-webhook robbery tests
- Books: 5 PayPal order(s) the shop calls paid, checked against PayPal's records: each backed by a completed capture that covers it, none shipped more than once (1 paid another way, not PayPal's to check)

| Robbery | What it tries | Rules | Result | What happened |
|---|---|---|---|---|
| Price tampering | Pay $0.01 for the $49 hoodie | 1, 2 | Blocked | Every tampered request still produced a USD 49.00 PayPal order, or none (the unchanged request did produce one). |
| Negative quantity | Buy -1, 0.5 or 1,000 hoodies, or a product that doesn't exist | 11 | Blocked | All five bad bags were refused before any PayPal order was created (the unchanged bag did create one). |
| Payment nobody approved | Claim payment for an order no buyer approved | 4 | Blocked | PayPal refused the capture (order 6V860849W45752036 is CREATED); the shop kept it unpaid. |
| Approval without payment | Get it shipped before PayPal takes the money | 4, 8 | Blocked | Buyer approved order 1SP823343T107331G, the capture was blocked, and PayPal's 'approved' webhook arrived: nothing paid, nothing shipped. |
| Declined card | Get it shipped after the card is declined | 5 | Blocked | PayPal answered 422 INSTRUMENT_DECLINED (debug id f77382797ef18); the shop kept the order unpaid. |
| Forged webhook | Fake PayPal's 'payment completed' message | 6 | Blocked | Forged events were refused (HTTP 400 unsigned, 400 with stolen headers); order FOG-381603 stayed unpaid. |
| Webhook replay | Resend PayPal's real message to ship again | 7, 8 | Blocked | Event WH-4Y661850GK762694V-4H002060N30939058 for order FOG-642A44 replayed 3 times byte for byte: no extra label. |
| Late event | Send 'approved' after 'completed' to roll an order back | 9 | Blocked | Order FOG-642A44 stayed fulfilled after a late 'approved' event. |
| Double click | Capture twice at once to get two shipments | 8, 10 | Blocked | Two simultaneous captures: PayPal captured 1, the shop printed 1 label. |
| Secret in the browser | Look for the PayPal secret in every page and script | 12 | Blocked | Checked 8 pages, scripts and endpoints, and every answer during the purchase: only the client id is public. |

AI thief (Meta Model API muse-wonder-1.0): read only what any visitor can see and tried 6 robberies of its own; none got through. The books against PayPal's records decide each one, not the model.

| AI thief's robbery | Its idea | Result | What happened |
|---|---|---|---|
| Duplicate-line split | PayPal pricing may collapse duplicate SKUs into one line while fulfilment keeps every submitted line. | Blocked | The books still match PayPal's records: nothing taken. |
| Create-order status injection | The PayPal create-order handler may copy extra client fields into the stored shop order, allowing its initial status to be overridden without payment. | Blocked | The books still match PayPal's records: nothing taken. |
| Capture remapped to latest order | After a $49 PayPal approval, creating a larger order in the same session and then capturing with the larger shop order's identifiers may make capture fulfilment use the session, body, or custom_id target instead of the PayPal order's bound target. | Blocked | The books still match PayPal's records: nothing taken. |
| Capture webhook redirected | The completed-capture webhook may select the order solely from edited custom_id and related order fields, while retaining the original signature headers and not globally binding the capture ID to its original order. | Blocked | The books still match PayPal's records: nothing taken. |
| Currency denomination confusion | The create-order handler may accept a client-supplied currency while capture validation compares only the numeric amount 49.00 and ignores that it was paid in yen rather than dollars. | Blocked | The books still match PayPal's records: nothing taken. |
| Card-route total injection | The separate card checkout may trust client-supplied total or paid-status fields even though the PayPal route calculates its total on the server. | Blocked | The books still match PayPal's records: nothing taken. |
