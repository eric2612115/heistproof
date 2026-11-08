// Runs ProShop v2 (https://github.com/bradtraversy/proshop-v2, MIT) under Heistproof. This file is not part of
// ProShop: `npm run fetch:proshop` copies it into a ProShop checkout. It gives ProShop the settings it reads from .env,
// a fresh MongoDB database for every run, ProShop's own seed data, and the read-only orders list Heistproof reads.
// ProShop's code is not changed.
import http from "node:http";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import mongoose from "mongoose";

const port = Number(process.env.PORT ?? 5000);
const host = process.env.HOST ?? "127.0.0.1";
const inner = port + 1000;
const key = process.env.ADMIN_KEY ?? "";
const db = `heistproof-${crypto.createHash("sha1").update(process.env.SHOP_DB ?? String(Date.now())).digest("hex").slice(0, 12)}`;
const mongo = `${process.env.HEISTPROOF_MONGO_URL ?? "mongodb://127.0.0.1:27017"}/${db}`;
const env = {
  ...process.env,
  NODE_ENV: "production",
  PORT: String(inner),
  MONGO_URI: mongo,
  JWT_SECRET: crypto.randomBytes(24).toString("hex"),
  // ProShop's names for the PayPal settings Heistproof gives every shop (the fixed version reads them; the original does not).
  PAYPAL_APP_SECRET: process.env.PAYPAL_CLIENT_SECRET ?? "",
  PAYPAL_API_URL: process.env.PAYPAL_API_BASE ?? "https://api-m.sandbox.paypal.com",
};

// ProShop's own seed: its products and its three sample users.
const seeded = spawnSync(process.execPath, ["backend/seeder.js"], { env, stdio: "inherit" });
if (seeded.status !== 0) {
  console.error("Seeding ProShop failed. Is MongoDB running? (brew services start mongodb-community)");
  process.exit(1);
}
const shop = spawn(process.execPath, ["backend/server.js"], { env, stdio: "inherit" });
const stop = async () => {
  shop.kill();
  await mongoose.connection.dropDatabase().catch(() => {});
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
shop.on("exit", (code) => process.exit(code ?? 1));

await mongoose.connect(mongo);
const orders = async () => (await mongoose.connection.collection("orders").find({}).sort({ createdAt: 1 }).toArray()).map(row);
/** One ProShop order as Heistproof reads orders: paid when ProShop marks it paid, shipped when staff mark it delivered. */
function row(o) {
  return {
    id: String(o._id),
    status: o.isDelivered ? "delivered" : o.isPaid ? "paid" : "pending",
    shipments: o.isDelivered ? 1 : 0,
    reference: o.paymentResult?.id ?? null,
    total: o.totalPrice,
    items: (o.orderItems ?? []).map((i) => ({ sku: String(i.product), qty: i.qty, price: i.price })),
    paidAt: o.paidAt ?? null,
  };
}

const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
/** A plain back-office page, for the pictures Heistproof takes after each robbery. */
function page(list) {
  const rows = list
    .map((o) => `<tr><td class="mono">${esc(o.id.slice(-8))}</td><td>${o.items.map((i) => `${i.qty} × ${esc(i.sku.slice(-6))}`).join(", ")}</td><td>$${Number(o.total).toFixed(2)}</td><td><span class="st ${esc(o.status)}">${esc(o.status)}</span></td><td class="mono">${esc(o.reference ?? "")}</td></tr>`)
    .join("");
  return `<!doctype html><meta charset="utf-8"><title>ProShop orders</title><style>body{background:#11161d;color:#e6e9ee;font:15px system-ui;padding:32px 48px}h1{font:600 30px Georgia,serif;margin:0}p{color:#9aa4b2;margin:6px 0 24px}table{width:100%;border-collapse:collapse}th{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#9aa4b2;text-align:left;padding:8px 10px}td{padding:12px 10px;border-top:1px solid #253041}.mono{font-family:ui-monospace,monospace;font-size:13px;color:#b8c1cc}.st{padding:2px 9px;border-radius:9px;font-size:12px}.st.paid,.st.delivered{background:#173455;color:#9cc8ff}.st.pending{background:#3a3315;color:#f0d77a}</style><h1>ProShop orders</h1><p>Read from ProShop's own database. Paid and delivered as ProShop recorded them.</p><table><tr><th>Order</th><th>Items</th><th>Total</th><th>Status</th><th>PayPal order</th></tr>${rows}</table>`;
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${host}`);
    if (url.pathname === "/heistproof/orders") {
      if (req.headers["x-admin-key"] !== key) return res.writeHead(401).end();
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(await orders()));
    }
    if (url.pathname === "/heistproof/backoffice") {
      if (url.searchParams.get("key") !== key) return res.writeHead(401).end();
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(page(await orders()));
    }
    // Everything else is ProShop's own.
    const up = http.request({ host: "127.0.0.1", port: inner, method: req.method, path: req.url, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    up.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(up);
  })
  .listen(port, host);
