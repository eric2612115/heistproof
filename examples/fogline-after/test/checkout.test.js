import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server.js";
import { openDb } from "../lib/db.js";
import { createCardProcessor } from "../lib/card-processor.js";
import { priceCart } from "../lib/cart.js";

async function startShop() {
  const db = openDb(":memory:");
  const app = createApp({ db, cards: createCardProcessor({ apiKey: "test" }), adminKey: "k" });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { db, base, close: () => new Promise((r) => server.close(r)) };
}

const post = (url, body) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("prices the bag from the catalog, in cents", () => {
  const cart = priceCart([{ sku: "FOG-HOODIE", qty: 2 }, { sku: "FOGHORN-STICKER", qty: 1 }]);
  assert.equal(cart.totalCents, 2 * 4900 + 300);
});

test("rejects unknown products and bad quantities", () => {
  assert.throws(() => priceCart([{ sku: "NOPE", qty: 1 }]), /Unknown product/);
  assert.throws(() => priceCart([{ sku: "FOG-HOODIE", qty: 0 }]), /Bad quantity/);
  assert.throws(() => priceCart([{ sku: "FOG-HOODIE", qty: 1.5 }]), /Bad quantity/);
  assert.throws(() => priceCart([]), /empty/);
});

test("card checkout charges the server total and ships once", async () => {
  const shop = await startShop();
  try {
    const res = await post(`${shop.base}/api/checkout/card`, {
      items: [{ sku: "FOG-HOODIE", qty: 1, price: 1 }],
      email: "buyer@example.com",
      card: { number: "4000 0000 0000 0077", exp: "12/30", cvc: "123" },
    });
    assert.equal(res.status, 200);
    const { orderId } = await res.json();
    const order = shop.db.getOrder(orderId);
    assert.equal(order.status, "fulfilled");
    assert.equal(order.paid_cents, 4900);
    assert.equal(shop.db.shipmentsFor(orderId).length, 1);
  } finally {
    await shop.close();
  }
});

test("a declined card leaves the order unpaid and unshipped", async () => {
  const shop = await startShop();
  try {
    const res = await post(`${shop.base}/api/checkout/card`, {
      items: [{ sku: "HARBOR-BEANIE", qty: 1 }],
      card: { number: "4000 0000 0000 0002", exp: "12/30", cvc: "123" },
    });
    assert.equal(res.status, 402);
    const { orderId } = await res.json();
    assert.equal(shop.db.getOrder(orderId).status, "failed");
    assert.equal(shop.db.shipmentsFor(orderId).length, 0);
  } finally {
    await shop.close();
  }
});

test("admin API needs the admin key", async () => {
  const shop = await startShop();
  try {
    assert.equal((await fetch(`${shop.base}/api/admin/orders`)).status, 401);
    assert.equal((await fetch(`${shop.base}/api/admin/orders`, { headers: { "x-admin-key": "k" } })).status, 200);
  } finally {
    await shop.close();
  }
});
