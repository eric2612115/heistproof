import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { products } from "./lib/catalog.js";
import { priceCart, formatMoney } from "./lib/cart.js";
import { openDb } from "./lib/db.js";
import { createCardProcessor } from "./lib/card-processor.js";
import { fulfilOrder } from "./lib/fulfilment.js";
import { paypal } from "./lib/paypal.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp({ db, cards, adminKey }) {
  const app = express();
  app.use(express.json({ limit: "100kb" }));
  app.use(express.static(path.join(here, "public")));

  app.get("/api/products", (_req, res) => {
    res.json(products.map((p) => ({ ...p, price: formatMoney(p.priceCents) })));
  });

  // Card checkout: price the bag on the server, charge the card, then hand the order to the warehouse.
  app.post("/api/checkout/card", async (req, res) => {
    const { items, email, card } = req.body ?? {};
    let cart;
    try {
      cart = priceCart(items);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    const order = db.createOrder({ email, lines: cart.lines, totalCents: cart.totalCents, currency: cart.currency, method: "card" });
    const charge = await cards.charges.create({
      amount: cart.totalCents,
      currency: cart.currency,
      source: card,
      idempotencyKey: order.id,
      description: `Fogline order ${order.id}`,
    });
    if (charge.status !== "succeeded") {
      db.markFailed(order.id, charge.failure_message);
      return res.status(402).json({ error: charge.failure_message, orderId: order.id });
    }
    db.markPaid(order.id, { method: "card", reference: charge.id, paidCents: charge.amount });
    fulfilOrder(db, order.id);
    res.json({ orderId: order.id, status: db.getOrder(order.id).status });
  });

  // ---- PayPal (added in an afternoon) ----
  app.get("/api/paypal/config", (_req, res) => {
    res.json({ clientId: process.env.PAYPAL_CLIENT_ID, testBuyerCountry: process.env.PAYPAL_TEST_BUYER_COUNTRY });
  });

  app.post("/api/paypal/orders", async (req, res) => {
    let cart;
    try {
      cart = priceCart(req.body.items);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    const order = db.createOrder({ email: null, lines: cart.lines, totalCents: cart.totalCents, currency: cart.currency, method: "paypal" });
    const ppOrder = await paypal("POST", "/v2/checkout/orders", {
      intent: "CAPTURE",
      purchase_units: [
        {
          custom_id: order.id,
          amount: { currency_code: req.body.currency ?? "USD", value: String(req.body.amount ?? (cart.totalCents / 100).toFixed(2)) },
        },
      ],
    });
    db.raw.prepare("UPDATE orders SET payment_reference = ? WHERE id = ?").run(ppOrder.id, order.id);
    res.json({ id: ppOrder.id, orderId: order.id });
  });

  app.post("/api/paypal/orders/:id/capture", async (req, res) => {
    const capture = await paypal("POST", `/v2/checkout/orders/${req.params.id}/capture`);
    const order = db.listOrders().find((o) => o.payment_reference === req.params.id);
    if (!order) return res.status(404).json({ error: "unknown order" });
    db.markPaid(order.id, { method: "paypal", reference: req.params.id, paidCents: order.total_cents });
    fulfilOrder(db, order.id);
    res.json({ orderId: order.id, status: capture.status });
  });

  app.post("/api/paypal/webhooks", (req, res) => {
    const event = req.body;
    if (event.event_type === "CHECKOUT.ORDER.APPROVED" || event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
      const paypalOrderId = event.resource?.supplementary_data?.related_ids?.order_id ?? event.resource?.id;
      const order = db.listOrders().find((o) => o.payment_reference === paypalOrderId || o.id === event.resource?.custom_id);
      if (order) {
        db.markPaid(order.id, { method: "paypal", reference: paypalOrderId, paidCents: order.total_cents });
        fulfilOrder(db, order.id);
      }
    }
    res.sendStatus(200);
  });

  // Order status for the thank-you page.
  app.get("/api/orders/:id", (req, res) => {
    const order = db.getOrder(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    res.json({ id: order.id, status: order.status, total: formatMoney(order.total_cents), items: order.items });
  });

  // Back office.
  const requireAdmin = (req, res, next) => {
    if (req.get("x-admin-key") !== adminKey) return res.status(401).json({ error: "admin key required" });
    next();
  };
  app.get("/api/admin/orders", requireAdmin, (_req, res) => res.json(db.listOrders()));
  app.get("/admin", (_req, res) => res.sendFile(path.join(here, "public", "admin.html")));

  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 4411);
  const host = process.env.HOST ?? "127.0.0.1";
  const db = openDb(process.env.SHOP_DB ?? path.join(here, "data", "shop.db"));
  const cards = createCardProcessor({ apiKey: process.env.CARD_PROCESSOR_KEY ?? "test_card_key" });
  const app = createApp({ db, cards, adminKey: process.env.ADMIN_KEY ?? "local-admin" });
  app.listen(port, host, () => console.log(`Fogline shop on http://${host === "0.0.0.0" ? "localhost" : host}:${port}`));
}
