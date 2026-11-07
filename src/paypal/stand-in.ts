import http from "node:http";
import crypto from "node:crypto";
import { standInSdk } from "./stand-in-sdk.ts";

/**
 * Heistproof's offline PayPal: a local stand-in for the parts of PayPal a checkout touches, so the robberies can run
 * with no PayPal account and no network. It follows the documented Orders v2 rules the attacks depend on:
 * - OAuth client credentials; every other call needs the bearer token.
 * - An order is created with an amount PayPal validates (two decimals, positive, item totals that add up).
 * - It can be captured only after the buyer approved it on PayPal's page, and only once (PayPal-Request-Id is idempotent).
 * - A capture without a JSON content type is refused with 415, as the sandbox does.
 * - Negative testing: the PayPal-Mock-Response header turns a capture into INSTRUMENT_DECLINED or TRANSACTION_REFUSED.
 * - Webhooks are signed; verify-webhook-signature says SUCCESS only for an event exactly as it was sent (a replay of a
 *   genuine delivery still verifies, as with PayPal; any edit fails).
 * It is not PayPal: only a run against the real sandbox proves a shop against PayPal itself.
 */

type Order = {
  id: string;
  intent: string;
  status: "CREATED" | "APPROVED" | "COMPLETED";
  purchase_units: any[];
  payer?: Record<string, unknown>;
  create_time: string;
  update_time: string;
  captures: any[];
};

const CHARS = "ABCDEFGHJKLMNPRSTUVWXY0123456789";
const paypalId = (n = 17) => Array.from(crypto.randomBytes(n), (b) => CHARS[b % CHARS.length]).join("");
const now = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

function crc32(text: string): number {
  let c = ~0;
  for (const byte of Buffer.from(text, "utf8")) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

type Answer = { status: number; body: unknown; headers?: Record<string, string> };

const error = (status: number, name: string, issue: string | null, description: string): Answer => ({
  status,
  body: {
    name,
    message: description,
    debug_id: paypalId(13).toLowerCase(),
    ...(issue ? { details: [{ issue, description }] } : {}),
  },
});

export type StandInLog = { at: string; method: string; path: string; status: number };

export class PayPalStandIn {
  readonly clientId = `offline-${paypalId(24)}`;
  readonly clientSecret = `offline-secret-${crypto.randomBytes(18).toString("hex")}`;
  readonly webhookId = `WH-OFFLINE-${paypalId(10)}`;
  readonly payerEmail = "buyer@offline.example.com";
  /** Where signed events go (the webhook tap). */
  webhookUrl: string | null = null;
  url = "";
  readonly log: StandInLog[] = [];
  private orders = new Map<string, Order>();
  private tokens = new Set<string>();
  private idempotent = new Map<string, Answer>();
  private sent = new Map<string, { webhookId: string; time: string; body: string }>();
  private signingKey = crypto.randomBytes(32);
  private server: http.Server | null = null;
  private pending = new Set<Promise<unknown>>();

  async start(port: number): Promise<string> {
    this.server = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const raw = Buffer.concat(chunks).toString("utf8");
      const url = new URL(req.url ?? "/", "http://stand-in");
      let answer: Answer;
      try {
        answer = await this.route(req.method ?? "GET", url, req.headers, raw);
      } catch (err) {
        answer = error(500, "INTERNAL_SERVER_ERROR", null, String((err as Error).message ?? err));
      }
      this.log.push({ at: new Date().toISOString(), method: req.method ?? "GET", path: url.pathname, status: answer.status });
      const isText = typeof answer.body === "string";
      res.writeHead(answer.status, {
        "content-type": isText ? (answer.headers?.["content-type"] ?? "text/html; charset=utf-8") : "application/json",
        "paypal-debug-id": paypalId(13).toLowerCase(),
        ...(answer.headers ?? {}),
      });
      res.end(isText ? (answer.body as string) : JSON.stringify(answer.body));
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(port, "127.0.0.1", resolve);
    });
    this.url = `http://127.0.0.1:${(this.server.address() as { port: number }).port}`;
    return this.url;
  }

  async stop() {
    await Promise.allSettled([...this.pending]);
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
    this.server = null;
  }

  /** The browser script that stands in for PayPal's JS SDK v6 (served in place of www.sandbox.paypal.com/web-sdk/v6/core). */
  sdk(live = false): string {
    return standInSdk({ origin: this.url, clientId: this.clientId, live });
  }

  order(id: string): Order | undefined {
    return this.orders.get(id);
  }

  private async route(method: string, url: URL, headers: http.IncomingHttpHeaders, raw: string): Promise<Answer> {
    const p = url.pathname.replace(/^\/api-m\.sandbox\.paypal\.com(?=\/)/, "");
    if (method === "GET" && /^\/web-sdk\/v6\/core$/.test(p)) return { status: 200, body: this.sdk(), headers: { "content-type": "application/javascript" } };
    if (method === "GET" && p === "/checkoutnow") return this.approvalPage(url.searchParams.get("token") ?? "", url.searchParams.get("fundingSource") ?? "paypal");
    if (method === "POST" && p === "/checkoutnow/approve") return this.approve(raw);
    if (method === "POST" && p === "/v1/oauth2/token") return this.oauth(headers, raw);

    const bearer = /^Bearer (.+)$/.exec(String(headers.authorization ?? ""))?.[1];
    if (!bearer || !this.tokens.has(bearer)) return error(401, "AUTHENTICATION_FAILURE", null, "Authentication failed due to invalid authentication credentials or a missing Authorization header.");

    if (method === "POST" && p === "/v2/checkout/orders") return this.createOrder(headers, raw);
    let m = /^\/v2\/checkout\/orders\/([^/]+)$/.exec(p);
    if (method === "GET" && m) {
      const o = this.orders.get(decodeURIComponent(m[1]));
      return o ? { status: 200, body: this.view(o) } : error(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID", "Specified resource ID does not exist. Please check the resource ID and try again.");
    }
    m = /^\/v2\/checkout\/orders\/([^/]+)\/capture$/.exec(p);
    if (method === "POST" && m) return this.capture(decodeURIComponent(m[1]), headers, raw);
    if (method === "POST" && p === "/v1/notifications/verify-webhook-signature") return this.verify(raw);
    m = /^\/v2\/payments\/captures\/([^/]+)$/.exec(p);
    if (method === "GET" && m) {
      for (const o of this.orders.values()) for (const c of o.captures) if (c.id === m[1]) return { status: 200, body: c };
      return error(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID", "Specified resource ID does not exist.");
    }
    return error(404, "NOT_FOUND", null, `The PayPal stand-in does not implement ${method} ${p}.`);
  }

  private oauth(headers: http.IncomingHttpHeaders, raw: string): Answer {
    const basic = /^Basic (.+)$/.exec(String(headers.authorization ?? ""))?.[1];
    const [id, secret] = basic ? Buffer.from(basic, "base64").toString("utf8").split(":") : [];
    if (id !== this.clientId || secret !== this.clientSecret) return { status: 401, body: { error: "invalid_client", error_description: "Client Authentication failed" } };
    const form = new URLSearchParams(raw);
    if (form.get("grant_type") !== "client_credentials") return { status: 400, body: { error: "unsupported_grant_type", error_description: "Grant Type is NULL" } };
    const token = `A21AA${crypto.randomBytes(24).toString("hex")}`;
    this.tokens.add(token);
    return { status: 200, body: { scope: "https://uri.paypal.com/services/payments/payment", access_token: token, token_type: "Bearer", app_id: "APP-OFFLINE", expires_in: 32400, nonce: `${now()}${paypalId(8)}` } };
  }

  private createOrder(headers: http.IncomingHttpHeaders, raw: string): Answer {
    const replay = this.replayed(headers, "create");
    if (replay) return replay;
    let body: any;
    try {
      body = JSON.parse(raw);
    } catch {
      return error(400, "INVALID_REQUEST", "MALFORMED_REQUEST_JSON", "The request JSON is not well formed.");
    }
    if (!["CAPTURE", "AUTHORIZE"].includes(body?.intent)) return error(400, "INVALID_REQUEST", "MISSING_REQUIRED_PARAMETER", "/intent: A required field / parameter is missing or invalid.");
    const units = Array.isArray(body.purchase_units) ? body.purchase_units : [];
    if (units.length === 0) return error(400, "INVALID_REQUEST", "MISSING_REQUIRED_PARAMETER", "/purchase_units: A required field / parameter is missing.");
    for (const u of units) {
      const problem = checkUnit(u);
      if (problem) return problem;
    }
    const order: Order = {
      id: paypalId(),
      intent: body.intent,
      status: "CREATED",
      purchase_units: units.map((u: any, i: number) => ({ reference_id: u.reference_id ?? (i === 0 ? "default" : `unit-${i}`), ...u, payee: { email_address: "merchant@offline.example.com", merchant_id: "OFFLINEMERCHANT" } })),
      create_time: now(),
      update_time: now(),
      captures: [],
    };
    this.orders.set(order.id, order);
    return this.remember(headers, "create", { status: 201, body: this.view(order) });
  }

  private approvalPage(token: string, fundingSource: string): Answer {
    const o = this.orders.get(token);
    if (!o) return { status: 404, body: `<!doctype html><title>PayPal stand-in</title><p>Unknown order ${escapeHtml(token)}.</p>` };
    const amount = o.purchase_units[0]?.amount ?? {};
    const items = (o.purchase_units[0]?.items ?? []) as any[];
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>PayPal stand-in · review your payment</title>
<style>body{font:15px/1.5 system-ui,sans-serif;margin:0;background:#f5f7fa;color:#1c2430}main{max-width:420px;margin:32px auto;background:#fff;border-radius:12px;padding:28px;box-shadow:0 2px 12px rgba(0,0,0,.08)}
h1{font-size:18px;margin:0 0 4px}small{color:#5b6573}.amount{font-size:30px;font-weight:700;margin:18px 0 6px}ul{padding-left:18px;color:#3b4552}
button{width:100%;border:0;border-radius:24px;background:#0b5ed7;color:#fff;font-weight:700;font-size:16px;padding:12px;margin-top:18px;cursor:pointer}a{display:block;text-align:center;margin-top:12px;color:#0b5ed7}</style></head>
<body><main><h1>Offline PayPal stand-in</h1><small>Heistproof offline mode: no PayPal account, no real money. Funding: ${escapeHtml(fundingSource)}.</small>
<div class="amount">${escapeHtml(String(amount.value ?? "?"))} ${escapeHtml(String(amount.currency_code ?? ""))}</div><div>Order ${escapeHtml(o.id)} · buyer ${this.payerEmail}</div>
<ul>${items.map((i) => `<li>${escapeHtml(String(i.quantity ?? "?"))} × ${escapeHtml(String(i.name ?? i.sku ?? "item"))} at ${escapeHtml(String(i.unit_amount?.value ?? "?"))}</li>`).join("")}</ul>
<button id="payment-submit-btn" type="button">Complete Purchase</button><a href="#" id="cancel-link">Cancel and return to the store</a></main>
<script>
const token = ${JSON.stringify(o.id)};
const tell = (type, extra) => { try { window.opener && window.opener.postMessage({ source: "heistproof-offline-paypal", type, orderId: token, ...extra }, "*"); } catch {} };
document.getElementById("payment-submit-btn").addEventListener("click", async (ev) => {
  ev.target.disabled = true;
  const r = await fetch("/checkoutnow/approve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
  const d = await r.json().catch(() => ({}));
  tell(r.ok ? "approve" : "error", { payerId: d.payerId, message: d.message });
  setTimeout(() => window.close(), 50);
});
document.getElementById("cancel-link").addEventListener("click", (ev) => { ev.preventDefault(); tell("cancel"); setTimeout(() => window.close(), 50); });
</script></body></html>`;
    return { status: 200, body: html };
  }

  private approve(raw: string): Answer {
    let token = "";
    try {
      token = JSON.parse(raw).token;
    } catch {
      /* empty */
    }
    const o = this.orders.get(token);
    if (!o) return error(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID", "Unknown order.");
    if (o.status !== "CREATED") return error(422, "UNPROCESSABLE_ENTITY", "ORDER_ALREADY_APPROVED", `Order is ${o.status}.`);
    o.status = "APPROVED";
    o.update_time = now();
    o.payer = { name: { given_name: "Offline", surname: "Buyer" }, email_address: this.payerEmail, payer_id: "OFFLINEPAYER01", address: { country_code: "US" } };
    this.emit("CHECKOUT.ORDER.APPROVED", "checkout-order", this.view(o), `An order has been approved by buyer.`);
    return { status: 200, body: { payerId: "OFFLINEPAYER01" } };
  }

  private capture(id: string, headers: http.IncomingHttpHeaders, raw: string): Answer {
    const replay = this.replayed(headers, `capture:${id}`);
    if (replay) return replay;
    const type = String(headers["content-type"] ?? "");
    if (!/application\/json/i.test(type)) return error(415, "UNSUPPORTED_MEDIA_TYPE", null, "The server does not support the request payload's media type.");
    if (raw.trim()) {
      try {
        JSON.parse(raw);
      } catch {
        return error(400, "INVALID_REQUEST", "MALFORMED_REQUEST_JSON", "The request JSON is not well formed.");
      }
    }
    const o = this.orders.get(id);
    if (!o) return error(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID", "Specified resource ID does not exist. Please check the resource ID and try again.");
    const mock = mockCode(headers);
    if (mock === "INSTRUMENT_DECLINED") return this.remember(headers, `capture:${id}`, error(422, "UNPROCESSABLE_ENTITY", "INSTRUMENT_DECLINED", "The instrument presented was either declined by the processor or bank, or it can't be used for this payment."));
    if (mock === "TRANSACTION_REFUSED") return this.remember(headers, `capture:${id}`, error(422, "UNPROCESSABLE_ENTITY", "TRANSACTION_REFUSED", "The request was refused."));
    if (o.status === "COMPLETED") return this.remember(headers, `capture:${id}`, error(422, "UNPROCESSABLE_ENTITY", "ORDER_ALREADY_CAPTURED", "Order already captured. If 'intent=CAPTURE' only one capture per order is allowed."));
    if (o.status !== "APPROVED") return this.remember(headers, `capture:${id}`, error(422, "UNPROCESSABLE_ENTITY", "ORDER_NOT_APPROVED", "Payer has not yet approved the Order for payment. Please redirect the payer to the 'rel':'approve' url returned as part of the HATEOAS links within the Create Order call or provide a valid payment_source in the request."));
    const unit = o.purchase_units[0];
    const capture = {
      id: paypalId(),
      status: "COMPLETED",
      amount: unit.amount,
      final_capture: true,
      seller_protection: { status: "ELIGIBLE", dispute_categories: ["ITEM_NOT_RECEIVED", "UNAUTHORIZED_TRANSACTION"] },
      ...(unit.custom_id ? { custom_id: unit.custom_id } : {}),
      ...(unit.invoice_id ? { invoice_id: unit.invoice_id } : {}),
      create_time: now(),
      update_time: now(),
    };
    o.captures.push(capture);
    o.status = "COMPLETED";
    o.update_time = now();
    this.emit("PAYMENT.CAPTURE.COMPLETED", "capture", { ...capture, supplementary_data: { related_ids: { order_id: o.id } } }, `Payment completed for ${unit.amount?.value} ${unit.amount?.currency_code}`);
    return this.remember(headers, `capture:${id}`, { status: 201, body: this.view(o) });
  }

  private verify(raw: string): Answer {
    let b: any;
    try {
      b = JSON.parse(raw);
    } catch {
      return error(400, "INVALID_REQUEST", "MALFORMED_REQUEST_JSON", "The request JSON is not well formed.");
    }
    for (const f of ["auth_algo", "cert_url", "transmission_id", "transmission_sig", "transmission_time", "webhook_id", "webhook_event"]) {
      if (!b?.[f]) return error(400, "VALIDATION_ERROR", "MISSING_REQUIRED_PARAMETER", `${f}: A required field / parameter is missing.`);
    }
    const sent = this.sent.get(b.transmission_id);
    const event = typeof b.webhook_event === "string" ? b.webhook_event : JSON.stringify(b.webhook_event);
    const ok =
      !!sent &&
      b.webhook_id === this.webhookId &&
      sent.webhookId === b.webhook_id &&
      b.transmission_time === sent.time &&
      b.transmission_sig === this.sign(b.transmission_id, b.transmission_time, b.webhook_id, event) &&
      crc32(event) === crc32(sent.body);
    return { status: 200, body: { verification_status: ok ? "SUCCESS" : "FAILURE" } };
  }

  private sign(id: string, time: string, webhookId: string, body: string): string {
    return crypto.createHmac("sha256", this.signingKey).update(`${id}|${time}|${webhookId}|${crc32(body)}`).digest("base64");
  }

  /** Sends a signed event to the webhook address, a moment later, as PayPal does. */
  private emit(eventType: string, resourceType: string, resource: unknown, summary: string) {
    const event = {
      id: `WH-${paypalId(17)}`,
      event_version: "1.0",
      create_time: now(),
      resource_type: resourceType,
      resource_version: "2.0",
      event_type: eventType,
      summary,
      resource,
    };
    const body = JSON.stringify(event);
    const id = crypto.randomUUID();
    const time = now();
    this.sent.set(id, { webhookId: this.webhookId, time, body });
    const headers = {
      "content-type": "application/json",
      "paypal-auth-algo": "SHA256withRSA",
      "paypal-cert-url": `${this.url}/v1/notifications/certs/CERT-OFFLINE`,
      "paypal-transmission-id": id,
      "paypal-transmission-sig": this.sign(id, time, this.webhookId, body),
      "paypal-transmission-time": time,
      "user-agent": "PayPal/AUHD-214.0-58358640 (Heistproof offline stand-in)",
    };
    if (!this.webhookUrl) return;
    const target = this.webhookUrl;
    const job = new Promise((r) => setTimeout(r, 250)).then(() => fetch(target, { method: "POST", headers, body }).catch(() => null));
    this.pending.add(job);
    job.finally(() => this.pending.delete(job));
  }

  private view(o: Order) {
    return {
      id: o.id,
      intent: o.intent,
      status: o.status,
      purchase_units: o.purchase_units.map((u, i) => (i === 0 && o.captures.length ? { ...u, payments: { captures: o.captures } } : u)),
      ...(o.payer ? { payer: o.payer, payment_source: { paypal: { email_address: this.payerEmail, account_id: "OFFLINEPAYER01", account_status: "VERIFIED" } } } : {}),
      create_time: o.create_time,
      update_time: o.update_time,
      links: [
        { href: `${this.url}/v2/checkout/orders/${o.id}`, rel: "self", method: "GET" },
        ...(o.status === "CREATED" ? [{ href: `${this.url}/checkoutnow?token=${o.id}`, rel: "approve", method: "GET" }] : []),
        ...(o.status === "APPROVED" ? [{ href: `${this.url}/v2/checkout/orders/${o.id}/capture`, rel: "capture", method: "POST" }] : []),
      ],
    };
  }

  private replayed(headers: http.IncomingHttpHeaders, scope: string): Answer | null {
    const key = headers["paypal-request-id"];
    return typeof key === "string" && key ? (this.idempotent.get(`${scope}:${key}`) ?? null) : null;
  }

  private remember(headers: http.IncomingHttpHeaders, scope: string, answer: Answer): Answer {
    const key = headers["paypal-request-id"];
    if (typeof key === "string" && key) this.idempotent.set(`${scope}:${key}`, answer);
    return answer;
  }
}

function mockCode(headers: http.IncomingHttpHeaders): string | null {
  const raw = headers["paypal-mock-response"];
  if (typeof raw !== "string") return null;
  try {
    return String(JSON.parse(raw).mock_application_codes ?? "") || null;
  } catch {
    return null;
  }
}

const MONEY = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;
const ZERO_DECIMAL = new Set(["JPY", "HUF", "TWD"]);
const CURRENCIES = new Set(["USD", "EUR", "GBP", "CAD", "AUD", "JPY", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "MXN", "NZD", "SGD", "HKD", "ILS", "PHP", "THB", "TWD", "BRL", "MYR"]);
const cents = (v: string) => Math.round(Number(v) * 100);

/** The checks PayPal makes on a purchase unit's amount and items before it creates the order. */
function checkUnit(u: any): Answer | null {
  const amount = u?.amount;
  if (!amount || typeof amount.value !== "string" || typeof amount.currency_code !== "string") return error(400, "INVALID_REQUEST", "MISSING_REQUIRED_PARAMETER", "/purchase_units/@reference_id=='default'/amount: A required field / parameter is missing.");
  if (!CURRENCIES.has(amount.currency_code)) return error(422, "UNPROCESSABLE_ENTITY", "CURRENCY_NOT_SUPPORTED", "Currency code is not currently supported.");
  if (!MONEY.test(amount.value)) return error(400, "INVALID_REQUEST", "INVALID_PARAMETER_VALUE", "/purchase_units/@reference_id=='default'/amount/value: The value of a field is invalid.");
  if (ZERO_DECIMAL.has(amount.currency_code) && amount.value.includes(".")) return error(422, "UNPROCESSABLE_ENTITY", "DECIMAL_PRECISION", "If the currency supports decimals, only two decimal place precision is supported.");
  if (Number(amount.value) <= 0) return error(422, "UNPROCESSABLE_ENTITY", "AMOUNT_NOT_POSITIVE", "The amount must be greater than zero.");
  const items = Array.isArray(u.items) ? u.items : null;
  const breakdown = amount.breakdown;
  if (items && items.length) {
    if (!breakdown?.item_total) return error(422, "UNPROCESSABLE_ENTITY", "ITEM_TOTAL_REQUIRED", "If item details are specified (items.unit_amount and items.quantity) corresponding amount.breakdown.item_total is required.");
    let total = 0;
    for (const i of items) {
      if (typeof i.quantity !== "string" || !/^[1-9]\d{0,9}$/.test(i.quantity)) return error(400, "INVALID_REQUEST", "INVALID_PARAMETER_VALUE", "/purchase_units/@reference_id=='default'/items/0/quantity: The value of a field is invalid.");
      if (!i.unit_amount || !MONEY.test(String(i.unit_amount.value)) || i.unit_amount.currency_code !== amount.currency_code) return error(422, "UNPROCESSABLE_ENTITY", "ITEM_AMOUNT_MISMATCH", "Item amount and currency must be valid and match the order currency.");
      total += cents(i.unit_amount.value) * Number(i.quantity);
    }
    if (total !== cents(breakdown.item_total.value)) return error(422, "UNPROCESSABLE_ENTITY", "ITEM_TOTAL_MISMATCH", "Should equal sum of (unit_amount * quantity) across all items for a given purchase_unit.");
  }
  if (breakdown) {
    const plus = ["item_total", "shipping", "handling", "tax_total", "insurance"].reduce((s, k) => s + (breakdown[k] ? cents(breakdown[k].value) : 0), 0);
    const minus = ["discount", "shipping_discount"].reduce((s, k) => s + (breakdown[k] ? cents(breakdown[k].value) : 0), 0);
    if (plus - minus !== cents(amount.value)) return error(422, "UNPROCESSABLE_ENTITY", "AMOUNT_MISMATCH", "Should equal item_total + tax_total + shipping + handling + insurance - shipping_discount - discount.");
  }
  return null;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
