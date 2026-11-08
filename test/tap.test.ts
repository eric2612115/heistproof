// The webhook tap counts a delivery as PayPal's only when PayPal itself verifies it: PayPal's header names alone can be
// copied by anyone who reaches the public tunnel.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { WebhookTap } from "../src/webhooks/tap.ts";

const HEADERS = { "paypal-auth-algo": "SHA256withRSA", "paypal-cert-url": "https://api.sandbox.paypal.com/cert", "paypal-transmission-id": "t1", "paypal-transmission-sig": "sig", "paypal-transmission-time": "2026-11-08T00:00:00Z" };
const event = (id: string) => JSON.stringify({ id, event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: `CAP${id}` } });

test("only deliveries PayPal verifies count as PayPal's, and only they wake a waiter", async () => {
  const shop = http.createServer((_req, res) => res.end("ok"));
  await new Promise<void>((r) => shop.listen(0, "127.0.0.1", r));
  const tap = new WebhookTap(`http://127.0.0.1:${(shop.address() as any).port}/hooks`);
  tap.verifier = async (_h, raw) => JSON.parse(raw).id === "WH-REAL";
  try {
    const waiting = tap.waitFor((d) => d.eventType === "PAYMENT.CAPTURE.COMPLETED", 2000);
    await tap.forward("paypal", HEADERS, event("WH-FAKE"));
    await tap.forward("paypal", HEADERS, event("WH-REAL"));
    assert.equal((await waiting)?.eventId, "WH-REAL", "the copied headers did not wake the waiter");
    assert.deepEqual(tap.genuine().map((d) => d.eventId), ["WH-REAL"]);
  } finally {
    shop.close();
  }
});

test("when PayPal has not delivered an event, the tap asks PayPal to resend it, then waits again", async () => {
  const shop = http.createServer((_req, res) => res.end("ok"));
  await new Promise<void>((r) => shop.listen(0, "127.0.0.1", r));
  const tap = new WebhookTap(`http://127.0.0.1:${(shop.address() as any).port}/hooks`);
  tap.verifier = async () => true;
  const asked: Array<[string, string[]]> = [];
  tap.resender = async (type, ids) => {
    asked.push([type, ids]);
    setTimeout(() => void tap.forward("paypal", HEADERS, event("WH-LATE")), 50);
    return ["WH-LATE"];
  };
  try {
    const got = await tap.waitOrAsk((d) => d.eventId === "WH-LATE", "PAYMENT.CAPTURE.COMPLETED", ["CAPWH-LATE", null], 400);
    assert.equal(got?.eventId, "WH-LATE");
    assert.deepEqual(asked, [["PAYMENT.CAPTURE.COMPLETED", ["CAPWH-LATE"]]]);
    assert.equal(tap.resends.length, 1);
  } finally {
    shop.close();
  }
});
