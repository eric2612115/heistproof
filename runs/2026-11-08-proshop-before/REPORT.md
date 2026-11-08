# Heistproof evidence report

**Verdict: do not ship.** 2 of 10 scripted robberies blocked (4 do not apply to this shop), 4 robbed the shop. The AI thief tried 6 robberies of its own: none got through (1 only repeated a problem the books already showed). The shop's books do not match PayPal's (5 orders). Real purchase: paid and shipped once. Tests: pass.

All payments ran in the PayPal sandbox (no real money). Order and capture ids below are PayPal's own and can be looked up in the merchant's sandbox account.

## Round 1: first check

- Tests: pass
- Buttons shown: paypal yes, venmo no, paylater no
- Purchase: Paid $459.99: capture 4NU00958D4561344H COMPLETED, shop order 6af06ee8cc824b9400d76a94 paid, no label yet.
  - PayPal order `4GV229463S672805L`, amount USD 459.99 (bag total $459.99), capture `4NU00958D4561344H` COMPLETED
- Webhook: the shop has no webhook route; PayPal's events are not part of its checkout
- Books: DO NOT MATCH PayPal's records on 5 order(s): the same goods for less; paid or shipped without a completed capture; one payment paying for two orders. Order 6af06f3acc824b9400d76acb: shipped the same goods as the real purchase (6af06edf5a27e3b99341f125 x 1) for $0.01 instead of $459.99; Order 6af06f6dcc824b9400d76af2: paid with 0 parcel(s), but PayPal holds no completed capture for it; Order 6af06f7dcc824b9400d76b05: paid with 0 parcel(s), but PayPal holds no completed capture for it; Order 6af06fcccc824b9400d76b2c: paid by capture 0CC65817YK780023J, which already pays for order 6af06fcccc824b9400d76b28; Order 6af070a3cc824b9400d76b55: paid by capture 1NY60089YS417712D, which already pays for order 6af07084cc824b9400d76b45

| Robbery | What it tries | Rules | Result | What happened |
|---|---|---|---|---|
| Price tampering | Pay $0.01 for the $459.99 item | 1, 2 | ROBBED | Shipped the $459.99 item after PayPal captured USD 0.01 (order 24127842VR842350W); the shop's back office says paid. |
| Negative quantity | Buy -1, 0.5 or 1,000 of an item, a product that doesn't exist, or a bag with a negative line | 11 | Blocked | No bad bag got the goods for less: "quantity -1" was priced USD 459.99, "quantity 0.5" was priced USD 459.99, "quantity 1000" was priced USD 459.99, "one item plus a line of -3 6af06edf5a27e3b99341f122" was priced USD 459.99; the others were refused. |
| Payment nobody approved | Claim payment for an order no buyer approved | 4 | ROBBED | /api/orders/6af06f6dcc824b9400d76af2/pay, sent for order 9NU5903319804552H, which no buyer approved, made the shop mark it paid although PayPal says CREATED. |
| Approval without payment | Get it shipped before PayPal takes the money | 4, 8 | ROBBED | Order 86J64216HC207161B was approved but never captured, and the shop still marked it paid or shipped it. |
| Declined card | Get it shipped after the card is declined | 5 | Does not apply | Does not apply to this shop: the shop never captures on its server; a capture PayPal declines in the browser never reaches it, and an approved payment that was never captured is the approval-without-payment robbery. |
| Double click | Capture twice at once to get two shipments | 8, 10 | ROBBED | One PayPal payment (order 5Y0962572C566470J) paid for 2 orders sent at the same moment: 6af06fcccc824b9400d76b28, 6af06fcccc824b9400d76b2c. |
| Forged webhook | Fake PayPal's 'payment completed' message | 6 | Does not apply | Does not apply to this shop: the shop has no webhook route, so there is no PayPal event to forge, replay or send late. |
| Webhook replay | Resend PayPal's real message to ship again | 7, 8 | Does not apply | Does not apply to this shop: the shop has no webhook route, so there is no PayPal event to forge, replay or send late. |
| Late event | Send 'approved' after 'completed' to roll an order back | 9 | Does not apply | Does not apply to this shop: the shop has no webhook route, so there is no PayPal event to forge, replay or send late. |
| Secret in the browser | Look for the PayPal secret or an access token in every page and script | 12 | Blocked | Checked 9 pages, scripts and endpoints, and every answer during the purchase: no secret and no access token, only the client id is public. |

AI thief (Meta Model API muse-wonder-1.0): read what any visitor can see and tried 6 robberies of its own; none got through, 1 only repeated a problem the books already showed. The books against PayPal's records decide each one, not the model.

| AI thief's robbery | Its idea | Result | What happened |
|---|---|---|---|
| Double-spend one capture on two shop orders | The pay endpoint may validate a capture only by amount/status, not by whether that PayPal transaction was already used for a different shop order. | Repeat (a problem the books already showed) | Only repeated a problem the books already showed (one payment paying for two orders) on order 6af070a3cc824b9400d76b55: not a new way in. |
| Inject paid state at order creation | Order creation may accept client-supplied payment-state fields instead of always initializing isPaid to false on the server. | Blocked | The books still match PayPal's records: nothing taken. |
| Become admin and reprice the product | The profile-update endpoint may mass-assign isAdmin; an admin product update would then change the database price that both the shop total and PayPal amount are calculated from. | Blocked | The books still match PayPal's records: nothing taken. |
| Deliver an unpaid order | The deliver endpoint may set isDelivered without checking isPaid, and the profile endpoint may provide the admin privilege it requires. | Blocked | The books still match PayPal's records: nothing taken. |
| Pay the right number in the wrong currency | Payment verification may compare only the numeric amount value and ignore currency_code, so 459.99 Philippine pesos may be treated as 459.99 US dollars. | Blocked | The books still match PayPal's records: nothing taken. |
| Redirect a real $0.01 webhook to a $459.99 order | A webhook handler may trust the edited resource amount and custom_id while retaining the original signature headers, without refetching the capture from PayPal or cryptographically revalidating the edited body. | Blocked | The books still match PayPal's records: nothing taken. |
