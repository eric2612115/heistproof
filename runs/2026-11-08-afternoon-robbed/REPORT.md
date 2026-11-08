# Heistproof evidence report

**Verdict: do not ship.** 2 of 10 scripted robberies blocked, 8 robbed the shop. The AI thief tried 6 robberies of its own: none got through (4 only repeated a problem the books already showed). The shop's books do not match PayPal's (9 orders). Real purchase: paid and shipped once. Tests: pass.

All payments ran in the PayPal sandbox (no real money). Order and capture ids below are PayPal's own and can be looked up in the merchant's sandbox account.

## Round 1: first check

- Tests: pass
- Buttons shown: paypal yes, venmo no, paylater no
- Purchase: Paid $49.00: capture 4G0517192J622901V COMPLETED, shop order FOG-81D1F4 fulfilled, 1 label.
  - PayPal order `10S01667HB3354335`, amount USD 49.00 (bag total $49.00), capture `4G0517192J622901V` COMPLETED
- Webhook: PayPal's genuine PAYMENT.CAPTURE.COMPLETED event for this order was accepted (HTTP 2xx) (event WH-4D491378D32835827-3L509300K1143850D); whether the shop checks signatures is what the forged-webhook robbery tests
- Books: DO NOT MATCH PayPal's records on 9 order(s): more parcels than captures; paid or shipped without a completed capture. Order FOG-6AB034: 3 parcels for 1 completed capture(s); Order FOG-D461AA: 3 parcels for 1 completed capture(s); Order FOG-62E7C7: fulfilled with 1 parcel(s), but PayPal holds no completed capture for it; Order FOG-958A04: 3 parcels for 1 completed capture(s); Order FOG-4A6E92: fulfilled with 2 parcel(s), but PayPal holds no completed capture for it; Order FOG-6F082B: fulfilled with 2 parcel(s), but PayPal holds no completed capture for it; Order FOG-F1D642: 4 parcels for 1 completed capture(s); Order FOG-666D98: fulfilled with 1 parcel(s), but PayPal holds no completed capture for it; Order FOG-1AF923: 7 parcels for 1 completed capture(s)

| Robbery | What it tries | Rules | Result | What happened |
|---|---|---|---|---|
| Price tampering | Pay $0.01 for the $49 hoodie | 1, 2 | ROBBED | Shipped the $49 hoodie after PayPal captured USD 0.01 (order 98W96679BT869750N); the shop's back office says fulfilled. |
| Negative quantity | Buy -1, 0.5 or 1,000 of an item, a product that doesn't exist, or a bag with a negative line | 11 | Blocked | All 6 bad bags were refused before any PayPal order was created (the unchanged bag did create one). |
| Payment nobody approved | Claim payment for an order no buyer approved | 4 | ROBBED | /api/paypal/orders/4BW505220C386082A/capture, sent for order 4BW505220C386082A, which no buyer approved, made the shop mark it paid although PayPal says CREATED. |
| Approval without payment | Get it shipped before PayPal takes the money | 4, 8 | ROBBED | Order 8EL79479PL8722313 was only approved, never captured, yet the shop printed a shipping label after PayPal's 'approved' webhook. |
| Declined card | Get it shipped after the card is declined | 5 | ROBBED | PayPal answered 422 INSTRUMENT_DECLINED but the shop marked the order paid or shipped it. |
| Double click | Capture twice at once to get two shipments | 8, 10 | ROBBED | Two simultaneous captures printed 2 labels for one payment. |
| Forged webhook | Fake PayPal's 'payment completed' message | 6 | ROBBED | A forged event marked unpaid order FOG-4A6E92 paid. |
| Webhook replay | Resend PayPal's real message to ship again | 7, 8 | ROBBED | Replaying event WH-4D491378D32835827-3L509300K1143850D for order FOG-1AF923 printed 3 extra shipping label(s). |
| Late event | Send 'approved' after 'completed' to roll an order back | 9 | ROBBED | The late 'approved' event printed 1 more shipping label(s) for order FOG-1AF923. |
| Secret in the browser | Look for the PayPal secret or an access token in every page and script | 12 | Blocked | Checked 8 pages, scripts and endpoints, and every answer during the purchase: no secret and no access token, only the client id is public. |

AI thief (Meta Model API muse-wonder-1.0): read what any visitor can see and tried 6 robberies of its own; none got through, 4 only repeated a problem the books already showed. The books against PayPal's records decide each one, not the model.

| AI thief's robbery | Its idea | Result | What happened |
|---|---|---|---|
| Latest-order capture mix-up | The capture handler may fulfil the shop order most recently created for the session instead of the shop order bound to the approved PayPal order. | Repeat (a problem the books already showed) | Only repeated a problem the books already showed (more parcels than captures) on order FOG-958A04: not a new way in. |
| Capture webhook re-addressed | The webhook handler may trust an edited custom_id and amount without verifying that the capture belongs to that shop order or was already used for the legitimate order. | Repeat (a problem the books already showed) | Only repeated a problem the books already showed (paid or shipped without a completed capture) on order FOG-62E7C7: not a new way in. |
| Duplicate line, single price | Pricing may collapse duplicate SKUs through a map while fulfilment may iterate every submitted line. | Repeat (a problem the books already showed) | Only repeated a problem the books already showed (more parcels than captures) on order FOG-D461AA: not a new way in. |
| Same number, cheaper currency | The shop may pass a client-supplied currency to PayPal but later compare or record only the numeric capture value as USD. | Blocked | The books still match PayPal's records: nothing taken. |
| Card checkout client total | The card route may trust client-supplied total or payment-status fields instead of calculating $147 from the catalogue and the processor result. | Blocked | The books still match PayPal's records: nothing taken. |
| Capture body names another order | The capture route may trust an orderId, custom_id or x-order-id supplied with the capture request over the mapping stored for the approved PayPal order. | Repeat (a problem the books already showed) | Only repeated a problem the books already showed (more parcels than captures) on order FOG-6AB034: not a new way in. |
