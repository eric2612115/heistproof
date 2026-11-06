import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server.js";
import { openDb } from "../lib/db.js";
import { createCardProcessor } from "../lib/card-processor.js";
import { createPayPalService, centsToPayPalAmount, payPalAmountToCents } from "../lib/paypal.js";

const jsonRes = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// A faked PayPal (no network): handles the SDK's token + Orders calls and the
// raw verify-webhook-signature call, in wire shape, and records every request.
function fakePayPal(hooks = {}) {
  const calls = [];
  const state = {
    createdBody: null,
    captureValue: null, // override captured amount
    createBehavior: "ok", // ok | throw
    captureBehavior: "completed", // completed | pending | declined | throw
    getBehavior: "approved", // approved | completed
    verify: "SUCCESS",
    tokenFails: false,
    claimSeenAtCreate: null,
  };
  const fetchImpl = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const bodyText = request.body === null ? "" : await request.clone().text();
    calls.push({ method: request.method, pathname: url.pathname, bodyText, headers: request.headers });
    const shopId = state.createdBody?.purchase_units?.[0]?.custom_id ?? "FOG-UNKNOWN";
    const totalValue = state.createdBody?.purchase_units?.[0]?.amount?.value ?? "0.00";

    if (url.pathname === "/v1/oauth2/token") {
      if (state.tokenFails) return jsonRes(401, { error: "invalid_client", error_description: "bad credentials" });
      return jsonRes(200, { access_token: "TEST-TOKEN", token_type: "Bearer", expires_in: 3600 });
    }
    if (url.pathname === "/v1/notifications/verify-webhook-signature") {
      return jsonRes(200, { verification_status: state.verify });
    }
    if (url.pathname === "/v2/checkout/orders" && request.method === "POST") {
      if (state.createBehavior === "throw") throw new Error("socket hang up");
      state.createdBody = JSON.parse(bodyText);
      if (hooks.onCreate) state.claimSeenAtCreate = hooks.onCreate();
      const pu = state.createdBody.purchase_units[0];
      return jsonRes(201, { id: "PP-ORDER-1", status: "CREATED", purchase_units: [pu] });
    }
    if (/^\/v2\/checkout\/orders\/[^/]+\/capture$/.test(url.pathname)) {
      if (state.captureBehavior === "throw") throw new Error("socket hang up");
      if (state.captureBehavior === "declined") {
        return jsonRes(422, {
          name: "UNPROCESSABLE_ENTITY",
          message: "The requested action could not be performed.",
          debug_id: "dbg-1",
          details: [{ issue: "INSTRUMENT_DECLINED", description: "The instrument presented was declined." }],
        });
      }
      const captureStatus = state.captureBehavior === "pending" ? "PENDING" : "COMPLETED";
      return jsonRes(200, completedOrder({ shopId, value: state.captureValue ?? totalValue, captureStatus }));
    }
    if (/^\/v2\/checkout\/orders\/[^/]+$/.test(url.pathname) && request.method === "GET") {
      if (state.getBehavior === "completed") return jsonRes(200, completedOrder({ shopId, value: totalValue, captureStatus: "COMPLETED" }));
      return jsonRes(200, { id: "PP-ORDER-1", status: "APPROVED", purchase_units: [{ reference_id: shopId, custom_id: shopId, amount: { currency_code: "USD", value: totalValue } }] });
    }
    return jsonRes(404, { name: "RESOURCE_NOT_FOUND", message: "not here", debug_id: "dbg-404" });
  };
  return { fetchImpl, calls, state };
}

function completedOrder({ shopId, value, captureStatus }) {
  return {
    id: "PP-ORDER-1",
    status: "COMPLETED",
    purchase_units: [
      {
        reference_id: shopId,
        custom_id: shopId,
        amount: { currency_code: "USD", value },
        payments: { captures: [{ id: "CAP-1", status: captureStatus, amount: { currency_code: "USD", value }, custom_id: shopId }] },
      },
    ],
  };
}

async function startShop(fake, hooksDb) {
  const db = openDb(":memory:");
  if (hooksDb) hooksDb(db);
  const paypal = createPayPalService({
    clientId: "client-id",
    clientSecret: "client-secret",
    baseUrl: "https://api-m.sandbox.paypal.com",
    webhookId: "WH-1",
    fetchImpl: fake.fetchImpl,
  });
  const app = createApp({ db, cards: createCardProcessor({ apiKey: "test" }), adminKey: "k", paypal });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  return { db, base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

const post = (url, body, headers = {}) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

async function createPayPalOrder(shop, items = [{ sku: "FOG-HOODIE", qty: 1 }]) {
  const res = await post(`${shop.base}/api/paypal/orders`, { items, price: 1, amount: "0.01", total: 1, currency: "EUR" });
  assert.equal(res.status, 200);
  return res.json();
}

const webhookHeaders = {
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-cert-url": "https://api.sandbox.paypal.com/certs/cert-1.pem",
  "paypal-transmission-id": "trans-1",
  "paypal-transmission-sig": "sig",
  "paypal-transmission-time": "2026-01-01T00:00:00Z",
};

function captureCompletedEvent(id, shopOrderId) {
  return {
    id,
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: {
      id: "CAP-1",
      custom_id: shopOrderId,
      amount: { value: "49.00", currency_code: "USD" },
      supplementary_data: { related_ids: { order_id: "PP-ORDER-1" } },
    },
  };
}

test("converts cents to PayPal decimal strings exactly", () => {
  assert.equal(centsToPayPalAmount(4900), "49.00");
  assert.equal(centsToPayPalAmount(5), "0.05");
  assert.equal(centsToPayPalAmount(0), "0.00");
  assert.equal(centsToPayPalAmount(100001), "1000.01");
  assert.equal(payPalAmountToCents("49.00"), 4900);
  assert.equal(payPalAmountToCents("49"), null);
  assert.equal(payPalAmountToCents("49.0"), null);
});

test("config exposes only the client id, and the test buyer country only when set", async () => {
  const fake = fakePayPal();
  const shop = await startShop(fake);
  try {
    const cfg = await (await fetch(`${shop.base}/api/paypal/config`)).json();
    assert.equal(cfg.clientId, "client-id");
    assert.ok(!("clientSecret" in cfg) && !JSON.stringify(cfg).includes("client-secret"));
    assert.ok(!("testBuyerCountry" in cfg));
    assert.match(cfg.sdkUrl, /sandbox\.paypal\.com\/web-sdk\/v6\/core/);
  } finally {
    await shop.close();
  }
});

test("create prices from the catalog, ignores browser amounts, binds custom_id, claims before the call", async () => {
  let dbRef;
  const fake = fakePayPal({ onCreate: () => Boolean(dbRef.getClaim(`create:${lastOrderId(dbRef)}`)) });
  function lastOrderId(db) {
    return db.listOrders()[0]?.id;
  }
  const shop = await startShop(fake, (db) => (dbRef = db));
  try {
    const { id, orderId } = await createPayPalOrder(shop);
    assert.equal(id, "PP-ORDER-1");
    const sent = fake.state.createdBody;
    assert.equal(sent.intent, "CAPTURE");
    const pu = sent.purchase_units[0];
    assert.equal(pu.amount.value, "49.00"); // catalog price, not the browser's 0.01
    assert.equal(pu.amount.currency_code, "USD");
    assert.equal(pu.custom_id, orderId);
    assert.equal(pu.invoice_id, orderId);
    // Item breakdown sums to the total.
    const itemSum = pu.items.reduce((s, i) => s + payPalAmountToCents(i.unit_amount.value) * Number(i.quantity), 0);
    assert.equal(itemSum, 4900);
    assert.equal(pu.amount.breakdown.item_total.value, "49.00");
    // The durable claim existed when the create request left.
    assert.equal(fake.state.claimSeenAtCreate, true);
    // Every PayPal call went to the configured base via the SDK: token first.
    assert.equal(fake.calls[0].pathname, "/v1/oauth2/token");
    const createCall = fake.calls.find((c) => c.pathname === "/v2/checkout/orders");
    assert.equal(createCall.headers.get("paypal-request-id"), orderId);
    assert.equal(createCall.headers.get("prefer"), "return=representation");
    // No invented SDK-sent surface beyond the claim reference + prefer + SDK defaults.
    assert.equal(createCall.headers.get("paypal-mock-response"), null);
    const order = shop.db.getOrder(orderId);
    assert.equal(order.paypal_order_id, "PP-ORDER-1");
    assert.equal(order.status, "pending");
  } finally {
    await shop.close();
  }
});

test("a dropped create connection is unknown: order stays pending and the claim is kept", async () => {
  const fake = fakePayPal();
  fake.state.createBehavior = "throw";
  const shop = await startShop(fake);
  try {
    const res = await post(`${shop.base}/api/paypal/orders`, { items: [{ sku: "FOG-HOODIE", qty: 1 }] });
    assert.equal(res.status, 502);
    const order = shop.db.listOrders()[0];
    assert.equal(order.status, "pending"); // never marked failed
    assert.ok(shop.db.getClaim(`create:${order.id}`)); // claim kept for settlement
  } finally {
    await shop.close();
  }
});

test("capture with a COMPLETED capture for the right amount fulfils once; a repeat capture is safe", async () => {
  const fake = fakePayPal();
  const shop = await startShop(fake);
  try {
    const { orderId } = await createPayPalOrder(shop);
    const res = await post(`${shop.base}/api/paypal/orders/PP-ORDER-1/capture`, {});
    assert.equal(res.status, 200);
    assert.equal(shop.db.getOrder(orderId).status, "fulfilled");
    assert.equal(shop.db.getOrder(orderId).paid_cents, 4900);
    assert.equal(shop.db.shipmentsFor(orderId).length, 1);

    const again = await post(`${shop.base}/api/paypal/orders/PP-ORDER-1/capture`, {});
    assert.equal(again.status, 200);
    assert.equal(shop.db.shipmentsFor(orderId).length, 1);
    assert.equal(fake.calls.filter((c) => c.pathname.endsWith("/capture")).length, 1);
  } finally {
    await shop.close();
  }
});

test("two simultaneous captures still ship exactly once", async () => {
  const fake = fakePayPal();
  const shop = await startShop(fake);
  try {
    const { orderId } = await createPayPalOrder(shop);
    await Promise.all([
      post(`${shop.base}/api/paypal/orders/PP-ORDER-1/capture`, {}),
      post(`${shop.base}/api/paypal/orders/PP-ORDER-1/capture`, {}),
    ]);
    assert.equal(shop.db.getOrder(orderId).status, "fulfilled");
    assert.equal(shop.db.shipmentsFor(orderId).length, 1);
  } finally {
    await shop.close();
  }
});

test("capture for a PayPal order we never created is 404 and never reaches PayPal's capture", async () => {
  const fake = fakePayPal();
  const shop = await startShop(fake);
  try {
    const res = await post(`${shop.base}/api/paypal/orders/PP-FOREIGN/capture`, {});
    assert.equal(res.status, 404);
    assert.equal(fake.calls.filter((c) => c.pathname.endsWith("/capture")).length, 0);
  } finally {
    await shop.close();
  }
});

test("a capture for the wrong amount never fulfils", async () => {
  const fake = fakePayPal();
  fake.state.captureValue = "1.00"; // cheap capture presented for the hoodie bag
  const shop = await startShop(fake);
  try {
    const { orderId } = await createPayPalOrder(shop);
    const res = await post(`${shop.base}/api/paypal/orders/PP-ORDER-1/capture`, {});
    assert.equal(res.status, 422);
    assert.equal(shop.db.getOrder(orderId).status, "pending");
    assert.equal(shop.db.shipmentsFor(orderId).length, 0);
  } finally {
    await shop.close();
  }
});

test("INSTRUMENT_DECLINED stays unpaid, carries PayPal's reason path, and can be retried", async () => {
  const fake = fakePayPal();
  fake.state.captureBehavior = "declined";
  const shop = await startShop(fake);
  try {
    const { orderId } = await createPayPalOrder(shop);
    const res = await post(`${shop.base}/api/paypal/orders/PP-ORDER-1/capture`, {});
    assert.equal(res.status, 402);
    const data = await res.json();
    assert.equal(data.code, "INSTRUMENT_DECLINED");
    assert.match(data.error, /another way to pay/);
    assert.equal(shop.db.getOrder(orderId).status, "pending");
    assert.equal(shop.db.shipmentsFor(orderId).length, 0);
    // Claim was released: a later attempt can capture.
    fake.state.captureBehavior = "completed";
    const retry = await post(`${shop.base}/api/paypal/orders/PP-ORDER-1/capture`, {});
    assert.equal(retry.status, 200);
    assert.equal(shop.db.shipmentsFor(orderId).length, 1);
  } finally {
    await shop.close();
  }
});

test("a PENDING capture stays unpaid", async () => {
  const fake = fakePayPal();
  fake.state.captureBehavior = "pending";
  const shop = await startShop(fake);
  try {
    const { orderId } = await createPayPalOrder(shop);
    const res = await post(`${shop.base}/api/paypal/orders/PP-ORDER-1/capture`, {});
    assert.equal(res.status, 202);
    assert.equal(shop.db.getOrder(orderId).status, "pending");
    assert.equal(shop.db.shipmentsFor(orderId).length, 0);
  } finally {
    await shop.close();
  }
});

test("a dropped capture connection is settled by re-reading the order, never reported failed", async () => {
  const fake = fakePayPal();
  fake.state.captureBehavior = "throw";
  fake.state.getBehavior = "completed";
  const shop = await startShop(fake);
  try {
    const { orderId } = await createPayPalOrder(shop);
    const res = await post(`${shop.base}/api/paypal/orders/PP-ORDER-1/capture`, {});
    assert.equal(res.status, 200);
    assert.equal(shop.db.getOrder(orderId).status, "fulfilled");
    assert.equal(shop.db.shipmentsFor(orderId).length, 1);
    // The re-read actually happened.
    assert.ok(fake.calls.some((c) => c.method === "GET" && c.pathname === "/v2/checkout/orders/PP-ORDER-1"));
  } finally {
    await shop.close();
  }
});

test("a dropped capture with nothing captured is unknown, not failed", async () => {
  const fake = fakePayPal();
  fake.state.captureBehavior = "throw";
  fake.state.getBehavior = "approved";
  const shop = await startShop(fake);
  try {
    const { orderId } = await createPayPalOrder(shop);
    const res = await post(`${shop.base}/api/paypal/orders/PP-ORDER-1/capture`, {});
    assert.equal(res.status, 422); // re-read shows no capture: not paid, not fulfilled
    assert.equal(shop.db.getOrder(orderId).status, "pending");
    assert.equal(shop.db.shipmentsFor(orderId).length, 0);
  } finally {
    await shop.close();
  }
});

test("bad credentials (token refused) are a 502 and trigger no re-read", async () => {
  const fake = fakePayPal();
  const shop = await startShop(fake);
  try {
    const { orderId } = await createPayPalOrder(shop);
    fake.state.tokenFails = true;
    // Fresh service whose token cache is empty, pointed at the same shop.
    const badPaypal = createPayPalService({
      clientId: "client-id",
      clientSecret: "wrong",
      baseUrl: "https://api-m.sandbox.paypal.com",
      webhookId: "WH-1",
      fetchImpl: fake.fetchImpl,
    });
    const before = fake.calls.filter((c) => c.method === "GET").length;
    await assert.rejects(() => badPaypal.captureOrder({ paypalOrderId: "PP-ORDER-1", payPalRequestId: orderId }), (err) => err.httpStatus === 502);
    assert.equal(fake.calls.filter((c) => c.method === "GET").length, before);
  } finally {
    await shop.close();
  }
});

test("a forged webhook changes nothing; a verified APPROVED event never fulfils", async () => {
  const fake = fakePayPal();
  const shop = await startShop(fake);
  try {
    const { orderId } = await createPayPalOrder(shop);
    fake.state.verify = "FAILURE";
    const forged = await post(`${shop.base}/api/paypal/webhooks`, captureCompletedEvent("EVT-FORGED", orderId), webhookHeaders);
    assert.equal(forged.status, 400);
    assert.equal(shop.db.getOrder(orderId).status, "pending");

    fake.state.verify = "SUCCESS";
    const approved = await post(
      `${shop.base}/api/paypal/webhooks`,
      { id: "EVT-APPROVED", event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: "PP-ORDER-1", status: "APPROVED" } },
      webhookHeaders,
    );
    assert.equal(approved.status, 200);
    assert.equal(shop.db.getOrder(orderId).status, "pending");
    assert.equal(shop.db.shipmentsFor(orderId).length, 0);
  } finally {
    await shop.close();
  }
});

test("a verified CAPTURE.COMPLETED webhook fulfils via re-read, exactly once, replay-safe and order-safe", async () => {
  const fake = fakePayPal();
  fake.state.getBehavior = "completed";
  const shop = await startShop(fake);
  try {
    const { orderId } = await createPayPalOrder(shop);
    const event = captureCompletedEvent("EVT-1", orderId);
    const res = await post(`${shop.base}/api/paypal/webhooks`, event, webhookHeaders);
    assert.equal(res.status, 200);
    assert.equal(shop.db.getOrder(orderId).status, "fulfilled");
    assert.equal(shop.db.shipmentsFor(orderId).length, 1);
    // The webhook was verified against the configured base with our webhook id.
    const verifyCall = fake.calls.find((c) => c.pathname === "/v1/notifications/verify-webhook-signature");
    assert.ok(verifyCall);
    assert.equal(JSON.parse(verifyCall.bodyText).webhook_id, "WH-1");
    assert.equal(JSON.parse(verifyCall.bodyText).transmission_id, "trans-1");

    // Replay: 200, nothing changes.
    const replay = await post(`${shop.base}/api/paypal/webhooks`, event, webhookHeaders);
    assert.equal(replay.status, 200);
    assert.equal(shop.db.shipmentsFor(orderId).length, 1);

    // An out-of-order APPROVED after fulfilment moves nothing backwards.
    const late = await post(
      `${shop.base}/api/paypal/webhooks`,
      { id: "EVT-LATE", event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: "PP-ORDER-1", status: "APPROVED" } },
      webhookHeaders,
    );
    assert.equal(late.status, 200);
    assert.equal(shop.db.getOrder(orderId).status, "fulfilled");
    assert.equal(shop.db.shipmentsFor(orderId).length, 1);
  } finally {
    await shop.close();
  }
});

test("webhook verify failure after an edited body answers 400", async () => {
  const fake = fakePayPal();
  fake.state.verify = "FAILURE";
  const shop = await startShop(fake);
  try {
    const { orderId } = await createPayPalOrder(shop);
    const edited = captureCompletedEvent("EVT-EDITED", orderId);
    edited.resource.amount.value = "0.01";
    const res = await post(`${shop.base}/api/paypal/webhooks`, edited, webhookHeaders);
    assert.equal(res.status, 400);
    assert.equal(shop.db.getOrder(orderId).status, "pending");
    assert.equal(shop.db.hasWebhookEvent("EVT-EDITED"), false);
  } finally {
    await shop.close();
  }
});
