// Copper Kettle: a small kitchen-goods shop that takes PayPal, Venmo and Pay Later.
// It is built differently from the Fogline sample on purpose: no web framework (node:http only), a server-side
// session with a CSRF token that every POST must carry, its own routes and its own order fields. Heistproof
// checks it through shops/copper-kettle/heistproof.json.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { CATALOG, priceLines, dollars } from "./lib/catalog.js";
import { openStore } from "./lib/store.js";
import { paypalFromEnv } from "./lib/paypal.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

export function createShop({ store, paypal, staffToken }) {
  const sessions = new Map(); // session id -> { csrf }
  const inflight = new Map(); // shop order ref -> the capture already under way (a double click shares it)

  const session = (req, res) => {
    const sid = /(?:^|;\s*)kc_sid=([a-f0-9]{48})/.exec(req.headers.cookie ?? "")?.[1];
    if (sid && sessions.has(sid)) return sessions.get(sid);
    const id = crypto.randomBytes(24).toString("hex");
    const s = { csrf: crypto.randomBytes(24).toString("hex") };
    sessions.set(id, s);
    res.setHeader("set-cookie", `kc_sid=${id}; HttpOnly; SameSite=Lax; Path=/`);
    return s;
  };
  const send = (res, status, body, type = "application/json") => {
    res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
    res.end(type === "application/json" ? JSON.stringify(body) : body);
  };
  const readBody = async (req) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    return Buffer.concat(chunks).toString("utf8");
  };

  /** Marks an order paid and ships it, once, only for a completed capture of exactly the order's amount. */
  function settle(order, capture) {
    if (!capture) return { status: 502, body: { error: "PayPal did not complete the payment. Nothing was charged." } };
    if (capture.status === "PENDING") {
      store.note(order, `capture ${capture.id} pending`);
      return { status: 202, body: { ref: order.ref, pending: true } };
    }
    if (capture.status !== "COMPLETED") return { status: 502, body: { error: "PayPal did not complete the payment. Nothing was charged." } };
    if (capture.amount?.currency_code !== "USD" || capture.amount?.value !== dollars(order.total_cents)) {
      order.state = "review";
      store.note(order, `capture ${capture.id} for ${capture.amount?.currency_code} ${capture.amount?.value} does not match ${dollars(order.total_cents)} USD`);
      return { status: 409, body: { error: "The payment does not match the order; it is held for review." } };
    }
    if (order.state === "awaiting_payment") {
      order.state = "paid";
      order.paypal_capture = capture.id;
      store.note(order, `paid by capture ${capture.id}`);
    }
    if (order.state === "paid" && order.parcels === 0 && order.paypal_capture === capture.id) {
      order.parcels = 1;
      order.state = "shipped";
      store.note(order, "parcel booked");
    }
    return { status: 200, body: { ref: order.ref, state: order.state } };
  }

  async function capture(order) {
    if (order.state !== "awaiting_payment") return { status: 200, body: { ref: order.ref, state: order.state } };
    const r = await paypal.captureOrder(order.paypal_order, order.ref);
    const issue = r.body?.details?.[0]?.issue;
    if (r.status === 422 && (issue === "INSTRUMENT_DECLINED" || issue === "TRANSACTION_REFUSED")) {
      store.note(order, `capture refused by PayPal: ${issue} (${r.debugId})`);
      return { status: 402, body: { error: "PayPal declined that payment. Please choose another way to pay.", retry: true } };
    }
    let found = r.status < 300 ? r.body?.purchase_units?.[0]?.payments?.captures?.[0] : null;
    if (r.status === 422 && issue === "ORDER_ALREADY_CAPTURED") found = (await paypal.getOrder(order.paypal_order)).body?.purchase_units?.[0]?.payments?.captures?.[0];
    if (!found) {
      store.note(order, `capture failed: HTTP ${r.status} ${issue ?? ""} (${r.debugId})`);
      return { status: 502, body: { error: "PayPal did not complete the payment. Nothing was charged." } };
    }
    return settle(order, found);
  }

  return async function handle(req, res) {
    const url = new URL(req.url ?? "/", "http://shop");
    const p = url.pathname;
    try {
      if (req.method === "GET" && p === "/") {
        const s = session(req, res);
        const html = fs.readFileSync(path.join(here, "public", "index.html"), "utf8").replace("{{CSRF}}", s.csrf);
        return send(res, 200, html, TYPES[".html"]);
      }
      if (req.method === "GET" && p.startsWith("/static/")) {
        const file = path.join(here, "public", path.normalize(p.slice("/static/".length)));
        if (!file.startsWith(path.join(here, "public")) || !fs.existsSync(file)) return send(res, 404, { error: "not found" });
        return send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] ?? "application/octet-stream");
      }
      if (req.method === "GET" && p === "/api/catalog") return send(res, 200, Object.entries(CATALOG).map(([sku, c]) => ({ sku, name: c.name, price: dollars(c.cents), blurb: c.blurb })));
      if (req.method === "GET" && p === "/api/paypal/client") return send(res, 200, paypal.browserConfig());
      if (req.method === "GET" && p === "/staff") return send(res, 200, fs.readFileSync(path.join(here, "public", "staff.html"), "utf8"), TYPES[".html"]);
      if (req.method === "GET" && p === "/api/staff/orders") {
        if (!staffToken || req.headers["x-staff-token"] !== staffToken) return send(res, 401, { error: "staff only" });
        return send(res, 200, { orders: store.orders().map(({ history, ...o }) => o) });
      }

      // PayPal's webhooks: verified with PayPal, each event handled once, and only a completed capture moves money.
      if (req.method === "POST" && p === "/hooks/paypal") {
        let event;
        try {
          event = JSON.parse(await readBody(req));
        } catch {
          return send(res, 400, { error: "not JSON" });
        }
        if (!(await paypal.verifyWebhook(req.headers, event))) return send(res, 400, { error: "signature not verified" });
        if (store.seen(event.id)) return send(res, 200, { duplicate: true });
        store.remember(event.id);
        if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
          const cap = event.resource ?? {};
          const order = store.byRef(cap.custom_id) ?? store.byPayPal(cap.supplementary_data?.related_ids?.order_id);
          if (order && (order.state === "awaiting_payment" || order.paypal_capture === cap.id)) settle(order, cap);
        }
        // CHECKOUT.ORDER.APPROVED and the rest change nothing: approval is not payment.
        return send(res, 200, { ok: true });
      }

      if (req.method === "POST" && p.startsWith("/api/")) {
        const s = session(req, res);
        if (req.headers["x-csrf-token"] !== s.csrf) return send(res, 403, { error: "Please reload the page and try again." });
        let body = {};
        try {
          body = JSON.parse((await readBody(req)) || "{}");
        } catch {
          return send(res, 400, { error: "not JSON" });
        }
        if (p === "/api/checkout/paypal") {
          let priced;
          try {
            priced = priceLines(body.lines);
          } catch (err) {
            return send(res, 422, { error: err.message });
          }
          const order = store.add({ ...priced, currency: "USD" });
          const r = await paypal.createOrder(order);
          if (r.status >= 300 || !r.body?.id) {
            store.note(order, `PayPal refused the order: HTTP ${r.status} (${r.debugId})`);
            return send(res, 502, { error: "PayPal is not available right now." });
          }
          order.paypal_order = r.body.id;
          store.note(order, `PayPal order ${r.body.id} created for ${dollars(order.total_cents)} USD`);
          return send(res, 201, { ref: order.ref, paypalOrderId: r.body.id });
        }
        const m = /^\/api\/checkout\/paypal\/([^/]+)\/capture$/.exec(p);
        if (m) {
          const order = store.byPayPal(decodeURIComponent(m[1]));
          if (!order) return send(res, 404, { error: "unknown order" });
          if (!inflight.has(order.ref)) inflight.set(order.ref, capture(order).finally(() => inflight.delete(order.ref)));
          const out = await inflight.get(order.ref);
          return send(res, out.status, out.body);
        }
      }
      return send(res, 404, { error: "not found" });
    } catch (err) {
      console.error(err);
      return send(res, 500, { error: "Something went wrong." });
    }
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 4600);
  const host = process.env.HOST ?? "127.0.0.1";
  const shop = createShop({ store: openStore(process.env.SHOP_DB), paypal: paypalFromEnv(process.env), staffToken: process.env.ADMIN_KEY });
  http.createServer(shop).listen(port, host, () => console.log(`Copper Kettle on http://${host}:${port}`));
}
