import crypto from "node:crypto";
import { dollars } from "./catalog.js";

/**
 * PayPal REST (Orders v2 and webhook verification) over fetch. Sandbox or live comes from PAYPAL_ENV, never from the
 * API address, which a proxy or a test harness may own.
 */
export function paypalFromEnv(env, fetchImpl = fetch) {
  const base = String(env.PAYPAL_API_BASE || "https://api-m.sandbox.paypal.com").replace(/\/+$/, "");
  const live = env.PAYPAL_ENV === "live";
  let token = null;

  async function accessToken() {
    if (token && token.expires > Date.now() + 60_000) return token.value;
    const res = await fetchImpl(`${base}/v1/oauth2/token`, {
      method: "POST",
      headers: { authorization: `Basic ${Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    const body = await res.json();
    if (!res.ok || !body.access_token) throw new Error(`PayPal sign-in failed (${res.status})`);
    token = { value: body.access_token, expires: Date.now() + (body.expires_in ?? 300) * 1000 };
    return token.value;
  }

  async function call(method, path, body, headers = {}) {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { raw: text.slice(0, 200) };
    }
    return { status: res.status, body: parsed, debugId: res.headers.get("paypal-debug-id") };
  }

  return {
    browserConfig: () => ({
      clientId: env.PAYPAL_CLIENT_ID ?? null,
      sdkUrl: live ? "https://www.paypal.com/web-sdk/v6/core" : "https://www.sandbox.paypal.com/web-sdk/v6/core",
      ...(!live && env.PAYPAL_TEST_BUYER_COUNTRY ? { testBuyerCountry: env.PAYPAL_TEST_BUYER_COUNTRY } : {}),
    }),

    /** One PayPal order per shop order, for the amount the server computed. */
    createOrder(order) {
      const value = dollars(order.total_cents);
      return call(
        "POST",
        "/v2/checkout/orders",
        {
          intent: "CAPTURE",
          purchase_units: [
            {
              reference_id: order.ref,
              custom_id: order.ref,
              invoice_id: `${order.ref}-${crypto.randomBytes(2).toString("hex")}`,
              amount: { currency_code: "USD", value, breakdown: { item_total: { currency_code: "USD", value } } },
              items: order.lines.map((l) => ({ name: l.name, sku: l.product, quantity: String(l.count), unit_amount: { currency_code: "USD", value: dollars(l.unit_cents) }, category: "PHYSICAL_GOODS" })),
            },
          ],
        },
        { "paypal-request-id": `create-${order.ref}` },
      );
    },

    /** The same request id for every attempt, so PayPal captures an order at most once even if we ask twice. */
    captureOrder: (paypalOrderId, ref) => call("POST", `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {}, { "paypal-request-id": `capture-${ref}` }),
    getOrder: (paypalOrderId) => call("GET", `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`),

    /** Asks PayPal whether a webhook delivery is genuine and meant for this shop's webhook. */
    async verifyWebhook(headers, event) {
      if (!env.PAYPAL_WEBHOOK_ID) return false;
      const need = ["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"];
      if (need.some((h) => !headers[h])) return false;
      const r = await call("POST", "/v1/notifications/verify-webhook-signature", {
        auth_algo: headers["paypal-auth-algo"],
        cert_url: headers["paypal-cert-url"],
        transmission_id: headers["paypal-transmission-id"],
        transmission_sig: headers["paypal-transmission-sig"],
        transmission_time: headers["paypal-transmission-time"],
        webhook_id: env.PAYPAL_WEBHOOK_ID,
        webhook_event: event,
      });
      return r.status === 200 && r.body?.verification_status === "SUCCESS";
    },
  };
}
