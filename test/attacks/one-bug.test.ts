// Each robbery must catch its own kind of mistake. Copper Kettle (shops/copper-kettle) blocks all ten; here each of ten
// copies gets exactly one well-known checkout mistake, and the robbery for that mistake must succeed against it.
// Offline (PayPal's local stand-in): no account, no keys, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkOffline } from "../../src/offline-check.ts";

const FIXTURES = path.join(import.meta.dirname, "..", "fixtures");

const SHOP = path.join(import.meta.dirname, "..", "..", "shops", "copper-kettle");
type Patch = { file: string; from: string; to: string };

/** One mistake per robbery, as a few exact edits of the careful shop's code. */
const BUGS: Record<string, { mistake: string; patches: Patch[] }> = {
  "price-tamper": {
    mistake: "uses a unit price sent by the browser",
    patches: [{ file: "server.js", from: "priced = priceLines(body.lines);", to: "priced = priceLines(body.lines);\n            if (body.lines?.[0]?.price_cents) { priced.lines[0].unit_cents = body.lines[0].price_cents; priced.total_cents = priced.lines.reduce((n, l) => n + l.count * l.unit_cents, 0); }" }],
  },
  "bad-bag": {
    mistake: "accepts any quantity",
    patches: [
      { file: "lib/catalog.js", from: "count < 1 || count > MAX_COUNT", to: "count === 0" },
      { file: "lib/catalog.js", from: "    if (count > MAX_COUNT) throw new Error(`You can buy 1 to ${MAX_COUNT} of each product.`);\n", to: "" },
    ],
  },
  "capture-unapproved": {
    mistake: "treats a refused capture as paid",
    patches: [{ file: "server.js", from: "    if (!found) {\n", to: "    if (!found) found = { id: `UNCONFIRMED-${r.debugId}`, status: \"COMPLETED\", amount: { currency_code: \"USD\", value: dollars(order.total_cents) } };\n    if (!found) {\n" }],
  },
  "approved-not-captured": {
    mistake: "ships when PayPal says the buyer approved",
    patches: [{ file: "server.js", from: "        // CHECKOUT.ORDER.APPROVED and the rest change nothing: approval is not payment.\n", to: "        if (event.event_type === \"CHECKOUT.ORDER.APPROVED\") {\n          const o = store.byPayPal(event.resource?.id);\n          if (o && o.state === \"awaiting_payment\") { o.state = \"shipped\"; o.parcels = 1; store.save(); }\n        }\n" }],
  },
  "declined-capture": {
    mistake: "ships a declined payment",
    patches: [{ file: "server.js", from: "      return { status: 402, body: { error: \"PayPal declined that payment. Please choose another way to pay.\", retry: true } };", to: "      return settle(order, { id: `DECLINED-${r.debugId}`, status: \"COMPLETED\", amount: { currency_code: \"USD\", value: dollars(order.total_cents) } });" }],
  },
  "forged-webhook": {
    mistake: "never checks webhook signatures",
    patches: [{ file: "server.js", from: "if (!(await paypal.verifyWebhook(req.headers, event)))", to: "if (false)" }],
  },
  "webhook-replay": {
    mistake: "books a parcel for every delivery of a completed-capture event",
    patches: [
      { file: "server.js", from: "        if (store.seen(event.id)) return send(res, 200, { duplicate: true });\n", to: "" },
      { file: "server.js", from: "          if (order && (order.state === \"awaiting_payment\" || order.paypal_capture === cap.id)) settle(order, cap);", to: "          if (order && order.state === \"shipped\") { order.parcels += 1; store.save(); } else if (order) settle(order, cap);" },
    ],
  },
  "out-of-order": {
    mistake: "lets a late 'approved' event move a shipped order back",
    patches: [
      { file: "server.js", from: "        if (store.seen(event.id)) return", to: "        if (store.seen(event.id) && event.event_type !== \"CHECKOUT.ORDER.APPROVED\") return" },
      { file: "server.js", from: "        // CHECKOUT.ORDER.APPROVED and the rest change nothing: approval is not payment.\n", to: "        if (event.event_type === \"CHECKOUT.ORDER.APPROVED\") {\n          const o = store.byPayPal(event.resource?.id);\n          if (o && o.state === \"shipped\") { o.state = \"approved\"; store.save(); }\n        }\n" },
    ],
  },
  "double-capture": {
    mistake: "has no guard against a double click and ships again when PayPal says 'already captured'",
    patches: [
      { file: "server.js", from: "          if (!inflight.has(order.ref)) inflight.set(order.ref, capture(order).finally(() => inflight.delete(order.ref)));\n          const out = await inflight.get(order.ref);", to: "          const out = await capture(order);" },
      { file: "server.js", from: "    if (order.state !== \"awaiting_payment\") return { status: 200, body: { ref: order.ref, state: order.state } };\n    const r = await paypal.captureOrder(order.paypal_order, order.ref);", to: "    const r = await paypal.captureOrder(order.paypal_order, `${order.ref}-${Date.now()}-${Math.random()}`);" },
      { file: "server.js", from: "    if (r.status === 422 && issue === \"ORDER_ALREADY_CAPTURED\") found =", to: "    if (r.status === 422 && issue === \"ORDER_ALREADY_CAPTURED\") { order.parcels += 1; store.save(); return { status: 200, body: { ref: order.ref, state: order.state } }; }\n    if (false) found =" },
    ],
  },
  "secret-leak": {
    mistake: "sends the PayPal secret to the browser",
    patches: [{ file: "lib/paypal.js", from: "      clientId: env.PAYPAL_CLIENT_ID ?? null,", to: "      clientId: env.PAYPAL_CLIENT_ID ?? null,\n      clientSecret: env.PAYPAL_CLIENT_SECRET,", }],
  },
};

/**
 * A mistake none of the ten scripted robberies can see: the capture route lets a field in its request body choose which
 * shop order a payment pays for, so one payment can pay for two orders. The AI thief found it on its own (its plans,
 * recorded from that run, are in test/fixtures/thief-plans-binding.json); the books catch it.
 */
const BEYOND_THE_TEN: Patch[] = [
  { file: "server.js", from: "  async function capture(order) {\n    if (order.state !== \"awaiting_payment\") return { status: 200, body: { ref: order.ref, state: order.state } };\n    const r = await paypal.captureOrder(order.paypal_order, order.ref);", to: "  async function capture(order, paypalId = order.paypal_order) {\n    if (order.state !== \"awaiting_payment\") return { status: 200, body: { ref: order.ref, state: order.state } };\n    const r = await paypal.captureOrder(paypalId, order.ref);" },
  { file: "server.js", from: "    if (r.status === 422 && issue === \"ORDER_ALREADY_CAPTURED\") found = (await paypal.getOrder(order.paypal_order))", to: "    if (r.status === 422 && issue === \"ORDER_ALREADY_CAPTURED\") found = (await paypal.getOrder(paypalId))" },
  { file: "server.js", from: "          const order = store.byPayPal(decodeURIComponent(m[1]));\n          if (!order) return send(res, 404, { error: \"unknown order\" });\n          if (!inflight.has(order.ref)) inflight.set(order.ref, capture(order).finally(() => inflight.delete(order.ref)));", to: "          const order = (body.ref && store.byRef(body.ref)) || store.byPayPal(decodeURIComponent(m[1]));\n          if (!order) return send(res, 404, { error: \"unknown order\" });\n          if (!inflight.has(order.ref)) inflight.set(order.ref, capture(order, decodeURIComponent(m[1])).finally(() => inflight.delete(order.ref)));" },
];

function patched(name: string, patches: Patch[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `heistproof-${name}-`));
  fs.cpSync(SHOP, dir, { recursive: true, filter: (p) => !/(^|\/)(node_modules|data)(\/|$)/.test(path.relative(SHOP, p)) });
  for (const p of patches) {
    const file = path.join(dir, p.file);
    const text = fs.readFileSync(file, "utf8");
    assert.equal(text.split(p.from).length - 1, 1, `${name}: the edit must match exactly once in ${p.file}: ${p.from.slice(0, 60)}`);
    fs.writeFileSync(file, text.replace(p.from, p.to));
  }
  return dir;
}

function buggyCopy(id: string): string {
  return patched(id, BUGS[id].patches);
}


test("the careful shop, unchanged, blocks all ten robberies", { timeout: 240_000 }, async () => {
  const { round, verdict } = await checkOffline(SHOP, { label: "copper-kettle" });
  for (const a of round.attacks) assert.equal(a.verdict, "held", `${a.id}: ${a.summary}`);
  assert.equal(round.attacks.length, 10);
  assert.deepEqual(round.books?.mismatches, [], "its books match PayPal's");
  assert.equal(verdict, "safe");
});

test("there is one planted mistake per robbery", () => {
  assert.equal(Object.keys(BUGS).length, 10);
});

for (const [id, bug] of Object.entries(BUGS)) {
  test(`a shop that ${bug.mistake} is robbed by "${id}"`, { timeout: 240_000 }, async () => {
    const dir = buggyCopy(id);
    try {
      const { round } = await checkOffline(dir, { attacks: [id], label: `copper-kettle-bug-${id}` });
      const outcome = round.attacks.find((a) => a.id === id);
      assert.ok(outcome, `${id} ran`);
      assert.equal(outcome.verdict, "robbed", `${id}: ${outcome.summary}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("a mistake outside the ten: the scripted robberies all pass it, the AI thief's own robbery does not", { timeout: 300_000 }, async () => {
  const dir = patched("binding", BEYOND_THE_TEN);
  try {
    const { round, verdict } = await checkOffline(dir, { label: "copper-kettle-bug-binding", thief: { plansFile: path.join(FIXTURES, "thief-plans-binding.json") } });
    for (const a of round.attacks) assert.equal(a.verdict, "held", `${a.id} cannot see this mistake: ${a.summary}`);
    const caught = round.thief?.plans.filter((p) => p.verdict === "robbed") ?? [];
    assert.ok(caught.length >= 1, `the AI thief's plans got through: ${JSON.stringify(round.thief?.plans.map((p) => [p.name, p.verdict]))}`);
    assert.ok(caught.some((p) => p.mismatches.some((m) => /already pays for order/.test(m.problem))), "the books show one payment paying for two orders");
    assert.equal(verdict, "unsafe");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the AI thief's recorded plans get nothing out of the careful shop or the agent-written one", { timeout: 300_000 }, async () => {
  const kettle = await checkOffline(SHOP, { label: "copper-kettle", thief: { plansFile: path.join(FIXTURES, "thief-plans-binding.json") } });
  assert.ok(kettle.round.thief?.ran && kettle.round.thief.plans.length > 0);
  for (const p of kettle.round.thief!.plans) assert.equal(p.verdict, "held", `${p.name}: ${p.summary}`);
  const after = await checkOffline(path.join(import.meta.dirname, "..", "..", "examples", "fogline-after"), { label: "fogline-after", thief: { plansFile: path.join(FIXTURES, "thief-plans-after.json") } });
  for (const p of after.round.thief!.plans) assert.equal(p.verdict, "held", `${p.name}: ${p.summary}`);
  assert.equal(after.verdict, "safe");
});

