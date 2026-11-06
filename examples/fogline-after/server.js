import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { products } from "./lib/catalog.js";
import { priceCart, formatMoney } from "./lib/cart.js";
import { openDb } from "./lib/db.js";
import { createCardProcessor } from "./lib/card-processor.js";
import { createPayPalService, inspectOrder, PayPalUpstreamError } from "./lib/paypal.js";
import { fulfilOrder } from "./lib/fulfilment.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp({ db, cards, adminKey, paypal = null }) {
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

  // ---- PayPal checkout (PayPal / Venmo / Pay Later via the v6 web SDK) ----
  // The browser sends SKUs and quantities only; every amount is priced here.
  const paypalUnavailable = (res) => res.status(503).json({ error: "PayPal payments are not available." });

  // The one fulfilment gate for PayPal: a COMPLETED capture for the right amount,
  // currency and shop order, applied through the atomic pending -> paid flip so
  // capture responses, webhooks, retries and double clicks fulfil at most once.
  function settleFromPayPalOrder(shopOrder, paypalOrder) {
    const check = inspectOrder(paypalOrder, { shopOrderId: shopOrder.id, totalCents: shopOrder.total_cents, currency: shopOrder.currency });
    if (check.state === "captured") {
      const flipped = db.markPaidIfPending(shopOrder.id, { method: "paypal", reference: check.capture.id, paidCents: check.paidCents });
      if (flipped) fulfilOrder(db, shopOrder.id);
      return { settled: true, check };
    }
    return { settled: false, check };
  }

  function sendPayPalError(res, err, orderId) {
    if (err instanceof PayPalUpstreamError) {
      console.error(`[paypal] ${orderId ?? ""} ${err.message}${err.issue ? ` issue=${err.issue}` : ""}`, err.cause ?? "");
      const body = { error: err.message };
      if (err.issue) body.code = err.issue;
      if (orderId) body.orderId = orderId;
      return res.status(err.httpStatus).json(body);
    }
    throw err;
  }

  app.get("/api/paypal/config", (_req, res) => {
    if (!paypal) return paypalUnavailable(res);
    res.json(paypal.config());
  });

  app.post("/api/paypal/orders", async (req, res) => {
    if (!paypal) return paypalUnavailable(res);
    const { items } = req.body ?? {};
    let cart;
    try {
      cart = priceCart(items);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    const order = db.createOrder({ lines: cart.lines, totalCents: cart.totalCents, currency: cart.currency, method: "paypal" });
    // Durable claim before the provider call, keyed on the shop order id.
    const claimKey = `create:${order.id}`;
    db.claimPaypal(claimKey, { shopOrderId: order.id, kind: "create", reference: order.id });
    try {
      const created = await paypal.createOrder({ shopOrderId: order.id, cart, payPalRequestId: order.id });
      db.setPaypalOrderId(order.id, created.id);
      db.settleClaim(claimKey, { paypalOrderId: created.id });
      return res.json({ id: created.id, orderId: order.id });
    } catch (err) {
      if (err instanceof PayPalUpstreamError && !err.outcomeUnknown) {
        db.releaseClaim(claimKey); // provider refused: a later attempt is not blocked
        db.markFailed(order.id, err.message);
      }
      return sendPayPalError(res, err, order.id);
    }
  });

  app.post("/api/paypal/orders/:paypalOrderId/capture", async (req, res) => {
    if (!paypal) return paypalUnavailable(res);
    const shopOrder = db.getOrderByPaypalOrderId(req.params.paypalOrderId);
    if (!shopOrder) return res.status(404).json({ error: "Order not found" });
    const current = db.getOrder(shopOrder.id);
    if (current.status === "fulfilled" || current.status === "paid") {
      return res.json({ orderId: shopOrder.id, status: current.status });
    }
    if (current.status !== "pending") return res.status(409).json({ error: "Order is not payable.", orderId: shopOrder.id });
    const claimKey = `capture:${shopOrder.id}`;
    const freshClaim = db.claimPaypal(claimKey, { shopOrderId: shopOrder.id, kind: "capture", reference: shopOrder.id });
    try {
      // A pre-existing claim means an earlier attempt's outcome was unknown:
      // settle from what PayPal holds instead of capturing a second time.
      const paypalOrder = freshClaim
        ? await paypal.captureOrder({ paypalOrderId: req.params.paypalOrderId, payPalRequestId: shopOrder.id })
        : await paypal.getOrder(req.params.paypalOrderId);
      const { settled, check } = settleFromPayPalOrder(shopOrder, paypalOrder);
      if (settled) {
        db.settleClaim(claimKey, { paypalOrderId: req.params.paypalOrderId });
        return res.json({ orderId: shopOrder.id, status: db.getOrder(shopOrder.id).status });
      }
      if (check.state === "no_capture" && !freshClaim) {
        // Another attempt is in flight (or its outcome is unsettled): pending.
        return res.status(202).json({ error: "Payment is being processed.", orderId: shopOrder.id, status: "pending" });
      }
      if (check.state === "capture_not_completed" && check.captureStatus === "PENDING") {
        // Wait for PAYMENT.CAPTURE.COMPLETED; the claim stays for that settlement.
        return res.status(202).json({ error: "Payment is pending.", orderId: shopOrder.id, status: "pending" });
      }
      if (check.state === "capture_not_completed") {
        db.releaseClaim(claimKey);
        return res.status(402).json({ error: "The payment was not completed.", orderId: shopOrder.id });
      }
      // Paid amount / binding does not match this shop order: never fulfil.
      db.releaseClaim(claimKey);
      return res.status(422).json({ error: "The captured payment does not match this order.", orderId: shopOrder.id });
    } catch (err) {
      if (err instanceof PayPalUpstreamError) {
        if (err.issue === "INSTRUMENT_DECLINED") {
          db.releaseClaim(claimKey); // buyer may choose another way to pay
          return res.status(402).json({ error: "Your payment method was declined. Please choose another way to pay.", code: err.issue, orderId: shopOrder.id });
        }
        if (!err.outcomeUnknown) db.releaseClaim(claimKey);
        return sendPayPalError(res, err, shopOrder.id);
      }
      throw err;
    }
  });

  app.post("/api/paypal/webhooks", async (req, res) => {
    if (!paypal) return paypalUnavailable(res);
    const event = req.body ?? {};
    if (!event.id || !event.event_type) return res.status(400).json({ error: "Bad webhook event" });
    // Repeat of an already-recorded delivery: 200, nothing changes.
    if (db.hasWebhookEvent(event.id)) return res.json({ received: true, duplicate: true });
    const verified = await paypal.verifyWebhook({
      headers: {
        authAlgo: req.get("paypal-auth-algo"),
        certUrl: req.get("paypal-cert-url"),
        transmissionId: req.get("paypal-transmission-id"),
        transmissionSig: req.get("paypal-transmission-sig"),
        transmissionTime: req.get("paypal-transmission-time"),
      },
      event,
    });
    if (!verified) return res.status(400).json({ error: "Webhook verification failed" });

    if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
      const paypalOrderId = event.resource?.supplementary_data?.related_ids?.order_id;
      const shopOrder = (paypalOrderId && db.getOrderByPaypalOrderId(paypalOrderId)) || (event.resource?.custom_id && db.getOrder(event.resource.custom_id));
      if (shopOrder && shopOrder.status === "pending") {
        let paypalOrder;
        try {
          paypalOrder = await paypal.getOrder(paypalOrderId ?? shopOrder.paypal_order_id);
        } catch (err) {
          // Transient: do not record the event, so PayPal's redelivery can settle.
          console.error(`[paypal] webhook re-read failed for ${shopOrder.id}`, err);
          return res.status(500).json({ error: "Settlement unavailable" });
        }
        settleFromPayPalOrder(shopOrder, paypalOrder); // no-ops on mismatch / not captured
      }
    }
    // CHECKOUT.ORDER.APPROVED and everything else: verified, recorded, no action.
    // Only the pending -> paid flip above ever moves an order, never backwards.
    db.recordWebhookEvent(event.id, event.event_type);
    return res.json({ received: true });
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
  // PayPal is built once (its OAuth token cache lives on the client). If any
  // PayPal env is present the factory validates all of it and fails startup on
  // a missing credential; with none present, card checkout still runs.
  let paypal = null;
  if (process.env.PAYPAL_CLIENT_ID || process.env.PAYPAL_CLIENT_SECRET || process.env.PAYPAL_API_BASE) {
    paypal = createPayPalService({
      clientId: process.env.PAYPAL_CLIENT_ID,
      clientSecret: process.env.PAYPAL_CLIENT_SECRET,
      baseUrl: process.env.PAYPAL_API_BASE ?? "https://api-m.sandbox.paypal.com",
      webhookId: process.env.PAYPAL_WEBHOOK_ID ?? null,
      testBuyerCountry: process.env.PAYPAL_TEST_BUYER_COUNTRY ?? null,
    });
  }
  const app = createApp({ db, cards, adminKey: process.env.ADMIN_KEY ?? "local-admin", paypal });
  app.listen(port, host, () => console.log(`Fogline shop on http://${host === "0.0.0.0" ? "localhost" : host}:${port}`));
}
