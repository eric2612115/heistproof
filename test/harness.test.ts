import { test } from "node:test";
import assert from "node:assert/strict";
import { learnRoutes } from "../src/attacks.ts";
import { registerSecret, redact } from "../src/secrets.ts";
import { renderReport } from "../src/report.ts";
import type { PurchaseResult } from "../src/prove.ts";

const purchase = (over: Partial<PurchaseResult> = {}): PurchaseResult => ({
  ok: true,
  method: "paypal",
  verdict: "Paid $49.00",
  bagTotal: "49.00",
  paypalOrderId: "5O190127TN364715T",
  paypalAmount: { value: "49.00", currency: "USD" },
  captureId: "3C679366HH908993F",
  captureStatus: "COMPLETED",
  environment: null,
  paypalStatus: "COMPLETED",
  approved: true,
  captureBlocked: false,
  shopOrder: { id: "FOG-ABC123", status: "fulfilled", paid: true, shipments: 1, payment_reference: "3C679366HH908993F" },
  calls: [
    { method: "POST", path: "/api/paypal/orders", body: { items: [{ sku: "FOG-HOODIE", qty: 1 }] }, status: 201, response: { id: "5O190127TN364715T" } },
    { method: "POST", path: "/api/paypal/orders/5O190127TN364715T/capture", body: {}, status: 200, response: { status: "fulfilled" } },
  ],
  screenshots: [],
  consoleErrors: [],
  buttons: { paypal: true, venmo: true, paylater: true },
  payLaterMessage: "Pay in 4 interest-free payments of $12.25.",
  ...over,
});

test("learns the create and capture routes by watching the real purchase", () => {
  const { create, capture } = learnRoutes(purchase());
  assert.equal(create?.path, "/api/paypal/orders");
  assert.equal(capture?.path, "/api/paypal/orders/5O190127TN364715T/capture");
});

test("finds a capture route that carries the order id in the body", () => {
  const p = purchase({
    calls: [
      { method: "POST", path: "/checkout/paypal/create", body: { cart: [] }, status: 200, response: { orderID: "5O190127TN364715T" } },
      { method: "POST", path: "/checkout/paypal/capture", body: { orderID: "5O190127TN364715T" }, status: 200, response: {} },
    ],
  });
  assert.equal(learnRoutes(p).capture?.path, "/checkout/paypal/capture");
});

test("redacts registered secrets everywhere", () => {
  registerSecret("EFAKE-secret-value-123456");
  assert.equal(redact('{"auth":"EFAKE-secret-value-123456"}'), '{"auth":"[redacted]"}');
});

test("the report says do not ship when any attack robbed the shop", () => {
  const md = renderReport({
    shopDir: "/tmp/shop",
    rounds: [{ round: 0, tests: true, prove: purchase(), webhookVerified: true, attacks: [{ id: "price-tamper", title: "Price tampering", what: "Pay $0.01 for the $49 hoodie", rule: [1], verdict: "robbed", summary: "USD 0.01", evidence: {} }] }],
  });
  assert.match(md, /do not ship/);
  assert.match(md, /ROBBED/);
  assert.match(md, /5O190127TN364715T/);
});
