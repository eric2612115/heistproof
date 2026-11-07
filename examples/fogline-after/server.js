import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { products } from "./lib/catalog.js";
import { priceCart, formatMoney } from "./lib/cart.js";
import { openDb } from "./lib/db.js";
import { createCardProcessor } from "./lib/card-processor.js";
import { fulfilOrder } from "./lib/fulfilment.js";
import { createPayPalServiceFromEnv, assessPayPalOrder, parsePayPalAmount, PayPalServiceError } from "./lib/paypal.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp({ db, cards, adminKey, paypal }) {
  const app = express();
  app.use(express.json({ limit: "100kb" }));
  app.use(express.static(path.join(here, "public")));

  // PayPal service is built once (lazily from env when not injected) so its
  // OAuth token cache survives across requests. Missing PayPal configuration
  // fails PayPal routes only; card checkout keeps working.
  let paypalService = paypal ?? null;
  let paypalConfigError = null;
  const getPayPal = () => {
    if (paypalService) return paypalService;
    if (paypalConfigError) throw paypalConfigError;
    try {
      paypalService = createPayPalServiceFromEnv();
      return paypalService;
    } catch (err) {
      paypalConfigError = new PayPalServiceError("Payment provider unavailable.", { httpStatus: 502, neverSent: true });
      throw paypalConfigError;
    }
  };
  const paypalError = (res, err, orderId) => {
    const e = err instanceof PayPalServiceError ? err : new PayPalServiceError("Payment provider error.", { httpStatus: 502 });
    return res.status(e.httpStatus).json({ error: e.message, ...(orderId ? { orderId } : {}), ...(e.outcomeUnknown ? { status: "pending" } : {}) });
  };

  // Fulfil exactly once: only the caller that atomically moves pending -> paid
  // may call fulfilOrder (every call prints a shipping label).
  const settlePaid = (shopOrder, capture) => {
    const paidCents = capture?.amount ? parsePayPalAmount(capture.amount.value ?? capture.amount) : shopOrder.total_cents;
    const won = db.claimPaidTransition(shopOrder.id, {
      method: "paypal",
      reference: capture?.id ?? shopOrder.paypal_order_id,
      paidCents: paidCents ?? shopOrder.total_cents,
    });
    if (won) fulfilOrder(db, shopOrder.id);
    return db.getOrder(shopOrder.id);
  };

  // Settle a shop order from a PayPal Order object PayPal holds. Returns an
  // HTTP-ready outcome; never fulfils unless a matching COMPLETED capture exists.
  const settleFromPayPalOrder = (shopOrder, paypalOrder) => {
    if (paypalOrder?.id && shopOrder.paypal_order_id && paypalOrder.id !== shopOrder.paypal_order_id) {
      return { kind: "mismatch" };
    }
    const assessment = assessPayPalOrder(paypalOrder, shopOrder);
    if (assessment.state === "completed") return { kind: "settled", order: settlePaid(shopOrder, assessment.capture) };
    return { kind: assessment.state };
  };

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

  // --- PayPal: browser config (client id only, never the secret) ---
  app.get("/api/paypal/config", (_req, res) => {
    try {
      res.json(getPayPal().getBrowserConfig());
    } catch (err) {
      return paypalError(res, err);
    }
  });

  // --- PayPal: create order. Prices come only from the server catalog; any
  // price/amount/total/currency the browser sends is ignored. ---
  app.post("/api/paypal/orders", async (req, res) => {
    const { items, email } = req.body ?? {};
    let cart;
    try {
      cart = priceCart(items);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    let service;
    try {
      service = getPayPal();
    } catch (err) {
      return paypalError(res, err);
    }
    // Claim first: the shop order row exists before any PayPal call.
    const shopOrder = db.createOrder({ email, lines: cart.lines, totalCents: cart.totalCents, currency: cart.currency, method: "paypal" });
    const claimKey = `create:${shopOrder.id}`;
    if (!db.claimPayPal(claimKey, { shopOrderId: shopOrder.id })) {
      return res.status(409).json({ error: "Order creation already in progress", orderId: shopOrder.id });
    }
    try {
      const paypalOrder = await service.createOrder({ shopOrderId: shopOrder.id, cart, email });
      try {
        db.bindPayPalOrder(shopOrder.id, paypalOrder.id);
      } catch {
        return res.status(409).json({ error: "PayPal order already bound to another order", orderId: shopOrder.id });
      }
      db.setClaimPayPalOrder(claimKey, paypalOrder.id);
      return res.json({ id: paypalOrder.id, orderId: shopOrder.id, status: "pending" });
    } catch (err) {
      const e = err instanceof PayPalServiceError ? err : null;
      if (!e) throw err;
      if (e.neverSent || (e.paypalStatus >= 400 && e.paypalStatus < 500)) {
        db.releasePayPalClaim(claimKey);
        db.markFailed(shopOrder.id, e.message);
      }
      return paypalError(res, e, shopOrder.id);
    }
  });

  // --- PayPal: capture. The browser presents only the PayPal order id (in the
  // path); its body and headers (incl. any PayPal-Mock-Response) are ignored
  // and never forwarded. Approval alone is never payment. ---
  app.post("/api/paypal/orders/:paypalOrderId/capture", async (req, res) => {
    const paypalOrderId = req.params.paypalOrderId;
    const shopOrder = db.getOrderByPayPalId(paypalOrderId);
    if (!shopOrder) return res.status(404).json({ error: "Order not found" });
    if (shopOrder.status === "fulfilled" || shopOrder.status === "paid") {
      return res.json({ orderId: shopOrder.id, status: shopOrder.status });
    }
    if (shopOrder.status !== "pending") return res.status(409).json({ error: "Order is not payable", orderId: shopOrder.id, status: shopOrder.status });
    let service;
    try {
      service = getPayPal();
    } catch (err) {
      return paypalError(res, err, shopOrder.id);
    }
    const claimKey = `capture:${paypalOrderId}`;
    if (!db.claimPayPal(claimKey, { shopOrderId: shopOrder.id, paypalOrderId })) {
      // Second caller: do not capture again. Settle from what PayPal holds.
      try {
        const held = await service.getOrder(paypalOrderId);
        const outcome = settleFromPayPalOrder(shopOrder, held);
        if (outcome.kind === "settled") return res.json({ orderId: shopOrder.id, status: outcome.order.status });
      } catch { /* still in flight / unknown */ }
      return res.status(202).json({ error: "Capture already in progress", orderId: shopOrder.id, status: "pending" });
    }
    try {
      const paypalOrder = await service.captureOrder(paypalOrderId, claimKey);
      const outcome = settleFromPayPalOrder(shopOrder, paypalOrder);
      db.releasePayPalClaim(claimKey);
      if (outcome.kind === "settled") return res.json({ orderId: shopOrder.id, status: outcome.order.status });
      if (outcome.kind === "pending") return res.status(202).json({ error: "Payment is pending", orderId: shopOrder.id, status: "pending" });
      if (outcome.kind === "mismatch") return res.status(422).json({ error: "Captured amount does not match this order", orderId: shopOrder.id, status: "pending" });
      // Capture returned but was not completed (e.g. DECLINED).
      return res.status(422).json({ error: "Payment was not completed. Please choose another way to pay.", orderId: shopOrder.id, status: "pending" });
    } catch (err) {
      const e = err instanceof PayPalServiceError ? err : null;
      if (!e) throw err;
      if (e.neverSent || (e.paypalStatus >= 400 && e.paypalStatus < 500)) db.releasePayPalClaim(claimKey);
      if (e.issue === "INSTRUMENT_DECLINED") {
        return res.status(422).json({ error: `${e.message} Please choose another way to pay.`, orderId: shopOrder.id, status: "pending" });
      }
      return paypalError(res, e, shopOrder.id);
    }
  });

  // --- PayPal webhooks: verify with PayPal first, record the event id once,
  // and let only a verified PAYMENT.CAPTURE.COMPLETED settle an order. ---
  app.post("/api/paypal/webhooks", async (req, res) => {
    const event = req.body ?? {};
    if (!event?.id || !event?.event_type) return res.status(400).json({ error: "Invalid webhook event" });
    let service;
    try {
      service = getPayPal();
    } catch (err) {
      return paypalError(res, err);
    }
    let verified = false;
    try {
      verified = await service.verifyWebhook(
        {
          authAlgo: req.get("paypal-auth-algo"),
          certUrl: req.get("paypal-cert-url"),
          transmissionId: req.get("paypal-transmission-id"),
          transmissionSig: req.get("paypal-transmission-sig"),
          transmissionTime: req.get("paypal-transmission-time"),
        },
        event,
      );
    } catch (err) {
      return paypalError(res, err);
    }
    if (!verified) return res.status(400).json({ error: "Webhook verification failed" });
    if (!db.recordWebhookEvent(event.id, event.event_type)) {
      return res.json({ received: true, duplicate: true }); // replay: 200, change nothing
    }
    if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
      const resource = event.resource ?? {};
      const relatedOrderId = resource.supplementary_data?.related_ids?.order_id;
      let shopOrder = relatedOrderId ? db.getOrderByPayPalId(relatedOrderId) : null;
      if (!shopOrder && resource.custom_id) shopOrder = db.getOrder(resource.custom_id);
      if (shopOrder && shopOrder.status === "pending") {
        const cents = parsePayPalAmount(resource.amount?.value);
        const currency = String(resource.amount?.currency_code ?? "").toUpperCase();
        const customMatches = !resource.custom_id || resource.custom_id === shopOrder.id;
        const orderMatches = !relatedOrderId || shopOrder.paypal_order_id === relatedOrderId;
        if (resource.status === "COMPLETED" && customMatches && orderMatches && cents === shopOrder.total_cents && currency === String(shopOrder.currency).toUpperCase()) {
          settlePaid(shopOrder, { id: resource.id, amount: resource.amount });
        }
      }
    }
    // CHECKOUT.ORDER.APPROVED, PAYMENT.CAPTURE.PENDING and everything else:
    // recorded above, never pay, never move an order backwards.
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
  const app = createApp({ db, cards, adminKey: process.env.ADMIN_KEY ?? "local-admin" });
  app.listen(port, host, () => console.log(`Fogline shop on http://${host === "0.0.0.0" ? "localhost" : host}:${port}`));
}
