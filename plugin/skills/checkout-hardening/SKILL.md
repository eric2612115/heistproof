---
name: checkout-hardening
description: "The rules a PayPal checkout must meet before Heistproof ships it, and the attack that tests each one: server-side totals, cents-to-dollars conversion, binding PayPal orders to shop orders, paid only after a COMPLETED capture, declined captures, verified and idempotent webhooks, fulfilment exactly once. Load this before designing or changing any PayPal order, capture or webhook code."
---

# Checkout hardening: what the attacker will try

After you finish, Heistproof runs real purchases in the PayPal sandbox and then attacks the shop. An attack wins if the shop marks an order paid, or ships it, when it should not. Meet every rule.

| # | Rule | The attack that tests it |
|---|------|--------------------------|
| 1 | Price only from the server's catalog. Build the PayPal order from SKUs and quantities; ignore any price, amount, total or currency the browser sends. | Replays your create-order request with `price`, `amount`, `total`, `currency` and per-item prices set to 1 cent. |
| 2 | Convert units exactly. Catalog prices are integer cents; PayPal amounts are decimal strings in dollars: 4900 cents is `"49.00"`, never `"4900"` or `"4900.00"`. Send an item breakdown whose sum equals the total. | Compares the amount on the PayPal order with the bag total. |
| 3 | Bind each PayPal order to one shop order. Create the shop order first, put its id in `purchase_units[0].custom_id` (and `invoice_id` if you like), and store the PayPal order id on the shop order with a uniqueness guarantee. | Captures a cheap order and presents its PayPal order id for an expensive bag. |
| 4 | Paid means captured. Mark an order paid only after your server's capture call returns a capture with status `COMPLETED` whose amount and currency equal the shop order's total and whose `custom_id` is that order. Buyer approval (`onApprove`, `CHECKOUT.ORDER.APPROVED`) is never payment. | Calls your capture route for orders that were never approved, and sends real `CHECKOUT.ORDER.APPROVED` webhooks for orders that were never captured. |
| 5 | Failed captures stay unpaid. `422 INSTRUMENT_DECLINED`: ask the buyer to choose another way to pay; `TRANSACTION_REFUSED` and other errors: unpaid, with PayPal's reason; capture status `PENDING`: wait for the `PAYMENT.CAPTURE.COMPLETED` webhook. Never fulfil on an error. | Injects PayPal's negative-testing header `PayPal-Mock-Response` on the capture call. |
| 6 | Verify every webhook with PayPal before trusting it: `POST {PAYPAL_API_BASE}/v1/notifications/verify-webhook-signature` with a client-credentials access token and body `{ auth_algo, cert_url, transmission_id, transmission_sig, transmission_time }` (from the `PAYPAL-AUTH-ALGO`, `PAYPAL-CERT-URL`, `PAYPAL-TRANSMISSION-ID`, `PAYPAL-TRANSMISSION-SIG`, `PAYPAL-TRANSMISSION-TIME` headers) plus `webhook_id: PAYPAL_WEBHOOK_ID` and `webhook_event` (the parsed body). Act only on `verification_status: "SUCCESS"`; otherwise answer 400 and change nothing. | Posts forged events, and real events with an edited body. |
| 7 | Webhooks are idempotent. Record each event id once (a unique key); a repeat delivery answers 200 and changes nothing. | Replays a real delivery several times. |
| 8 | Fulfil exactly once, whichever path gets there first (capture response, webhook, retry, double click). Claim the transition atomically, for example `UPDATE orders SET status = 'paid' ... WHERE id = ? AND status = 'pending'` and fulfil only if one row changed. `fulfilOrder` prints a shipping label every time it is called. | Fires two captures at once and lets the webhook race the capture response. |
| 9 | Never move an order backwards. An old or duplicate event (for example `CHECKOUT.ORDER.APPROVED` after the capture) does not change a paid or fulfilled order. | Replays events out of order. |
| 10 | Capturing twice is safe. On `ORDER_ALREADY_CAPTURED` (or any unknown outcome), read the order from PayPal and settle from what PayPal holds. | Calls your capture route again after a successful purchase. |
| 11 | Validate the bag: known SKUs only, integer quantities 1 to 10. | Sends negative, fractional and huge quantities and unknown SKUs. |
| 12 | Secrets stay on the server. Only the client id reaches the browser. | Searches the served pages and scripts for the secret. |

Keep the card checkout working. Put the PayPal amount conversion in one function with a unit test (`4900` gives `"49.00"`, `5` gives `"0.05"`).
