# Heistproof evidence report

**Verdict: safe to ship.** 10 of 10 scripted robberies blocked, 0 robbed the shop. The AI thief tried 6 robberies of its own: none got through. Real purchase: paid and shipped once. Tests: pass.

All payments ran in the PayPal sandbox (no real money). Order and capture ids below are PayPal's own and can be looked up in the merchant's sandbox account.

## Round 1: first check

- Tests: pass
- Buttons shown: paypal yes, venmo yes, paylater yes; Pay Later message: "Buy now, pay later. Learn more"
- Purchase: Paid $49.00: capture 36W27717AD563593J COMPLETED, shop order FOG-2E5A17 fulfilled, 1 label.
  - PayPal order `02B48674492259645`, amount USD 49.00 (bag total $49.00), capture `36W27717AD563593J` COMPLETED
- Webhook: PayPal's genuine PAYMENT.CAPTURE.COMPLETED event for this order was accepted (HTTP 2xx) (event WH-0TK10928ML5536126-4LC340385E336615T); whether the shop checks signatures is what the forged-webhook robbery tests
- Books: 4 PayPal order(s) the shop calls paid, checked against PayPal's records: each backed by a completed capture that covers it, none shipped more than once (1 paid another way, not PayPal's to check)

| Robbery | What it tries | Rules | Result | What happened |
|---|---|---|---|---|
| Price tampering | Pay $0.01 for the $49 hoodie | 1, 2 | Blocked | Every tampered request still produced a PayPal order for USD 49.00 or more, or none (the unchanged request did produce one). |
| Negative quantity | Buy -1, 0.5 or 1,000 of an item, a product that doesn't exist, or a bag with a negative line | 11 | Blocked | All 6 bad bags were refused before any PayPal order was created (the unchanged bag did create one). |
| Payment nobody approved | Claim payment for an order no buyer approved | 4 | Blocked | The capture request, replayed for an order no buyer approved: PayPal says CREATED, and the shop kept it unpaid. |
| Approval without payment | Get it shipped before PayPal takes the money | 4, 8 | Blocked | Buyer approved order 0X728100KL766411Y, the capture was blocked, and PayPal's 'approved' webhook arrived: nothing paid, nothing shipped. |
| Declined card | Get it shipped after the card is declined | 5 | Blocked | PayPal answered 422 INSTRUMENT_DECLINED (debug id ca574787719a3); the shop kept the order unpaid. |
| Double click | Capture twice at once to get two shipments | 8, 10 | Blocked | Two simultaneous captures: PayPal captured 1, the shop printed 1 label. |
| Forged webhook | Fake PayPal's 'payment completed' message | 6 | Blocked | Forged events got HTTP 400 unsigned and 400 with stolen signature headers, and changed nothing: order FOG-AFE044 stayed unpaid. |
| Webhook replay | Resend PayPal's real message to ship again | 7, 8 | Blocked | Event WH-0TK10928ML5536126-4LC340385E336615T for order FOG-2E5A17 replayed 3 times byte for byte: no extra label. |
| Late event | Send 'approved' after 'completed' to roll an order back | 9 | Blocked | Order FOG-E8F252 stayed fulfilled after a late 'approved' event. |
| Secret in the browser | Look for the PayPal secret or an access token in every page and script | 12 | Blocked | Checked 7 pages, scripts and endpoints, and every answer during the purchase: no secret and no access token, only the client id is public. |

AI thief (Meta Model API muse-wonder-1.0): read what any visitor can see and tried 6 robberies of its own; none got through. The books against PayPal's records decide each one, not the model.

| AI thief's robbery | Its idea | Result | What happened |
|---|---|---|---|
| Capture-time basket swap | The capture endpoint may trust items supplied at capture time instead of the items stored when the $49 PayPal order was approved. | Blocked | The books still match PayPal's records: nothing taken. |
| Cross-order webhook redirect | The webhook handler may verify that the referenced capture exists at PayPal but fulfill whichever shop order is named by custom_id or invoice_id, without globally preventing reuse of that capture for another order. | Blocked | The books still match PayPal's records: nothing taken. |
| Yen-for-dollar currency swap | Order creation may forward a client-supplied currency or purchase unit to PayPal while later checks compare only the numeric value 49, ignoring that it is yen rather than dollars. | Blocked | The books still match PayPal's records: nothing taken. |
| Card checkout says-so total | The separate card route may trust client-supplied total, paid, status, or capture-reference fields instead of recalculating the basket and verifying its own card charge. | Blocked | The books still match PayPal's records: nothing taken. |
| Legit capture, different order | The capture endpoint may fulfill an orderId supplied in the capture request body and accept PayPal's already-COMPLETED status, rather than enforcing the stored mapping between that PayPal order, its amount, and its original shop order. | Blocked | The books still match PayPal's records: nothing taken. |
| Split-line quantity mismatch | Pricing may deduplicate or normalize repeated and case-variant SKU lines differently from fulfillment, charging for one line while the warehouse sums every stored line. | Blocked | The books still match PayPal's records: nothing taken. |
