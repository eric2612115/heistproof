# Heistproof evidence report

**Verdict: do not ship.** 2 of 10 scripted robberies blocked, 8 robbed the shop. The AI thief tried 6 robberies of its own: none got through (4 only repeated a problem the books already showed). The shop's books do not match PayPal's (10 orders). Real purchase: paid and shipped once. Tests: pass.

All payments ran in the PayPal sandbox (no real money). Order and capture ids below are PayPal's own and can be looked up in the merchant's sandbox account.

## Round 1: first check

- Tests: pass
- Buttons shown: paypal yes, venmo no, paylater no
- Purchase: Paid $49.00: capture 49948562Y1823070D COMPLETED, shop order FOG-451ADC fulfilled, 1 label.
  - PayPal order `9KT077498Y106964N`, amount USD 49.00 (bag total $49.00), capture `49948562Y1823070D` COMPLETED
- Webhook: PayPal's genuine PAYMENT.CAPTURE.COMPLETED event for this order was accepted (HTTP 2xx) (event WH-1ND27878FB534232L-5TY35316HS9408336); whether the shop checks signatures is what the forged-webhook robbery tests
- Books: DO NOT MATCH PayPal's records on 10 order(s): more parcels than captures; paid or shipped without a completed capture. Order FOG-AF5BA6: 3 parcels for 1 completed capture(s); Order FOG-A27042: fulfilled with 2 parcel(s), but PayPal holds no completed capture for it; Order FOG-8B8DB7: 3 parcels for 1 completed capture(s); Order FOG-821A5E: 3 parcels for 1 completed capture(s); Order FOG-6D3608: fulfilled with 2 parcel(s), but PayPal holds no completed capture for it; Order FOG-FEF425: fulfilled with 2 parcel(s), but PayPal holds no completed capture for it; Order FOG-C1C6B4: 4 parcels for 1 completed capture(s); Order FOG-839904: fulfilled with 1 parcel(s), but PayPal holds no completed capture for it; Order FOG-DE45BE: 6 parcels for 1 completed capture(s); Order FOG-451ADC: 3 parcels for 1 completed capture(s)

| Robbery | What it tries | Rules | Result | What happened |
|---|---|---|---|---|
| Price tampering | Pay $0.01 for the $49 hoodie | 1, 2 | ROBBED | Shipped the $49 hoodie after PayPal captured USD 0.01 (order 8F134800K1745825N); the shop's back office says fulfilled. |
| Negative quantity | Buy -1, 0.5 or 1,000 of an item, a product that doesn't exist, or a bag with a negative line | 11 | Blocked | All 6 bad bags were refused before any PayPal order was created (the unchanged bag did create one). |
| Payment nobody approved | Claim payment for an order no buyer approved | 4 | ROBBED | /api/paypal/orders/83351396TN606011T/capture, sent for order 83351396TN606011T, which no buyer approved, made the shop mark it paid although PayPal says CREATED. |
| Approval without payment | Get it shipped before PayPal takes the money | 4, 8 | ROBBED | Order 92B828420J5786542 was approved but never captured, and the shop still marked it paid or shipped it. |
| Declined card | Get it shipped after the card is declined | 5 | ROBBED | PayPal answered 422 INSTRUMENT_DECLINED but the shop marked the order paid or shipped it. |
| Double click | Capture twice at once to get two shipments | 8, 10 | ROBBED | Two simultaneous captures printed 2 labels for one payment. |
| Forged webhook | Fake PayPal's 'payment completed' message | 6 | ROBBED | A forged event marked unpaid order FOG-6D3608 paid. |
| Webhook replay | Resend PayPal's real message to ship again | 7, 8 | ROBBED | Replaying event WH-1ND27878FB534232L-5TY35316HS9408336 for order FOG-DE45BE printed 3 extra shipping label(s). |
| Late event | Send 'approved' after 'completed' to roll an order back | 9 | ROBBED | The late 'approved' event printed 1 more shipping label(s) for order FOG-451ADC. |
| Secret in the browser | Look for the PayPal secret or an access token in every page and script | 12 | Blocked | Checked 8 pages, scripts and endpoints, and every answer during the purchase: no secret and no access token, only the client id is public. |

AI thief (Meta Model API muse-wonder-1.0): read what any visitor can see and tried 6 robberies of its own; none got through, 4 only repeated a problem the books already showed. The books against PayPal's records decide each one, not the model.

| AI thief's robbery | Its idea | Result | What happened |
|---|---|---|---|
| Partial capture at capture time | The create order is for the full $49, but the capture endpoint may forward a client-supplied capture amount to PayPal or check only that a capture completed, not that the captured amount equals the order total. | Repeat (a problem the books already showed) | Only repeated a problem the books already showed (more parcels than captures) on order FOG-821A5E: not a new way in. |
| Duplicate SKU line split | Payment calculation may deduplicate identical SKUs by overwriting quantity in a map, while fulfilment may sum every submitted line. | Repeat (a problem the books already showed) | Only repeated a problem the books already showed (more parcels than captures) on order FOG-8B8DB7: not a new way in. |
| Cross-order capture-proof reuse | A completed-capture webhook may be trusted based solely on its edited custom_id, without checking that the capture ID was already used for another order or that its related PayPal order matches the target order. | Repeat (a problem the books already showed) | Only repeated a problem the books already showed (paid or shipped without a completed capture) on order FOG-A27042: not a new way in. |
| Currency-value confusion | The shop may forward a client-supplied currency to PayPal and later compare only the numeric captured value, ignoring currency_code. | Blocked | The books still match PayPal's records: nothing taken. |
| Post-approval order swap | After a $49 PayPal approval, creating another larger shop order and then capturing the first PayPal order with the second shop order's ID may make capture fulfil the latest or client-specified order rather than the order bound to that PayPal approval. | Repeat (a problem the books already showed) | Only repeated a problem the books already showed (more parcels than captures) on order FOG-AF5BA6: not a new way in. |
| Card-route price-field injection | The separate card checkout may trust client-supplied per-line price or total fields even if the PayPal create route calculates prices correctly. | Blocked | The books still match PayPal's records: nothing taken. |
