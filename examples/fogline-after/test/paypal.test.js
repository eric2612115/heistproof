import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server.js";
import { openDb } from "../lib/db.js";
import { createCardProcessor } from "../lib/card-processor.js";
import { createPayPalService, formatPayPalAmount, parsePayPalAmount, PayPalServiceError } from "../lib/paypal.js";

const jsonRes = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const paypalErrorBody = (issue, description) => ({
  name: "UNPROCESSABLE_ENTITY",
  message: description,
  debug_id: "debug-123",
  details: [{ issue, description, location: "body" }],
});

function completedOrderWire(fake, { captureStatus = "COMPLETED", captureValue, captureCustomId } = {}) {
  const pu = fake.state.created.purchase_units[0];
  return {
    id: fake.state.paypalOrderId,
    status: "COMPLETED",
    purchase_units: [
      {
        custom_id: pu.custom_id,
        amount: pu.amount,
        payments: {
          captures: [
            {
              id: "CAP-1",
              status: captureStatus,
              amount: { currency_code: "USD", value: captureValue ?? pu.amount.value },
              custom_id: captureCustomId ?? pu.custom_id,
            },
          ],
        },
      },
    ],
  };
}

// Fake PayPal at the fetch seam: token, orders, capture, get-order and
// webhook verification all route on pathname. No network is touched.
function makeFakePayPal() {
  const fake = { calls: [], state: { paypalOrderId: "PP-ORDER-1" } };
  fake.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const bodyText = request.method === "GET" ? undefined : await request.clone().text().catch(() => undefined);
    let json;
    try { json = bodyText ? JSON.parse(bodyText) : undefined; } catch { json = undefined; }
    const call = { url, request, bodyText, json };
    fake.calls.push(call);
    if (url.pathname === "/v1/oauth2/token") {
      if (fake.state.tokenHandler) return fake.state.tokenHandler(call);
      return jsonRes(200, { access_token: "test-token", token_type: "Bearer", expires_in: 3600 });
    }
    if (url.pathname === "/v1/notifications/verify-webhook-signature") {
      if (fake.state.verifyHandler) return fake.state.verifyHandler(call);
      return jsonRes(200, { verification_status: "SUCCESS" });
    }
    if (url.pathname === "/v2/checkout/orders" && request.method === "POST") {
      if (fake.state.createHandler) return fake.state.createHandler(call);
      fake.state.created = json;
      const pu = json.purchase_units[0];
      return jsonRes(201, {
        id: fake.state.paypalOrderId,
        status: "CREATED",
        intent: "CAPTURE",
        purchase_units: [{ reference_id: pu.reference_id, custom_id: pu.custom_id, invoice_id: pu.invoice_id, amount: pu.amount }],
      });
    }
    if (/^\/v2\/checkout\/orders\/[^/]+\/capture$/.test(url.pathname)) {
      if (fake.state.captureHandler) return fake.state.captureHandler(call);
      return jsonRes(200, completedOrderWire(fake));
    }
    if (/^\/v2\/checkout\/orders\/[^/]+$/.test(url.pathname) && request.method === "GET") {
      if (fake.state.getOrderHandler) return fake.state.getOrderHandler(call);
      return jsonRes(200, completedOrderWire(fake));
    }
    return jsonRes(404, paypalErrorBody("RESOURCE_NOT_FOUND", "not found"));
  };
  fake.callsTo = (pathPart, method) => fake.calls.filter((c) => c.url.pathname.includes(pathPart) && (!method || c.request.method === method));
  return fake;
}

async function startPayPalShop(fake, serviceOpts = {}) {
  const db = openDb(":memory:");
  const paypal = createPayPalService({
    clientId: "test-client-id",
    clientSecret: "test-secret-value",
    webhookId: "WH-TEST-1",
    baseUrl: "https://api-m.sandbox.paypal.com",
    fetchImpl: fake.fetch,
    ...serviceOpts,
  });
  const app = createApp({ db, cards: createCardProcessor({ apiKey: "test" }), adminKey: "k", paypal });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  return { db, paypal, base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

const post = (url, body, headers = {}) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

async function createHoodieOrder(shop) {
  const res = await post(`${shop.base}/api/paypal/orders`, {
    items: [{ sku: "FOG-HOODIE", qty: 1, price: 1 }],
    email: "buyer@example.com",
    price: 1, amount: 1, total: 1, currency: "EUR",
  });
  assert.equal(res.status, 200);
  return res.json();
}

function webhookHeaders() {
  return {
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-cert-url": "https://api.sandbox.paypal.com/certs/cert-1.pem",
    "paypal-transmission-id": "trans-1",
    "paypal-transmission-sig": "sig-1",
    "paypal-transmission-time": "2026-01-01T00:00:00Z",
  };
}

test("formatPayPalAmount converts cents to decimal dollars exactly", () => {
  assert.equal(formatPayPalAmount(4900), "49.00");
  assert.equal(formatPayPalAmount(5), "0.05");
  assert.equal(formatPayPalAmount(0), "0.00");
  assert.equal(parsePayPalAmount("49.00"), 4900);
  assert.equal(parsePayPalAmount("0.05"), 5);
  assert.equal(parsePayPalAmount("49.999"), null);
});

test("create order prices from the catalog, binds custom_id, and sends no invented fields", async () => {
  const fake = makeFakePayPal();
  const shop = await startPayPalShop(fake);
  try {
    const data = await createHoodieOrder(shop);
    assert.equal(data.id, "PP-ORDER-1");
    const order = shop.db.getOrder(data.orderId);
    assert.equal(order.paypal_order_id, "PP-ORDER-1");
    assert.equal(order.total_cents, 4900);

    const createCall = fake.callsTo("/v2/checkout/orders", "POST")[0];
    assert.deepEqual(Object.keys(createCall.json).sort(), ["intent", "purchase_units"]);
    assert.equal(createCall.json.intent, "CAPTURE");
    const pu = createCall.json.purchase_units[0];
    assert.equal(pu.amount.value, "49.00");
    assert.equal(pu.amount.currency_code, "USD");
    assert.equal(pu.amount.breakdown.item_total.value, "49.00");
    assert.equal(pu.custom_id, data.orderId);
    assert.equal(pu.invoice_id, data.orderId);
    assert.equal(pu.items[0].unit_amount.value, "49.00");
    assert.equal(pu.items[0].quantity, "1");
    assert.equal(createCall.request.headers.get("paypal-request-id"), data.orderId);
    assert.equal(createCall.request.headers.get("paypal-mock-response"), null);
    // Claim existed before the request left (recorded in our store).
    assert.equal(shop.db.getPayPalClaim(`create:${data.orderId}`)?.paypal_order_id, "PP-ORDER-1");
    // OAuth token went to the same configured base.
    assert.equal(fake.callsTo("/v1/oauth2/token").length, 1);
  } finally {
    await shop.close();
  }
});

test("create order rejects bad bags and never calls PayPal", async () => {
  const fake = makeFakePayPal();
  const shop = await startPayPalShop(fake);
  try {
    for (const items of [[{ sku: "NOPE", qty: 1 }], [{ sku: "FOG-HOODIE", qty: 0 }], [{ sku: "FOG-HOODIE", qty: -1 }], [{ sku: "FOG-HOODIE", qty: 1.5 }], [{ sku: "FOG-HOODIE", qty: 99 }], []]) {
      const res = await post(`${shop.base}/api/paypal/orders`, { items });
      assert.equal(res.status, 400);
    }
    assert.equal(fake.callsTo("/v2/checkout/orders").length, 0);
  } finally {
    await shop.close();
  }
});

test("capture with a COMPLETED capture fulfils exactly once; a second capture is safe", async () => {
  const fake = makeFakePayPal();
  const shop = await startPayPalShop(fake);
  try {
    const data = await createHoodieOrder(shop);
    let claimSeenDuringCapture = false;
    fake.state.captureHandler = () => {
      claimSeenDuringCapture = Boolean(shop.db.getPayPalClaim("capture:PP-ORDER-1"));
      return jsonRes(200, completedOrderWire(fake));
    };
    const res = await post(`${shop.base}/api/paypal/orders/PP-ORDER-1/capture`, {}, { "paypal-mock-response": '{"mock_application_codes":"INSTRUMENT_DECLINED"}' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.orderId, data.orderId);
    assert.equal(claimSeenDuringCapture, true);
    assert.equal(shop.db.getOrder(data.orderId).status, "fulfilled");
    assert.equal(shop.db.getOrder(data.orderId).paid_cents, 4900);
    assert.equal(shop.db.shipmentsFor(data.orderId).length, 1);

    const captureCall = fake.callsTo("/capture", "POST")[0];
    assert.equal(captureCall.request.headers.get("prefer"), "return=representation");
    assert.equal(captureCall.request.headers.get("paypal-mock-response"), null);
    assert.equal(captureCall.request.headers.get("paypal-request-id"), "capture:PP-ORDER-1");

    const again = await post(`${shop.base}/api/paypal/orders/PP-ORDER-1/capture`, {});
    assert.equal(again.status, 200);
    assert.equal((await again.json()).status, "fulfilled");
    assert.equal(shop.db.shipmentsFor(data.orderId).length, 1);
  } finally {
    await shop.close();
  }
});

test("capture sends an empty JSON body so PayPal does not reject it with 415", async () => {
  const fake = makeFakePayPal();
  const shop = await startPayPalShop(fake);
  try {
    await createHoodieOrder(shop);
    const res = await post(`${shop.base}/api/paypal/orders/PP-ORDER-1/capture`, {});
    assert.equal(res.status, 200);
    const captureCall = fake.callsTo("/capture", "POST")[0];
    // Regression for real sandbox 415 UNSUPPORTED_MEDIA_TYPE (debug id
    // ca56775236e7a): omitting the body sends no Content-Type at all.
    assert.equal(captureCall.request.headers.get("content-type"), "application/json");
    assert.equal(captureCall.bodyText, "{}");
    assert.deepEqual(captureCall.json, {});
  } finally {
    await shop.close();
  }
});

test("two captures fired at once fulfil exactly once", async () => {
  const fake = makeFakePayPal();
  const shop = await startPayPalShop(fake);
  try {
    await createHoodieOrder(shop);
    const [a, b] = await Promise.all([
      post(`${shop.base}/api/paypal/orders/PP-ORDER-1/capture`, {}),
      post(`${shop.base}/api/paypal/orders/PP-ORDER-1/capture`, {}),
    ]);
    assert.ok([a.status, b.status].every((s) => s === 200 || s === 202));
    const order = shop.db.getOrderByPayPalId("PP-ORDER-1");
    assert.equal(order.status, "fulfilled");
    assert.equal(shop.db.shipmentsFor(order.id).length, 1);
  } finally {
    await shop.close();
  }
});

test("a connection failure on create re-issues with the same PayPal-Request-Id", async () => {
  const fake = makeFakePayPal();
  const shop = await startPayPalShop(fake);
  try {
    let attempts = 0;
    fake.state.createHandler = (call) => {
      attempts += 1;
      if (attempts === 1) throw new Error("socket hang up");
      fake.state.created = call.json;
      const pu = call.json.purchase_units[0];
      return jsonRes(201, { id: "PP-ORDER-1", status: "CREATED", purchase_units: [{ custom_id: pu.custom_id, amount: pu.amount }] });
    };
    const data = await createHoodieOrder(shop);
    assert.equal(data.id, "PP-ORDER-1");
    const creates = fake.callsTo("/v2/checkout/orders", "POST");
    assert.equal(creates.length, 2);
    assert.equal(creates[0].request.headers.get("paypal-request-id"), creates[1].request.headers.get("paypal-request-id"));
    assert.equal(creates[0].request.headers.get("paypal-request-id"), data.orderId);
  } finally {
    await shop.close();
  }
});

test("capture for an unbound PayPal order is rejected before any capture call", async () => {
  const fake = makeFakePayPal();
  const shop = await startPayPalShop(fake);
  try {
    const res = await post(`${shop.base}/api/paypal/orders/PP-UNKNOWN/capture`, {});
    assert.equal(res.status, 404);
    assert.equal(fake.callsTo("/capture").length, 0);
  } finally {
    await shop.close();
  }
});

test("INSTRUMENT_DECLINED returns PayPal's reason, stays unpaid, and the buyer can retry", async () => {
  const fake = makeFakePayPal();
  const shop = await startPayPalShop(fake);
  try {
    const data = await createHoodieOrder(shop);
    fake.state.captureHandler = () => jsonRes(422, paypalErrorBody("INSTRUMENT_DECLINED", "The instrument presented was declined"));
    const res = await post(`${shop.base}/api/paypal/orders/PP-ORDER-1/capture`, {});
    assert.equal(res.status, 422);
    const body = await res.json();
    assert.match(body.error, /declined/);
    assert.match(body.error, /another way to pay/);
    assert.equal(shop.db.getOrder(data.orderId).status, "pending");
    assert.equal(shop.db.shipmentsFor(data.orderId).length, 0);

    fake.state.captureHandler = null;
    const retry = await post(`${shop.base}/api/paypal/orders/PP-ORDER-1/capture`, {});
    assert.equal(retry.status, 200);
    assert.equal(shop.db.getOrder(data.orderId).status, "fulfilled");
    assert.equal(shop.db.shipmentsFor(data.orderId).length, 1);
  } finally {
    await shop.close();
  }
});

test("a 4xx other than credential errors keeps its status and PayPal's reason", async () => {
  const fake = makeFakePayPal();
  const shop = await startPayPalShop(fake);
  try {
    const data = await createHoodieOrder(shop);
    fake.state.captureHandler = () => jsonRes(422, paypalErrorBody("ORDER_NOT_APPROVED", "Order must be approved before capture"));
    const res = await post(`${shop.base}/api/paypal/orders/PP-ORDER-1/capture`, {});
    assert.equal(res.status, 422);
    assert.match((await res.json()).error, /approved before capture/);
    assert.equal(shop.db.getOrder(data.orderId).status, "pending");
    assert.equal(shop.db.shipmentsFor(data.orderId).length, 0);
  } finally {
    await shop.close();
  }
});

test("ORDER_ALREADY_CAPTURED settles from a getOrder re-read", async () => {
  const fake = makeFakePayPal();
  const shop = await startPayPalShop(fake);
  try {
    const data = await createHoodieOrder(shop);
    fake.state.captureHandler = () => jsonRes(422, paypalErrorBody("ORDER_ALREADY_CAPTURED", "Order already captured"));
    const res = await post(`${shop.base}/api/paypal/orders/PP-ORDER-1/capture`, {});
    assert.equal(res.status, 200);
    assert.equal(shop.db.getOrder(data.orderId).status, "fulfilled");
    assert.equal(fake.callsTo("/v2/checkout/orders/PP-ORDER-1", "GET").length, 1);
    assert.equal(shop.db.shipmentsFor(data.orderId).length, 1);
  } finally {
    await shop.close();
  }
});

test("a connection failure on capture re-reads the order and settles from PayPal", async () => {
  const fake = makeFakePayPal();
  const shop = await startPayPalShop(fake);
  try {
    const data = await createHoodieOrder(shop);
    fake.state.captureHandler = () => { throw new Error("socket hang up"); };
    const res = await post(`${shop.base}/api/paypal/orders/PP-ORDER-1/capture`, {});
    assert.equal(res.status, 200);
    assert.equal(fake.callsTo("/v2/checkout/orders/PP-ORDER-1", "GET").length, 1);
    assert.equal(shop.db.getOrder(data.orderId).status, "fulfilled");
    assert.equal(shop.db.shipmentsFor(data.orderId).length, 1);
  } finally {
    await shop.close();
  }
});

test("a never-sent auth failure on capture makes no re-read", async () => {
  const fake = makeFakePayPal();
  fake.state.tokenHandler = () => jsonRes(401, { error: "invalid_client" });
  const paypal = createPayPalService({
    clientId: "test-client-id", clientSecret: "bad", webhookId: "WH-TEST-1",
    baseUrl: "https://api-m.sandbox.paypal.com", fetchImpl: fake.fetch,
  });
  await assert.rejects(
    () => paypal.captureOrder("PP-ORDER-1", "capture:PP-ORDER-1"),
    (err) => err instanceof PayPalServiceError && err.neverSent === true && err.httpStatus === 502,
  );
  assert.equal(fake.callsTo("/v2/checkout/orders/PP-ORDER-1", "GET").length, 0);
  assert.equal(fake.callsTo("/capture").length, 0);
});

test("a capture whose amount or custom_id does not match never fulfils", async () => {
  const fake = makeFakePayPal();
  const shop = await startPayPalShop(fake);
  try {
    const data = await createHoodieOrder(shop);
    fake.state.captureHandler = () => jsonRes(200, completedOrderWire(fake, { captureValue: "1.00" }));
    const res = await post(`${shop.base}/api/paypal/orders/PP-ORDER-1/capture`, {});
    assert.equal(res.status, 422);
    assert.equal(shop.db.getOrder(data.orderId).status, "pending");
    assert.equal(shop.db.shipmentsFor(data.orderId).length, 0);

    fake.state.captureHandler = () => jsonRes(200, completedOrderWire(fake, { captureCustomId: "FOG-OTHER" }));
    const res2 = await post(`${shop.base}/api/paypal/orders/PP-ORDER-1/capture`, {});
    assert.equal(res2.status, 422);
    assert.equal(shop.db.getOrder(data.orderId).status, "pending");
    assert.equal(shop.db.shipmentsFor(data.orderId).length, 0);
  } finally {
    await shop.close();
  }
});

test("a PENDING capture stays unpaid", async () => {
  const fake = makeFakePayPal();
  const shop = await startPayPalShop(fake);
  try {
    const data = await createHoodieOrder(shop);
    fake.state.captureHandler = () => jsonRes(200, completedOrderWire(fake, { captureStatus: "PENDING" }));
    const res = await post(`${shop.base}/api/paypal/orders/PP-ORDER-1/capture`, {});
    assert.equal(res.status, 202);
    assert.equal(shop.db.getOrder(data.orderId).status, "pending");
    assert.equal(shop.db.shipmentsFor(data.orderId).length, 0);
  } finally {
    await shop.close();
  }
});

test("browser config exposes only the client id, and testBuyerCountry only when set in sandbox", async () => {
  const fake = makeFakePayPal();
  const shop = await startPayPalShop(fake);
  const fake2 = makeFakePayPal();
  const shop2 = await startPayPalShop(fake2, { testBuyerCountry: "GB" });
  try {
    const res = await fetch(`${shop.base}/api/paypal/config`);
    const body = await res.json();
    assert.equal(body.clientId, "test-client-id");
    assert.equal(body.sdkUrl, "https://www.sandbox.paypal.com/web-sdk/v6/core");
    assert.equal("testBuyerCountry" in body, false);
    assert.equal(JSON.stringify(body).includes("test-secret-value"), false);

    const body2 = await (await fetch(`${shop2.base}/api/paypal/config`)).json();
    assert.equal(body2.testBuyerCountry, "GB");
  } finally {
    await shop.close();
    await shop2.close();
  }
});

test("a verified CHECKOUT.ORDER.APPROVED webhook never pays an order", async () => {
  const fake = makeFakePayPal();
  const shop = await startPayPalShop(fake);
  try {
    const data = await createHoodieOrder(shop);
    const event = { id: "EVT-APPROVED-1", event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: "PP-ORDER-1", status: "APPROVED" } };
    const res = await post(`${shop.base}/api/paypal/webhooks`, event, webhookHeaders());
    assert.equal(res.status, 200);
    assert.equal(shop.db.getOrder(data.orderId).status, "pending");
    assert.equal(shop.db.shipmentsFor(data.orderId).length, 0);

    const verifyCall = fake.callsTo("/v1/notifications/verify-webhook-signature")[0];
    assert.equal(verifyCall.json.webhook_id, "WH-TEST-1");
    assert.equal(verifyCall.json.transmission_id, "trans-1");
    assert.equal(verifyCall.json.auth_algo, "SHA256withRSA");
    assert.equal(verifyCall.json.webhook_event.id, "EVT-APPROVED-1");
    assert.equal(verifyCall.request.headers.get("authorization"), "Bearer test-token");
  } finally {
    await shop.close();
  }
});

test("a verified PAYMENT.CAPTURE.COMPLETED webhook fulfils once; replays and late events change nothing", async () => {
  const fake = makeFakePayPal();
  const shop = await startPayPalShop(fake);
  try {
    const data = await createHoodieOrder(shop);
    const event = {
      id: "EVT-CAPTURE-1",
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource: {
        id: "CAP-1",
        status: "COMPLETED",
        amount: { value: "49.00", currency_code: "USD" },
        custom_id: data.orderId,
        supplementary_data: { related_ids: { order_id: "PP-ORDER-1" } },
      },
    };
    const res = await post(`${shop.base}/api/paypal/webhooks`, event, webhookHeaders());
    assert.equal(res.status, 200);
    assert.equal(shop.db.getOrder(data.orderId).status, "fulfilled");
    assert.equal(shop.db.shipmentsFor(data.orderId).length, 1);

    const replay = await post(`${shop.base}/api/paypal/webhooks`, event, webhookHeaders());
    assert.equal(replay.status, 200);
    assert.equal(shop.db.shipmentsFor(data.orderId).length, 1);

    // Out-of-order old event after fulfilment: no backwards movement.
    const approved = { id: "EVT-LATE-APPROVED", event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: "PP-ORDER-1", status: "APPROVED" } };
    const late = await post(`${shop.base}/api/paypal/webhooks`, approved, webhookHeaders());
    assert.equal(late.status, 200);
    assert.equal(shop.db.getOrder(data.orderId).status, "fulfilled");
    assert.equal(shop.db.shipmentsFor(data.orderId).length, 1);
  } finally {
    await shop.close();
  }
});

test("an unverified webhook is rejected with 400 and changes nothing", async () => {
  const fake = makeFakePayPal();
  fake.state.verifyHandler = () => jsonRes(200, { verification_status: "FAILURE" });
  const shop = await startPayPalShop(fake);
  try {
    const data = await createHoodieOrder(shop);
    const event = {
      id: "EVT-FORGED-1",
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource: { id: "CAP-1", status: "COMPLETED", amount: { value: "49.00", currency_code: "USD" }, custom_id: data.orderId, supplementary_data: { related_ids: { order_id: "PP-ORDER-1" } } },
    };
    const res = await post(`${shop.base}/api/paypal/webhooks`, event, webhookHeaders());
    assert.equal(res.status, 400);
    assert.equal(shop.db.getOrder(data.orderId).status, "pending");
    assert.equal(shop.db.shipmentsFor(data.orderId).length, 0);
  } finally {
    await shop.close();
  }
});
