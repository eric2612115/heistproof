# Heistproof evidence report

**Verdict: do not ship.** 2 of 10 scripted robberies blocked, 8 robbed the shop. The AI thief tried 6 robberies of its own: 5 GOT THROUGH. The shop's books do not match PayPal's (10 orders). Real purchase: paid and shipped once. Tests: pass.

All payments ran in the PayPal sandbox (no real money). Order and capture ids below are PayPal's own and can be looked up in the merchant's sandbox account.

## Round 1: first check

- Tests: pass
- Buttons shown: paypal yes, venmo no, paylater no
- Purchase: Paid $49.00: capture 9FL958314N499845F COMPLETED, shop order FOG-F2A847 fulfilled, 1 label.
  - PayPal order `8BD267077U358235J`, amount USD 49.00 (bag total $49.00), capture `9FL958314N499845F` COMPLETED
- Webhook: PayPal's genuine PAYMENT.CAPTURE.COMPLETED event for this order was accepted (HTTP 2xx) (event WH-5YR91869AD938043Y-9W024022P41105929); whether the shop checks signatures is what the forged-webhook robbery tests
- Books: DO NOT MATCH PayPal's records: order FOG-50C510: 4 parcels for 1 completed capture(s); order FOG-ECFABA: 3 parcels for 1 completed capture(s); order FOG-01360C: 3 parcels for 1 completed capture(s); order FOG-FAD926: 3 parcels for 1 completed capture(s); order FOG-99F5F9: fulfilled with 1 parcel(s), but PayPal holds no completed capture for it; order FOG-74082C: fulfilled with 2 parcel(s), but PayPal holds no completed capture for it; order FOG-EDFB81: fulfilled with 2 parcel(s), but PayPal holds no completed capture for it; order FOG-E7EBE7: 4 parcels for 1 completed capture(s); order FOG-ED65B1: fulfilled with 1 parcel(s), but PayPal holds no completed capture for it; order FOG-E5D452: 7 parcels for 1 completed capture(s)

| Robbery | What it tries | Rules | Result | What happened |
|---|---|---|---|---|
| Price tampering | Pay $0.01 for the $49 hoodie | 1, 2 | ROBBED | Shipped the $49.00 hoodie after PayPal captured USD 0.01 (order 60702657SC4247212); the shop's back office says fulfilled. |
| Negative quantity | Buy -1, 0.5 or 1,000 hoodies, or a product that doesn't exist | 11 | Blocked | All five bad bags were refused before any PayPal order was created (the unchanged bag did create one). |
| Payment nobody approved | Claim payment for an order no buyer approved | 4 | ROBBED | The shop marked order 9DW42457DD2398026 paid although PayPal says CREATED. |
| Approval without payment | Get it shipped before PayPal takes the money | 4, 8 | ROBBED | Order 3S539974162872310 was only approved, never captured, yet the shop printed a shipping label after PayPal's 'approved' webhook. |
| Declined card | Get it shipped after the card is declined | 5 | ROBBED | PayPal answered 422 INSTRUMENT_DECLINED but the shop marked the order paid or shipped it. |
| Forged webhook | Fake PayPal's 'payment completed' message | 6 | ROBBED | A forged event marked unpaid order FOG-74082C paid. |
| Webhook replay | Resend PayPal's real message to ship again | 7, 8 | ROBBED | Replaying event WH-5YR91869AD938043Y-9W024022P41105929 for order FOG-E5D452 printed 3 extra shipping label(s). |
| Late event | Send 'approved' after 'completed' to roll an order back | 9 | ROBBED | The late 'approved' event printed 1 more shipping label(s) for order FOG-E5D452. |
| Double click | Capture twice at once to get two shipments | 8, 10 | ROBBED | Two simultaneous captures printed 2 labels for one payment. |
| Secret in the browser | Look for the PayPal secret in every page and script | 12 | Blocked | Checked 8 pages, scripts and endpoints, and every answer during the purchase: only the client id is public. |

AI thief (Meta Model API muse-wonder-1.0): read only what any visitor can see and tried 6 robberies of its own; 5 GOT THROUGH. The books against PayPal's records decide each one, not the model.

| AI thief's robbery | Its idea | Result | What happened |
|---|---|---|---|
| Cross-order capture credit | The webhook handler trusts resource.custom_id and the amount in the delivered body instead of verifying that the capture belongs to that shop order and was really paid to PayPal. | ROBBED | Got through: order FOG-99F5F9 fulfilled with 1 parcel(s), but PayPal holds no completed capture for it. |
| Capture-body basket override | After a genuine $49 approval, the capture endpoint may trust items or status supplied in the capture request body rather than the items stored with the approved PayPal order. | ROBBED | Got through: order FOG-FAD926 2 parcels for 1 completed capture(s). |
| Approved-order basket swap | The shop may associate a capture with the newest pending order in the shopper session rather than with the PayPal order ID in the capture URL. | ROBBED | Got through: order FOG-01360C 2 parcels for 1 completed capture(s); order FOG-FAD926 3 parcels for 1 completed capture(s). |
| Split duplicate lines | Pricing may deduplicate repeated SKUs or use only the first matching line, while fulfillment iterates every submitted line and sums their quantities. | ROBBED | Got through: order FOG-ECFABA 2 parcels for 1 completed capture(s); order FOG-01360C 3 parcels for 1 completed capture(s). |
| Capture plus webhook double ship | The capture endpoint and the webhook handler may each fulfill the order independently, without recording that the same capture has already caused a shipment through the other channel. | ROBBED | Got through: order FOG-50C510 3 parcels for 1 completed capture(s); order FOG-ECFABA 3 parcels for 1 completed capture(s). |
| Card checkout price override | The separate card endpoint may trust client-supplied per-item prices, totals, or paid/status fields instead of recalculating from the catalog and using only the card processor result. | Blocked | The books still match PayPal's records: nothing taken. |
