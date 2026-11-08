// The offline PayPal stand-in must follow the Orders v2 rules the robberies depend on; otherwise an offline "blocked"
// would mean nothing. Each test is one rule.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { PayPalStandIn } from "../src/paypal/stand-in.ts";

const pp = new PayPalStandIn();
let token = "";
const received: Array<{ headers: Record<string, string>; body: string }> = [];
let hooks: http.Server;

const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const r = await fetch(`${pp.url}${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as any };
};
const order = (value = "49.00", extra: Record<string, unknown> = {}) => call("POST", "/v2/checkout/orders", { intent: "CAPTURE", purchase_units: [{ amount: { currency_code: "USD", value }, ...extra }] });
const approve = (id: string) => fetch(`${pp.url}/checkoutnow/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: id }) });
const issue = (r: { body: any }) => r.body?.details?.[0]?.issue ?? r.body?.name;

before(async () => {
  hooks = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    received.push({ headers: req.headers as Record<string, string>, body: Buffer.concat(chunks).toString() });
    res.end("ok");
  });
  await new Promise<void>((r) => hooks.listen(0, "127.0.0.1", r));
  await pp.start(0);
  pp.webhookUrl = `http://127.0.0.1:${(hooks.address() as any).port}/hooks`;
  const r = await fetch(`${pp.url}/v1/oauth2/token`, { method: "POST", headers: { authorization: `Basic ${Buffer.from(`${pp.clientId}:${pp.clientSecret}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
  token = ((await r.json()) as any).access_token;
});
after(async () => {
  await pp.stop();
  hooks.close();
});

test("OAuth needs the right client id and secret; every other call needs the token", async () => {
  const bad = await fetch(`${pp.url}/v1/oauth2/token`, { method: "POST", headers: { authorization: `Basic ${Buffer.from(`${pp.clientId}:wrong`).toString("base64")}` }, body: "grant_type=client_credentials" });
  assert.equal(bad.status, 401);
  const noToken = await fetch(`${pp.url}/v2/checkout/orders`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(noToken.status, 401);
});

test("PayPal checks the amount and the items before it creates an order", async () => {
  assert.equal((await order("49.00")).status, 201);
  assert.equal(issue(await order("-1.00")), "INVALID_PARAMETER_VALUE");
  assert.equal(issue(await order("0.00")), "AMOUNT_NOT_POSITIVE");
  assert.equal(issue(await order("4.999")), "INVALID_PARAMETER_VALUE");
  assert.equal(issue(await call("POST", "/v2/checkout/orders", { intent: "CAPTURE", purchase_units: [{ amount: { currency_code: "JPY", value: "49.00" } }] })), "DECIMAL_PRECISION");
  const item = (quantity: string, value = "49.00") => ({ name: "Hoodie", quantity, unit_amount: { currency_code: "USD", value } });
  assert.equal(issue(await order("49.00", { items: [item("1")] })), "ITEM_TOTAL_REQUIRED");
  assert.equal(issue(await order("49.00", { items: [item("-1")] })), "ITEM_TOTAL_REQUIRED");
  const withTotal = (items: unknown[], total: string, value = total) => call("POST", "/v2/checkout/orders", { intent: "CAPTURE", purchase_units: [{ amount: { currency_code: "USD", value, breakdown: { item_total: { currency_code: "USD", value: total } } }, items }] });
  assert.equal((await withTotal([item("2")], "98.00")).status, 201);
  assert.equal(issue(await withTotal([item("-1")], "49.00")), "INVALID_PARAMETER_VALUE");
  assert.equal(issue(await withTotal([item("0.5")], "24.50")), "INVALID_PARAMETER_VALUE");
  assert.equal(issue(await withTotal([item("1")], "0.01")), "ITEM_TOTAL_MISMATCH");
  assert.equal(issue(await withTotal([item("1")], "49.00", "0.01")), "AMOUNT_MISMATCH");
});

test("an order can be captured only after the buyer approved it, once, with a JSON body", async () => {
  const { body: o } = await order();
  assert.equal(issue(await call("POST", `/v2/checkout/orders/${o.id}/capture`, {})), "ORDER_NOT_APPROVED");
  assert.equal((await approve(o.id)).status, 200);
  const noJson = await fetch(`${pp.url}/v2/checkout/orders/${o.id}/capture`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
  assert.equal(noJson.status, 415, "PayPal's sandbox refuses a capture without a JSON content type");
  const first = await call("POST", `/v2/checkout/orders/${o.id}/capture`, {}, { "paypal-request-id": "same-request" });
  assert.equal(first.status, 201);
  assert.equal(first.body.purchase_units[0].payments.captures[0].status, "COMPLETED");
  const retried = await call("POST", `/v2/checkout/orders/${o.id}/capture`, {}, { "paypal-request-id": "same-request" });
  assert.equal(retried.body.purchase_units[0].payments.captures[0].id, first.body.purchase_units[0].payments.captures[0].id, "PayPal-Request-Id makes a retry return the same capture");
  assert.equal(issue(await call("POST", `/v2/checkout/orders/${o.id}/capture`, {})), "ORDER_ALREADY_CAPTURED");
  assert.equal((await call("GET", `/v2/checkout/orders/${o.id}`)).body.status, "COMPLETED");
});

test("negative testing: PayPal-Mock-Response declines the capture and leaves the order approved", async () => {
  const { body: o } = await order();
  await approve(o.id);
  const declined = await call("POST", `/v2/checkout/orders/${o.id}/capture`, {}, { "paypal-mock-response": JSON.stringify({ mock_application_codes: "INSTRUMENT_DECLINED" }) });
  assert.equal(declined.status, 422);
  assert.equal(issue(declined), "INSTRUMENT_DECLINED");
  assert.equal((await call("GET", `/v2/checkout/orders/${o.id}`)).body.status, "APPROVED");
});

test("webhooks are signed: the event as sent verifies, a replay verifies, any edit fails", async () => {
  received.length = 0;
  const { body: o } = await order();
  await approve(o.id);
  await call("POST", `/v2/checkout/orders/${o.id}/capture`, {});
  const about = (type: string) => received.find((d) => {
    const e = JSON.parse(d.body);
    return e.event_type === type && (e.resource.id === o.id || e.resource.supplementary_data?.related_ids?.order_id === o.id);
  });
  for (let i = 0; i < 40 && !(about("PAYMENT.CAPTURE.COMPLETED") && about("CHECKOUT.ORDER.APPROVED")); i++) await new Promise((r) => setTimeout(r, 50));
  const completed = about("PAYMENT.CAPTURE.COMPLETED")!;
  assert.ok(completed, "PAYMENT.CAPTURE.COMPLETED delivered");
  assert.ok(about("CHECKOUT.ORDER.APPROVED"), "CHECKOUT.ORDER.APPROVED delivered");
  const event = JSON.parse(completed.body);
  assert.equal(event.resource.supplementary_data.related_ids.order_id, o.id);
  const verify = async (h: Record<string, string>, webhookEvent: unknown, webhookId = pp.webhookId) =>
    (await call("POST", "/v1/notifications/verify-webhook-signature", { auth_algo: h["paypal-auth-algo"], cert_url: h["paypal-cert-url"], transmission_id: h["paypal-transmission-id"], transmission_sig: h["paypal-transmission-sig"], transmission_time: h["paypal-transmission-time"], webhook_id: webhookId, webhook_event: webhookEvent })).body.verification_status;
  assert.equal(await verify(completed.headers, event), "SUCCESS");
  assert.equal(await verify(completed.headers, JSON.parse(completed.body)), "SUCCESS", "a byte-for-byte replay still verifies, as with PayPal");
  assert.equal(await verify(completed.headers, { ...event, resource: { ...event.resource, custom_id: "FOG-OTHER" } }), "FAILURE");
  assert.equal(await verify(completed.headers, event, "WH-SOMEONE-ELSE"), "FAILURE");
  assert.equal(await verify({ ...completed.headers, "paypal-transmission-sig": "forged" }, event), "FAILURE");
});

test("an order created to AUTHORIZE cannot be captured with the Orders capture call", async () => {
  const o = await call("POST", "/v2/checkout/orders", { intent: "AUTHORIZE", purchase_units: [{ amount: { currency_code: "USD", value: "49.00" } }] });
  assert.equal(o.status, 201);
  await approve(o.body.id);
  const r = await call("POST", `/v2/checkout/orders/${o.body.id}/capture`, {});
  assert.equal(r.status, 422);
  assert.equal(issue(r), "ACTION_DOES_NOT_MATCH_INTENT");
});

test("negative testing comes first: a mocked capture with no content type is declined, as in the sandbox, not refused with 415", async () => {
  const o = await order();
  await approve(o.body.id);
  const r = await fetch(`${pp.url}/v2/checkout/orders/${o.body.id}/capture`, { method: "POST", headers: { authorization: `Bearer ${token}`, "paypal-mock-response": JSON.stringify({ mock_application_codes: "INSTRUMENT_DECLINED" }) } });
  assert.equal(r.status, 422);
  assert.equal(issue({ body: await r.json() }), "INSTRUMENT_DECLINED");
});

test("events can be listed and resent to the webhook, signed again and still verifiable", async () => {
  const o = await order();
  await approve(o.body.id);
  const captured = await call("POST", `/v2/checkout/orders/${o.body.id}/capture`, {}, { "paypal-request-id": `resend-${Date.now()}` });
  const captureId = captured.body.purchase_units[0].payments.captures[0].id;
  await new Promise((r) => setTimeout(r, 400));
  const list = await call("GET", "/v1/notifications/webhooks-events?event_type=PAYMENT.CAPTURE.COMPLETED&page_size=50");
  const event = list.body.events.find((e: any) => e.resource?.id === captureId);
  assert.ok(event, "the capture's event is listed");
  const before = received.filter((d) => JSON.parse(d.body).id === event.id).length;
  const resent = await call("POST", `/v1/notifications/webhooks-events/${event.id}/resend`, { webhook_ids: [pp.webhookId] });
  assert.equal(resent.status, 202);
  await new Promise((r) => setTimeout(r, 300));
  const deliveries = received.filter((d) => JSON.parse(d.body).id === event.id);
  assert.equal(deliveries.length, before + 1, "delivered once more");
  const last = deliveries.at(-1)!;
  const verified = await call("POST", "/v1/notifications/verify-webhook-signature", {
    auth_algo: last.headers["paypal-auth-algo"],
    cert_url: last.headers["paypal-cert-url"],
    transmission_id: last.headers["paypal-transmission-id"],
    transmission_sig: last.headers["paypal-transmission-sig"],
    transmission_time: last.headers["paypal-transmission-time"],
    webhook_id: pp.webhookId,
    webhook_event: JSON.parse(last.body),
  });
  assert.equal(verified.body.verification_status, "SUCCESS");
});
