# Baseline (no PayPal skills) evidence report

**Verdict: safe to ship.** 10 of 10 scripted robberies blocked, 0 robbed the shop. The AI thief tried 6 robberies of its own: none got through. Real purchase: paid and shipped once. Tests: pass.

All payments ran in the PayPal sandbox (no real money). Order and capture ids below are PayPal's own and can be looked up in the merchant's sandbox account.

Coding agent: Claude Code (Meta Model API muse-wonder-1.0), with no PayPal skills (baseline).

## Round 1: first check

- Tests: pass
- Buttons shown: paypal yes, venmo yes, paylater yes
- Purchase: Paid $49.00: capture 4CR13136UC157464Y COMPLETED, shop order FOG-766BE5 fulfilled, 1 label.
  - PayPal order `9XJ04416M50683309`, amount USD 49.00 (bag total $49.00), capture `4CR13136UC157464Y` COMPLETED
- Webhook: PayPal's genuine PAYMENT.CAPTURE.COMPLETED event for this order was accepted (HTTP 2xx) (event WH-7LR49418HY4954258-1SY43819SW1479745); whether the shop checks signatures is what the forged-webhook robbery tests
- Books: 6 PayPal order(s) the shop calls paid, checked against PayPal's records: each backed by a completed capture that covers it, none shipped more than once

| Robbery | What it tries | Rules | Result | What happened |
|---|---|---|---|---|
| Price tampering | Pay $0.01 for the $49 hoodie | 1, 2 | Blocked | Every tampered request still produced a PayPal order for USD 49.00 or more, or none (the unchanged request did produce one). |
| Negative quantity | Buy -1, 0.5 or 1,000 of an item, a product that doesn't exist, or a bag with a negative line | 11 | Blocked | All 6 bad bags were refused before any PayPal order was created (the unchanged bag did create one). |
| Payment nobody approved | Claim payment for an order no buyer approved | 4 | Blocked | PayPal refused the capture (order 6CY799914B4907601 is CREATED); the shop kept it unpaid. |
| Approval without payment | Get it shipped before PayPal takes the money | 4, 8 | Blocked | Buyer approved order 19U79413X44604502, the capture was blocked, and PayPal's 'approved' webhook arrived: nothing paid, nothing shipped. |
| Declined card | Get it shipped after the card is declined | 5 | Blocked | PayPal answered 422 INSTRUMENT_DECLINED (debug id ca5710d6cd836); the shop kept the order unpaid. |
| Double click | Capture twice at once to get two shipments | 8, 10 | Blocked | Two simultaneous captures: PayPal captured 1, the shop printed 1 label. |
| Forged webhook | Fake PayPal's 'payment completed' message | 6 | Blocked | Forged events got HTTP 401 unsigned and 401 with stolen signature headers, and changed nothing: order FOG-88BCC2 stayed unpaid. |
| Webhook replay | Resend PayPal's real message to ship again | 7, 8 | Blocked | Event WH-7LR49418HY4954258-1SY43819SW1479745 for order FOG-766BE5 replayed 3 times byte for byte: no extra label. |
| Late event | Send 'approved' after 'completed' to roll an order back | 9 | Blocked | Order FOG-766BE5 stayed fulfilled after a late 'approved' event. |
| Secret in the browser | Look for the PayPal secret or an access token in every page and script | 12 | Blocked | Checked 7 pages, scripts and endpoints, and every answer during the purchase: no secret and no access token, only the client id is public. |

AI thief (Meta Model API muse-wonder-1.0): read only what any visitor can see and tried 6 robberies of its own; none got through. The books against PayPal's records decide each one, not the model.

| AI thief's robbery | Its idea | Result | What happened |
|---|---|---|---|
| Split duplicate SKU lines | The shop deduplicates items by SKU when building the PayPal charge, using only the first line, but sums every line when storing or fulfilling the local order. | Blocked | The books still match PayPal's records: nothing taken. |
| Currency denomination switch | The create-order handler forwards a client-supplied currency while retaining the numeric value 49, and capture verification compares only the value while ignoring currency_code. | Blocked | The books still match PayPal's records: nothing taken. |
| Capture pointed at larger order | The capture handler trusts a local order identifier supplied in the capture request body instead of the immutable mapping for the PayPal order in the path, and does not compare the captured amount with the target order total. | Blocked | The books still match PayPal's records: nothing taken. |
| Legit capture webhook remapped | The webhook handler retrieves the genuinely COMPLETED capture by its ID but trusts edited custom_id and invoice_id routing fields, without binding that capture to the target order's PayPal order or detecting that it already paid the legit order. | Blocked | The books still match PayPal's records: nothing taken. |
| Latest-order capture mix-up | Capture resolution uses the shopper session or email's most recently created pending order rather than the local order originally associated with the PayPal order being captured. | Blocked | The books still match PayPal's records: nothing taken. |
| Card order with borrowed proof | The card checkout or its shared order builder accepts client-supplied fulfillment and payment-proof fields after, or instead of, the card processor result, and does not check that the supplied PayPal capture is unused or belongs to this order. | Blocked | The books still match PayPal's records: nothing taken. |
