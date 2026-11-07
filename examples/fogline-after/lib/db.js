import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export function openDb(file) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      email TEXT,
      items_json TEXT NOT NULL,
      total_cents INTEGER NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL,
      payment_method TEXT,
      payment_reference TEXT,
      paid_cents INTEGER,
      paid_at TEXT,
      failure TEXT
    );
    CREATE TABLE IF NOT EXISTS shipments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      label TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS paypal_claims (
      claim_key TEXT PRIMARY KEY,
      shop_order_id TEXT,
      paypal_order_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS webhook_events (
      event_id TEXT PRIMARY KEY,
      event_type TEXT,
      received_at TEXT NOT NULL
    );
  `);
  // Migration for DB files created before PayPal support.
  const orderColumns = db.prepare("PRAGMA table_info(orders)").all().map((c) => c.name);
  if (!orderColumns.includes("paypal_order_id")) {
    db.exec("ALTER TABLE orders ADD COLUMN paypal_order_id TEXT");
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_paypal_order_id ON orders (paypal_order_id)");
  const now = () => new Date().toISOString();
  const withItems = (r) => r && { ...r, items: JSON.parse(r.items_json) };
  return {
    raw: db,
    createOrder({ email, lines, totalCents, currency, method }) {
      const id = `FOG-${randomBytes(3).toString("hex").toUpperCase()}`;
      db.prepare(
        `INSERT INTO orders (id, created_at, email, items_json, total_cents, currency, status, payment_method)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
      ).run(id, now(), email ?? null, JSON.stringify(lines), totalCents, currency, method ?? null);
      return this.getOrder(id);
    },
    getOrder(id) {
      return withItems(db.prepare("SELECT * FROM orders WHERE id = ?").get(id));
    },
    listOrders() {
      return db
        .prepare("SELECT * FROM orders ORDER BY created_at DESC")
        .all()
        .map((r) => ({ ...withItems(r), shipments: this.shipmentsFor(r.id).length }));
    },
    markPaid(id, { method, reference, paidCents }) {
      db.prepare("UPDATE orders SET status = 'paid', payment_method = ?, payment_reference = ?, paid_cents = ?, paid_at = ? WHERE id = ?").run(
        method,
        reference,
        paidCents,
        now(),
        id,
      );
    },
    markFailed(id, reason) {
      db.prepare("UPDATE orders SET status = 'failed', failure = ? WHERE id = ?").run(String(reason ?? "failed"), id);
    },
    setStatus(id, status) {
      db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(status, id);
    },
    addShipment(orderId, label) {
      db.prepare("INSERT INTO shipments (order_id, created_at, label) VALUES (?, ?, ?)").run(orderId, now(), label);
    },
    shipmentsFor(orderId) {
      return db.prepare("SELECT * FROM shipments WHERE order_id = ? ORDER BY id").all(orderId);
    },
    // --- PayPal binding, durable claims, webhook idempotency, atomic paid transition ---
    bindPayPalOrder(id, paypalOrderId) {
      db.prepare("UPDATE orders SET paypal_order_id = ? WHERE id = ?").run(paypalOrderId, id);
      return this.getOrder(id);
    },
    getOrderByPayPalId(paypalOrderId) {
      return withItems(db.prepare("SELECT * FROM orders WHERE paypal_order_id = ?").get(paypalOrderId));
    },
    claimPayPal(claimKey, { shopOrderId = null, paypalOrderId = null } = {}) {
      try {
        db.prepare("INSERT INTO paypal_claims (claim_key, shop_order_id, paypal_order_id, created_at) VALUES (?, ?, ?, ?)").run(claimKey, shopOrderId, paypalOrderId, now());
        return true;
      } catch (err) {
        if (/UNIQUE constraint|PRIMARY KEY/i.test(String(err?.message ?? "")) || err?.errcode === 2067 || err?.errcode === 1555) return false;
        throw err;
      }
    },
    getPayPalClaim(claimKey) {
      return db.prepare("SELECT * FROM paypal_claims WHERE claim_key = ?").get(claimKey);
    },
    setClaimPayPalOrder(claimKey, paypalOrderId) {
      db.prepare("UPDATE paypal_claims SET paypal_order_id = ? WHERE claim_key = ?").run(paypalOrderId, claimKey);
    },
    releasePayPalClaim(claimKey) {
      db.prepare("DELETE FROM paypal_claims WHERE claim_key = ?").run(claimKey);
    },
    recordWebhookEvent(eventId, eventType) {
      try {
        db.prepare("INSERT INTO webhook_events (event_id, event_type, received_at) VALUES (?, ?, ?)").run(eventId, eventType ?? null, now());
        return true;
      } catch (err) {
        if (/UNIQUE constraint|PRIMARY KEY/i.test(String(err?.message ?? "")) || err?.errcode === 2067 || err?.errcode === 1555) return false;
        throw err;
      }
    },
    // Atomically claim pending -> paid. Returns true only for the one caller that changed the row;
    // that caller (and only that caller) must fulfil.
    claimPaidTransition(id, { method, reference, paidCents }) {
      const result = db
        .prepare("UPDATE orders SET status = 'paid', payment_method = ?, payment_reference = ?, paid_cents = ?, paid_at = ? WHERE id = ? AND status = 'pending'")
        .run(method, reference, paidCents, now(), id);
      return Number(result.changes) === 1;
    },
  };
}
