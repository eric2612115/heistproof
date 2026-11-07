# Fogline Supply Co.

The Fogline shop after Heistproof's coding agent added PayPal, Venmo and Pay Later (from the recorded full run). `npm run check -- examples/fogline-after` buys and attacks it in the PayPal sandbox.

- `server.js`: catalog API, card checkout, order status, back office.
- `lib/cart.js`: prices the bag on the server from `lib/catalog.js`. Prices are integer cents.
- `lib/card-processor.js`: the card processor client (test mode; card numbers ending in 0002 are declined).
- `lib/fulfilment.js`: hands a paid order to the warehouse. Each call prints a shipping label, so it must run once per order.
- `public/`: storefront (`index.html`, `app.js`) and back office (`admin.html`).

```bash
npm install
npm test
npm start            # http://127.0.0.1:4411, back office at /admin
```

Environment: `PORT` (4411), `HOST` (127.0.0.1), `SHOP_DB` (data/shop.db), `ADMIN_KEY` (local-admin), `CARD_PROCESSOR_KEY`.
