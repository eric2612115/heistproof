import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { products } from "./lib/catalog.js";
import { priceCart, formatMoney } from "./lib/cart.js";
import { openDb } from "./lib/db.js";
import { createCardProcessor } from "./lib/card-processor.js";
import { fulfilOrder } from "./lib/fulfilment.js";

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
