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
/** A planted shop: its edits, and whether its own tests no longer apply (they would fail on purpose). */
type Plant = { mistake: string; patches: Patch[]; noTests?: boolean };

/** One mistake per robbery, as a few exact edits of the careful shop's code. */
const BUGS: Record<string, Plant> = {
  "price-tamper": {
    mistake: "uses a unit price sent by the browser",
    patches: [{ file: "server.js", from: "priced = priceLines(body.lines);", to: "priced = priceLines(body.lines);\n            if (body.lines?.[0]?.price_cents) { priced.lines[0].unit_cents = body.lines[0].price_cents; priced.total_cents = priced.lines.reduce((n, l) => n + l.count * l.unit_cents, 0); }" }],
  },
  "bad-bag": {
    mistake: "lets a line with a negative quantity take money off the bag",
    patches: [
      { file: "lib/catalog.js", from: "if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT)", to: "if (!Number.isInteger(count) || count === 0 || count > MAX_COUNT)" },
      { file: "lib/paypal.js", from: "              amount: { currency_code: \"USD\", value, breakdown: { item_total: { currency_code: \"USD\", value } } },\n              items: order.lines.map((l) => ({ name: l.name, sku: l.product, quantity: String(l.count), unit_amount: { currency_code: \"USD\", value: dollars(l.unit_cents) }, category: \"PHYSICAL_GOODS\" })),\n", to: "              amount: { currency_code: \"USD\", value },\n" },
    ],
    noTests: true,
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
 * Mistakes an earlier version of these robberies missed (found by an independent review), each now caught by the robbery
 * for its kind: a price under another field name, a webhook that names the order only by invoice_id, an access token
 * served to the page.
 */
const MISSED_BEFORE: Record<string, Plant & { robbery: string }> = {
  "unit-cents": {
    robbery: "price-tamper",
    mistake: "prices each line from a unit_cents field the page sends",
    patches: [
      { file: "public/app.js", from: "const lines = () => [...cart].map(([product, count]) => ({ product, count }));", to: "const lines = () => [...cart].map(([product, count]) => ({ product, count, unit_cents: Math.round(Number(catalog.find((p) => p.sku === product)?.price ?? 0) * 100) }));" },
      { file: "server.js", from: "            priced = priceLines(body.lines);", to: "            priced = priceLines(body.lines);\n            for (const [i, l] of priced.lines.entries()) if (Number.isInteger(body.lines?.[i]?.unit_cents) && body.lines[i].unit_cents > 0) l.unit_cents = body.lines[i].unit_cents;\n            priced.total_cents = priced.lines.reduce((n, l) => n + l.count * l.unit_cents, 0);" },
    ],
  },
  "invoice-no-verify": {
    robbery: "forged-webhook",
    mistake: "never verifies webhooks and finds the order by invoice_id",
    patches: [
      { file: "server.js", from: "if (!(await paypal.verifyWebhook(req.headers, event)))", to: "if (false)" },
      { file: "server.js", from: "          const order = store.byRef(cap.custom_id) ?? store.byPayPal(cap.supplementary_data?.related_ids?.order_id);", to: "          const order = store.byRef(String(cap.invoice_id ?? \"\").split(\"-\").slice(0, 2).join(\"-\"));" },
    ],
    noTests: true,
  },
  "token-leak": {
    robbery: "secret-leak",
    mistake: "hands the page a PayPal access token",
    patches: [
      { file: "lib/paypal.js", from: "    browserConfig: () => ({\n      clientId: env.PAYPAL_CLIENT_ID ?? null,", to: "    browserConfig: async () => ({\n      accessToken: await accessToken(),\n      clientId: env.PAYPAL_CLIENT_ID ?? null," },
      { file: "server.js", from: "return send(res, 200, paypal.browserConfig());", to: "return send(res, 200, await paypal.browserConfig());" },
    ],
  },
};

/** A "confirm" route that ships when the page says PayPal completed the payment: caught by "payment nobody approved". */
const CONFIRM_ROUTE: Patch[] = [
  {
    file: "server.js",
    from: "        const m = /^\\/api\\/checkout\\/paypal\\/([^/]+)\\/capture$/.exec(p);",
    to: "        const confirm = /^\\/api\\/checkout\\/paypal\\/([^/]+)\\/confirm$/.exec(p);\n        if (confirm) {\n          const order = store.byPayPal(decodeURIComponent(confirm[1]));\n          if (!order) return send(res, 404, { error: \"unknown order\" });\n          if (body.status === \"COMPLETED\" && order.state === \"awaiting_payment\") { order.state = \"shipped\"; order.parcels = 1; store.save(); }\n          return send(res, 200, { ref: order.ref, state: order.state });\n        }\n        const m = /^\\/api\\/checkout\\/paypal\\/([^/]+)\\/capture$/.exec(p);",
  },
  {
    file: "public/app.js",
    from: "      if (!res.ok) return notice(data.error ?? \"The payment did not go through.\");\n      cart.clear();",
    to: "      if (!res.ok) return notice(data.error ?? \"The payment did not go through.\");\n      await post(`/api/checkout/paypal/${encodeURIComponent(orderId)}/confirm`, { status: \"COMPLETED\" });\n      cart.clear();",
  },
];

/** Correct shops that an earlier version wrongly flagged: a thousand at full price, shipping, a sale, shipping later, volume pricing. */
const CORRECT: Record<string, Plant & { robberies?: string[] }> = {
  "wholesale-1000": {
    mistake: "sells up to 1,000 of an item at the catalog price",
    patches: [{ file: "lib/catalog.js", from: "const MAX_COUNT = 10;", to: "const MAX_COUNT = 1000;" }],
    robberies: ["bad-bag"],
    noTests: true,
  },
  "volume-pricing": {
    mistake: "sells a hundred or more of a product at 10% off each",
    patches: [
      { file: "lib/catalog.js", from: "const MAX_COUNT = 10;", to: "const MAX_COUNT = 1000;" },
      { file: "lib/catalog.js", from: "    return { product: sku, name: CATALOG[sku].name, count, unit_cents: CATALOG[sku].cents };", to: "    return { product: sku, name: CATALOG[sku].name, count, unit_cents: count >= 100 ? Math.round(CATALOG[sku].cents * 0.9) : CATALOG[sku].cents };" },
    ],
    robberies: ["bad-bag"],
    noTests: true,
  },
  "sale-discount": {
    mistake: "runs a 10% sale, shown in the bag and named in PayPal's breakdown as a discount",
    patches: [
      { file: "lib/catalog.js", from: "  return { lines: priced, total_cents: priced.reduce((n, l) => n + l.count * l.unit_cents, 0) };", to: "  const item_total_cents = priced.reduce((n, l) => n + l.count * l.unit_cents, 0);\n  const discount_cents = Math.round(item_total_cents / 10);\n  return { lines: priced, item_total_cents, discount_cents, total_cents: item_total_cents - discount_cents };" },
      { file: "lib/paypal.js", from: "              amount: { currency_code: \"USD\", value, breakdown: { item_total: { currency_code: \"USD\", value } } },", to: "              amount: { currency_code: \"USD\", value, breakdown: { item_total: { currency_code: \"USD\", value: dollars(order.item_total_cents) }, discount: { currency_code: \"USD\", value: dollars(order.discount_cents) } } }," },
      { file: "public/app.js", from: "const cartTotal = () => [...cart].reduce((sum, [sku, count]) => sum + Number(catalog.find((p) => p.sku === sku)?.price ?? 0) * count, 0);", to: "const cartTotal = () => Math.round([...cart].reduce((sum, [sku, count]) => sum + Number(catalog.find((p) => p.sku === sku)?.price ?? 0) * 100 * count, 0) * 0.9) / 100;" },
    ],
    robberies: ["price-tamper"],
    noTests: true,
  },
  "ships-later": {
    mistake: "marks orders paid and leaves the parcel to staff",
    patches: [
      { file: "server.js", from: "    if (order.state === \"paid\" && order.parcels === 0 && order.paypal_capture === capture.id) {\n      order.parcels = 1;\n      order.state = \"shipped\";\n      store.note(order, \"parcel booked\");\n    }\n", to: "    // Staff book parcels by hand later.\n" },
    ],
    robberies: ["price-tamper"],
    noTests: true,
  },
  "flat-shipping": {
    mistake: "adds $5.00 shipping on the server, named in PayPal's breakdown",
    patches: [
      { file: "server.js", from: "          const order = store.add({ ...priced, currency: \"USD\" });", to: "          const order = store.add({ ...priced, total_cents: priced.total_cents + 500, currency: \"USD\" });" },
      { file: "lib/paypal.js", from: "breakdown: { item_total: { currency_code: \"USD\", value } } },", to: "breakdown: { item_total: { currency_code: \"USD\", value: dollars(order.total_cents - 500) }, shipping: { currency_code: \"USD\", value: \"5.00\" } } }," },
    ],
    noTests: true,
  },
};

/** A shop that creates AUTHORIZE orders and then calls capture: PayPal refuses every capture, so it must never pass. */
const AUTHORIZE: Patch[] = [{ file: "lib/paypal.js", from: "          intent: \"CAPTURE\",", to: "          intent: \"AUTHORIZE\"," }];

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

function patched(name: string, patches: Patch[], noTests = false): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `heistproof-${name}-`));
  fs.cpSync(SHOP, dir, { recursive: true, filter: (p) => !/(^|\/)(node_modules|data)(\/|$)/.test(path.relative(SHOP, p)) });
  for (const p of patches) {
    const file = path.join(dir, p.file);
    const text = fs.readFileSync(file, "utf8");
    assert.equal(text.split(p.from).length - 1, 1, `${name}: the edit must match exactly once in ${p.file}: ${p.from.slice(0, 60)}`);
    fs.writeFileSync(file, text.replace(p.from, p.to));
  }
  // A plant whose own tests would fail on purpose: what is measured here is the robbery, not the shop's tests.
  if (noTests) {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    pkg.scripts.test = "node -e \"console.log('the shop tests do not apply to this planted copy')\"";
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg, null, 2));
  }
  return dir;
}

function buggyCopy(id: string): string {
  return patched(id, BUGS[id].patches, BUGS[id].noTests);
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

for (const [name, plant] of Object.entries(MISSED_BEFORE)) {
  test(`a shop that ${plant.mistake} is robbed by "${plant.robbery}"`, { timeout: 240_000 }, async () => {
    const dir = patched(name, plant.patches, plant.noTests);
    try {
      const { round } = await checkOffline(dir, { attacks: [plant.robbery], label: `copper-kettle-${name}` });
      const outcome = round.attacks.find((a) => a.id === plant.robbery);
      assert.ok(outcome, `${plant.robbery} ran`);
      assert.equal(outcome.verdict, "robbed", `${name}: ${outcome.summary}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

for (const [name, plant] of Object.entries(CORRECT)) {
  test(`a correct shop that ${plant.mistake} is not reported robbed`, { timeout: 300_000 }, async () => {
    const dir = patched(name, plant.patches, plant.noTests);
    try {
      const { round, verdict } = await checkOffline(dir, { attacks: plant.robberies, label: `copper-kettle-${name}` });
      assert.equal(round.prove.ok, true, `the real purchase goes through: ${round.prove.verdict}`);
      for (const a of round.attacks) assert.equal(a.verdict, "held", `${a.id}: ${a.summary}`);
      if (!plant.robberies) {
        assert.deepEqual(round.books?.mismatches, [], "its books match PayPal's");
        assert.equal(verdict, "safe");
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("a shop with a \"confirm\" route that ships on the page's word is robbed by \"capture-unapproved\"", { timeout: 240_000 }, async () => {
  const dir = patched("confirm-route", CONFIRM_ROUTE);
  try {
    const { round } = await checkOffline(dir, { attacks: ["capture-unapproved"], label: "copper-kettle-confirm-route" });
    const outcome = round.attacks.find((a) => a.id === "capture-unapproved");
    assert.equal(outcome?.verdict, "robbed", outcome?.summary);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a shop that captures orders it created to AUTHORIZE never passes: PayPal refuses the capture", { timeout: 240_000 }, async () => {
  const dir = patched("authorize-intent", AUTHORIZE);
  try {
    const { round, verdict } = await checkOffline(dir, { attacks: ["price-tamper"], label: "copper-kettle-authorize-intent" });
    assert.equal(round.prove.ok, false, "the purchase did not complete");
    assert.notEqual(verdict, "safe");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

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

