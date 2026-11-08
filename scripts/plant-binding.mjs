#!/usr/bin/env node
// node scripts/plant-binding.mjs
// Writes shops/copper-kettle-binding: Copper Kettle with one planted mistake that none of the ten scripted robberies can
// see. Its capture route lets a field in the request body choose which shop order a payment pays for, so one payment can
// pay for two orders. The same edits as BEYOND_THE_TEN in test/attacks/one-bug.test.ts; this copy exists so the AI thief
// can be recorded against it in PayPal's sandbox.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const from = path.join(root, "shops", "copper-kettle");
const to = path.join(root, "shops", "copper-kettle-binding");

const EDITS = [
  {
    file: "server.js",
    from: 'async function capture(order) {\n    if (order.state !== "awaiting_payment") return { status: 200, body: { ref: order.ref, state: order.state } };\n    const r = await paypal.captureOrder(order.paypal_order, order.ref);',
    to: 'async function capture(order, paypalId = order.paypal_order) {\n    if (order.state !== "awaiting_payment") return { status: 200, body: { ref: order.ref, state: order.state } };\n    const r = await paypal.captureOrder(paypalId, order.ref);',
  },
  {
    file: "server.js",
    from: 'if (r.status === 422 && issue === "ORDER_ALREADY_CAPTURED") found = (await paypal.getOrder(order.paypal_order))',
    to: 'if (r.status === 422 && issue === "ORDER_ALREADY_CAPTURED") found = (await paypal.getOrder(paypalId))',
  },
  {
    file: "server.js",
    from: 'const order = store.byPayPal(decodeURIComponent(m[1]));\n          if (!order) return send(res, 404, { error: "unknown order" });\n          if (!inflight.has(order.ref)) inflight.set(order.ref, capture(order).finally(() => inflight.delete(order.ref)));',
    to: 'const order = (body.ref && store.byRef(body.ref)) || store.byPayPal(decodeURIComponent(m[1]));\n          if (!order) return send(res, 404, { error: "unknown order" });\n          if (!inflight.has(order.ref)) inflight.set(order.ref, capture(order, decodeURIComponent(m[1])).finally(() => inflight.delete(order.ref)));',
  },
];

fs.rmSync(to, { recursive: true, force: true });
fs.cpSync(from, to, { recursive: true, filter: (p) => !/(^|\/)(node_modules|data)(\/|$)/.test(path.relative(from, p)) });
for (const e of EDITS) {
  const file = path.join(to, e.file);
  const text = fs.readFileSync(file, "utf8");
  if (text.split(e.from).length - 1 !== 1) throw new Error(`the edit must match exactly once in ${e.file}: ${e.from.slice(0, 60)}`);
  fs.writeFileSync(file, text.replace(e.from, e.to));
}
fs.writeFileSync(
  path.join(to, "README.md"),
  `# Copper Kettle, with one planted mistake (a test shop)

This is [Copper Kettle](../copper-kettle/README.md) with one deliberate mistake, written by \`node scripts/plant-binding.mjs\`:
its capture route lets a \`ref\` field in the request body choose which shop order the payment pays for, so one payment can
pay for two orders. None of Heistproof's ten scripted robberies can see it; it exists to show what the AI thief finds, judged
by the books (one capture standing behind two shipped orders). Do not copy this code.
`,
);
console.log(`planted ${path.relative(root, to)}`);
