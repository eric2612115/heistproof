# Copper Kettle (second sample shop)

A small kitchen-goods shop that takes PayPal, Venmo and Pay Later with PayPal's JS SDK v6 and the Orders v2 API.
It is built differently from the Fogline sample on purpose, to show that Heistproof does not depend on one shop's shape:

| | Fogline (shops/fogline-*) | Copper Kettle |
|---|---|---|
| Server | Express | `node:http` only, no dependencies |
| Cart | in `localStorage`, sent as `items: [{ sku, qty }]` | in the page, sent as `lines: [{ product, count }]` |
| Requests | plain JSON | a session cookie and an `x-csrf-token` header on every POST |
| Checkout routes | `/api/paypal/orders`, `/api/paypal/orders/:id/capture` | `/api/checkout/paypal`, `/api/checkout/paypal/:id/capture` |
| Webhooks | `/api/paypal/webhooks` | `/hooks/paypal` |
| Back office | `/api/admin/orders` (`x-admin-key`), fields `status`, `shipments` | `/api/staff/orders` (`x-staff-token`), fields `state`, `parcels` |

`heistproof.json` tells Heistproof how to shop here and where the back office is; the robberies learn the checkout
routes by watching a real purchase, as they do everywhere.

The checkout is written carefully (prices from the server's catalog, one capture per order with a fixed
`PayPal-Request-Id`, fulfilment only for a completed capture of the exact amount, verified and de-duplicated webhooks,
approval never treated as payment), so all ten robberies should be blocked:

```bash
npm run check -- shops/copper-kettle --offline
```

Run `npm start` here (with the PayPal variables from the main README) to shop by hand on http://127.0.0.1:4600.
