import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createShop } from "../server.js";
import { openStore } from "../lib/store.js";
import { priceLines } from "../lib/catalog.js";

test("the server prices the cart from its catalog and refuses bad carts", () => {
  assert.equal(priceLines([{ product: "KC-KETTLE", count: 1 }, { product: "KC-MUG", count: 2 }]).total_cents, 6400 + 3600);
  for (const bad of [[], [{ product: "KC-KETTLE", count: -1 }], [{ product: "KC-KETTLE", count: 0.5 }], [{ product: "KC-KETTLE", count: 11 }], [{ product: "FREE", count: 1 }], "x"]) assert.throws(() => priceLines(bad));
});

/** The shop with a scripted PayPal: what the shop asks for, and what PayPal answers. */
async function shopWith(paypal) {
  const store = openStore(null);
  const server = http.createServer(createShop({ store, paypal, staffToken: "staff" }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(`${base}/`);
  const cookie = page.headers.get("set-cookie").split(";")[0];
  const csrf = /name="csrf-token" content="([a-f0-9]+)"/.exec(await page.text())[1];
  const post = (p, body, extra = {}) => fetch(`${base}${p}`, { method: "POST", headers: { "content-type": "application/json", cookie, "x-csrf-token": csrf, ...extra }, body: JSON.stringify(body ?? {}) });
  return { store, base, post, close: () => server.close() };
}

const completed = (value, id = "CAP1") => ({ status: 201, body: { purchase_units: [{ payments: { captures: [{ id, status: "COMPLETED", amount: { currency_code: "USD", value } }] } }] } });
const paypalStub = (over = {}) => ({
  browserConfig: () => ({ clientId: "client", sdkUrl: "https://www.sandbox.paypal.com/web-sdk/v6/core" }),
  createOrder: async () => ({ status: 201, body: { id: "PAYPAL1" } }),
  captureOrder: async () => completed("64.00"),
  getOrder: async () => completed("64.00"),
  verifyWebhook: async () => true,
  ...over,
});

test("POSTs need the session's CSRF token", async () => {
  const s = await shopWith(paypalStub());
  try {
    const r = await s.post("/api/checkout/paypal", { lines: [{ product: "KC-KETTLE", count: 1 }] }, { "x-csrf-token": "wrong" });
    assert.equal(r.status, 403);
  } finally {
    s.close();
  }
});

test("an order ships once, only after PayPal captured exactly its amount; a double click captures once", async () => {
  let captures = 0;
  const s = await shopWith(paypalStub({ captureOrder: async () => (captures++, await new Promise((r) => setTimeout(r, 50)), completed("64.00")) }));
  try {
    const made = await (await s.post("/api/checkout/paypal", { lines: [{ product: "KC-KETTLE", count: 1 }], total: "0.01" })).json();
    assert.equal(s.store.byRef(made.ref).total_cents, 6400, "the browser's total is ignored");
    const [a, b] = await Promise.all([s.post("/api/checkout/paypal/PAYPAL1/capture"), s.post("/api/checkout/paypal/PAYPAL1/capture")]);
    assert.deepEqual([a.status, b.status], [200, 200]);
    assert.equal(captures, 1);
    assert.equal(s.store.byRef(made.ref).parcels, 1);
    assert.equal(s.store.byRef(made.ref).state, "shipped");
  } finally {
    s.close();
  }
});

test("a declined or mismatched capture never ships", async () => {
  const declined = await shopWith(paypalStub({ captureOrder: async () => ({ status: 422, body: { details: [{ issue: "INSTRUMENT_DECLINED" }] } }) }));
  try {
    const made = await (await declined.post("/api/checkout/paypal", { lines: [{ product: "KC-KETTLE", count: 1 }] })).json();
    assert.equal((await declined.post("/api/checkout/paypal/PAYPAL1/capture")).status, 402);
    assert.equal(declined.store.byRef(made.ref).parcels, 0);
  } finally {
    declined.close();
  }
  const cheap = await shopWith(paypalStub({ captureOrder: async () => completed("0.01") }));
  try {
    const made = await (await cheap.post("/api/checkout/paypal", { lines: [{ product: "KC-KETTLE", count: 1 }] })).json();
    assert.equal((await cheap.post("/api/checkout/paypal/PAYPAL1/capture")).status, 409);
    assert.equal(cheap.store.byRef(made.ref).parcels, 0);
  } finally {
    cheap.close();
  }
});

test("webhooks: unverified ones are refused, a completed capture is handled once, approval changes nothing", async () => {
  let genuine = true;
  const s = await shopWith(paypalStub({ verifyWebhook: async () => genuine }));
  try {
    const made = await (await s.post("/api/checkout/paypal", { lines: [{ product: "KC-KETTLE", count: 1 }] })).json();
    const hook = (event) => fetch(`${s.base}/hooks/paypal`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(event) });
    assert.equal((await hook({ id: "WH-APPROVED", event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: "PAYPAL1" } })).status, 200);
    assert.equal(s.store.byRef(made.ref).state, "awaiting_payment", "approval is not payment");
    const event = { id: "WH-1", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "CAP1", status: "COMPLETED", custom_id: made.ref, amount: { currency_code: "USD", value: "64.00" } } };
    genuine = false;
    assert.equal((await hook(event)).status, 400);
    assert.equal(s.store.byRef(made.ref).parcels, 0);
    genuine = true;
    for (let i = 0; i < 3; i++) assert.equal((await hook(event)).status, 200);
    assert.equal(s.store.byRef(made.ref).parcels, 1);
  } finally {
    s.close();
  }
});
