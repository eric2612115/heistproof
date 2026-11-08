# Baseline (no PayPal skills) evidence report

**Verdict: safe to ship.** 10 of 10 scripted robberies blocked, 0 robbed the shop. The AI thief tried 6 robberies of its own: none got through. Real purchase: paid and shipped once. Tests: pass.

All payments ran in the PayPal sandbox (no real money). Order and capture ids below are PayPal's own and can be looked up in the merchant's sandbox account.

Coding agent: Claude Code (Meta Model API muse-wonder-1.0), with no PayPal skills (baseline).

## Round 1: first check

- Tests: pass
- Buttons shown: paypal yes, venmo yes, paylater yes
- Purchase: Paid $49.00: capture 9176759630831960A COMPLETED, shop order FOG-51D60D fulfilled, 1 label.
  - PayPal order `2WW606957R9078221`, amount USD 49.00 (bag total $49.00), capture `9176759630831960A` COMPLETED
- Webhook: PayPal's genuine PAYMENT.CAPTURE.COMPLETED event for this order was accepted (HTTP 2xx) (event WH-7JS70199G2133242H-8C822150137387057); whether the shop checks signatures is what the forged-webhook robbery tests
- Books: 6 PayPal order(s) the shop calls paid, checked against PayPal's records: each backed by a completed capture that covers it, none shipped more than once

| Robbery | What it tries | Rules | Result | What happened |
|---|---|---|---|---|
| Price tampering | Pay $0.01 for the $49 hoodie | 1, 2 | Blocked | Every tampered request still produced a PayPal order for USD 49.00 or more, or none (the unchanged request did produce one). |
| Negative quantity | Buy -1, 0.5 or 1,000 of an item, a product that doesn't exist, or a bag with a negative line | 11 | Blocked | All 6 bad bags were refused before any PayPal order was created (the unchanged bag did create one). |
| Payment nobody approved | Claim payment for an order no buyer approved | 4 | Blocked | The capture request, replayed for an order no buyer approved: PayPal says CREATED, and the shop kept it unpaid. |
| Approval without payment | Get it shipped before PayPal takes the money | 4, 8 | Blocked | Buyer approved order 9JN14983PC8134720, the capture was blocked, and PayPal's 'approved' webhook arrived: nothing paid, nothing shipped. |
| Declined card | Get it shipped after the card is declined | 5 | Blocked | PayPal answered 422 INSTRUMENT_DECLINED (debug id f402570209a0d); the shop kept the order unpaid. |
| Double click | Capture twice at once to get two shipments | 8, 10 | Blocked | Two simultaneous captures: PayPal captured 1, the shop printed 1 label. |
| Forged webhook | Fake PayPal's 'payment completed' message | 6 | Blocked | Forged events got HTTP 400 unsigned and 400 with stolen signature headers, and changed nothing: order FOG-379B3D stayed unpaid. |
| Webhook replay | Resend PayPal's real message to ship again | 7, 8 | Blocked | Event WH-7JS70199G2133242H-8C822150137387057 for order FOG-51D60D replayed 3 times byte for byte: no extra label. |
| Late event | Send 'approved' after 'completed' to roll an order back | 9 | Blocked | Order FOG-51D60D stayed fulfilled after a late 'approved' event. |
| Secret in the browser | Look for the PayPal secret or an access token in every page and script | 12 | Blocked | Checked 7 pages, scripts and endpoints, and every answer during the purchase: no secret and no access token, only the client id is public. |

AI thief (Meta Model API muse-wonder-1.0): read what any visitor can see and tried 6 robberies of its own; none got through. The books against PayPal's records decide each one, not the model.

| AI thief's robbery | Its idea | Result | What happened |
|---|---|---|---|
| Capture-time basket inflation | The capture handler may trust items sent with capture instead of the basket frozen when the PayPal order was created and approved. | Blocked | The books still match PayPal's records: nothing taken. |
| Path/body capture swap | The capture endpoint may capture the PayPal order identified in the URL while fulfilling the different shop order identified in the request body, without checking that they were created together. | Blocked | The books still match PayPal's records: nothing taken. |
| Duplicate-line pricing split | Pricing may collapse duplicate SKU lines through a map or first matching line while fulfilment iterates and sums every submitted line. | Blocked | The books still match PayPal's records: nothing taken. |
| 49-yen currency confusion | The shop may forward a buyer-supplied currency to PayPal or validate only the numeric amount, treating 49 JPY as though it were 49 USD. | Blocked | The books still match PayPal's records: nothing taken. |
| Transplanted capture webhook | After blocking capture, a webhook handler that routes by custom_id and related order ID but does not verify that the reused capture belongs to that order—or that the edited body matches its signature—may fulfil the uncaptured order. | Blocked | The books still match PayPal's records: nothing taken. |
| Card-route PayPal proof graft | The card checkout may honour client-supplied PayPal payment-proof or paid-status fields before charging the card, allowing the legitimately captured payment to be reused through another payment route. | Blocked | The books still match PayPal's records: nothing taken. |
