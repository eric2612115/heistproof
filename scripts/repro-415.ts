// npm run repro:415
// Reproduces the capture problem we reported to APIMatic (https://github.com/context-plugins/plugin-marketplace/issues/120)
// with your own PayPal sandbox app (PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET, as for `npm run check`); no buyer needed.
// It installs APIMatic's PayPal TypeScript SDK at the commit the coding agent installed in every recorded full run,
// makes one sandbox order and captures it twice: without a body the SDK sends no Content-Type and PayPal answers 415;
// with `body: {}` the same call gets past that check (422, PayPal's normal answer for an order nobody approved).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { ROOT, requireEnv } from "../src/config.ts";

const SDK = "git+https://github.com/context-plugins/paypal-typescript-sdk#5d0df8a8817e5fdf2e2cd48e68f790ea4730aab2";
const dir = path.join(ROOT, ".heistproof", "repro-415");
const entry = path.join(dir, "node_modules", "paypal", "dist", "esm", "index.js");
if (!fs.existsSync(entry)) {
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(path.join(dir, "package.json"))) fs.writeFileSync(path.join(dir, "package.json"), '{ "private": true }\n');
  console.log("Installing APIMatic's PayPal TypeScript SDK at 5d0df8a (once)...");
  execFileSync("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error", SDK], { cwd: dir, stdio: "inherit", shell: process.platform === "win32" });
}
const { PaypalClient } = await import(pathToFileURL(entry).href);

const sent: string[] = [];
const client = new PaypalClient({
  oauth2: { clientId: requireEnv("PAYPAL_CLIENT_ID"), clientSecret: requireEnv("PAYPAL_CLIENT_SECRET") },
  fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    if (req.url.endsWith("/capture")) sent.push(req.headers.get("content-type") ?? "no Content-Type header");
    return fetch(req);
  },
});

const order = await client.orders.createOrder({ body: { intent: "CAPTURE", purchaseUnits: [{ amount: { currencyCode: "USD", value: "1.00" } }] } });
console.log(`Sandbox order ${order.id}, which nobody approves.`);
for (const [call, request] of [
  ["captureOrder({ id })          ", { id: order.id }],
  ["captureOrder({ id, body: {} })", { id: order.id, body: {} }],
] as const) {
  try {
    await client.orders.captureOrder(request);
    console.log(`${call} -> captured`);
  } catch (e: any) {
    console.log(`${call} -> ${e?.status ?? e?.message} (PayPal debug id ${e?.headers?.get?.("paypal-debug-id") ?? "?"}); sent with ${sent.at(-1)}`);
  }
}
console.log("415: PayPal refused the request's media type before looking at the order. 422: the call got past that check.");
