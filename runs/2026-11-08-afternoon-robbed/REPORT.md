# Heistproof evidence report

**Verdict: do not ship.** 2 of 10 scripted robberies blocked, 8 robbed the shop. The AI thief tried 6 robberies of its own: none got through (3 only repeated a problem the books already showed). The shop's books do not match PayPal's (9 orders). Real purchase: paid and shipped once. Tests: pass.

All payments ran in the PayPal sandbox (no real money). Order and capture ids below are PayPal's own and can be looked up in the merchant's sandbox account.

## Round 1: first check

- Tests: pass
- Buttons shown: paypal yes, venmo no, paylater no
- Purchase: Paid $49.00: capture 65P470459B9071812 COMPLETED, shop order FOG-3975C9 fulfilled, 1 label.
  - PayPal order `13M91177RB813535U`, amount USD 49.00 (bag total $49.00), capture `65P470459B9071812` COMPLETED
- Webhook: PayPal's genuine PAYMENT.CAPTURE.COMPLETED event for this order was accepted (HTTP 2xx) (event WH-8AN09469SM963104E-6Y556948GR6571701); whether the shop checks signatures is what the forged-webhook robbery tests
- Books: DO NOT MATCH PayPal's records on 9 order(s): paid or shipped without a completed capture; more parcels than captures. Order FOG-C1579D: fulfilled with 1 parcel(s), but PayPal holds no completed capture for it; Order FOG-21149C: fulfilled with 1 parcel(s), but PayPal holds no completed capture for it; Order FOG-F750C5: 3 parcels for 1 completed capture(s); Order FOG-FB3796: fulfilled with 2 parcel(s), but PayPal holds no completed capture for it; Order FOG-FA3E02: fulfilled with 2 parcel(s), but PayPal holds no completed capture for it; Order FOG-3B6829: 3 parcels for 1 completed capture(s); Order FOG-BEE1B0: fulfilled with 1 parcel(s), but PayPal holds no completed capture for it; Order FOG-E62713: 4 parcels for 1 completed capture(s); Order FOG-3975C9: 5 parcels for 1 completed capture(s)

| Robbery | What it tries | Rules | Result | What happened |
|---|---|---|---|---|
| Price tampering | Pay $0.01 for the $49 hoodie | 1, 2 | ROBBED | Shipped the $49 hoodie after PayPal captured USD 0.01 (order 3B028286MG4372121); the shop's back office says fulfilled. |
| Negative quantity | Buy -1, 0.5 or 1,000 of an item, a product that doesn't exist, or a bag with a negative line | 11 | Blocked | All 6 bad bags were refused before any PayPal order was created (the unchanged bag did create one). |
| Payment nobody approved | Claim payment for an order no buyer approved | 4 | ROBBED | The shop marked order 9L184087J6593140V paid although PayPal says CREATED. |
| Approval without payment | Get it shipped before PayPal takes the money | 4, 8 | ROBBED | Order 67165668HX571271A was approved but never captured, and the shop still marked it paid or shipped it. |
| Declined card | Get it shipped after the card is declined | 5 | ROBBED | PayPal answered 422 INSTRUMENT_DECLINED but the shop marked the order paid or shipped it. |
| Double click | Capture twice at once to get two shipments | 8, 10 | ROBBED | Two simultaneous captures printed 2 labels for one payment. |
| Forged webhook | Fake PayPal's 'payment completed' message | 6 | ROBBED | A forged event marked unpaid order FOG-FB3796 paid. |
| Webhook replay | Resend PayPal's real message to ship again | 7, 8 | ROBBED | Replaying event WH-8AN09469SM963104E-6Y556948GR6571701 for order FOG-3975C9 printed 3 extra shipping label(s). |
| Late event | Send 'approved' after 'completed' to roll an order back | 9 | ROBBED | The late 'approved' event printed 1 more shipping label(s) for order FOG-E62713. |
| Secret in the browser | Look for the PayPal secret or an access token in every page and script | 12 | Blocked | Checked 8 pages, scripts and endpoints, and every answer during the purchase: no secret and no access token, only the client id is public. |

AI thief (Meta Model API muse-wonder-1.0): read only what any visitor can see and tried 6 robberies of its own; none got through. The books against PayPal's records decide each one, not the model.

| AI thief's robbery | Its idea | Result | What happened |
|---|---|---|---|
| Capture-time bag inflation | The shop locks the PayPal amount at approval but re-reads items supplied with the later capture request, instead of using the items stored when the PayPal order was created. | Error | Only repeated a problem the books already showed (more parcels than captures) on order FOG-F750C5: not a new way in. |
| Cross-order capture transplant | The capture webhook trusts resource.custom_id to select the shop order and does not check that the capture was unused, belongs to that order, or covers its total. | Error | Only repeated a problem the books already showed (paid or shipped without a completed capture) on order FOG-21149C: not a new way in. |
| Foreign-currency amount match | Order creation passes a client-supplied currency through to PayPal while later verification compares only the numeric amount, so 49 JPY is treated like 49 USD. | Blocked | The books still match PayPal's records: nothing taken. |
| Card-route total injection | The separate card checkout trusts client-supplied total or payment-status fields, or mass-assigns order status, instead of charging the server-calculated total for the items. | Blocked | The books still match PayPal's records: nothing taken. |
| Shop-ID capture confusion | The capture route resolves its path parameter as a shop order ID as well as a PayPal order ID and trusts the capture call itself, without proving a PayPal capture for that identifier. | Blocked | The books still match PayPal's records: nothing taken. |
| Non-completed capture webhook | The webhook handler reacts only to the PAYMENT.CAPTURE.COMPLETED event type and custom_id, ignoring resource.status, so a capture explicitly marked PENDING is still treated as paid. | Error | Only repeated a problem the books already showed (paid or shipped without a completed capture) on order FOG-C1579D: not a new way in. |
