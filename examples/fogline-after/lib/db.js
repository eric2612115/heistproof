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
      shop_order_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      reference TEXT,
      paypal_order_id TEXT,
      state TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS webhook_events (
      event_id TEXT PRIMARY KEY,
      event_type TEXT,
      created_at TEXT NOT NULL
    );
  `);
  // Orders predate PayPal: add the binding column / uniqueness if missing.
  const orderCols = db.prepare("PRAGMA table_info(orders)").all().map((c) => c.name);
  if (!orderCols.includes("paypal_order_id")) {
    db.exec("ALTER TABLE orders ADD COLUMN paypal_order_id TEXT");
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_paypal_order_id ON orders(paypal_order_id) WHERE paypal_order_id IS NOT NULL");
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
    setPaypalOrderId(id, paypalOrderId) {
      db.prepare("UPDATE orders SET paypal_order_id = ? WHERE id = ?").run(paypalOrderId, id);
    },
    getOrderByPaypalOrderId(paypalOrderId) {
      if (!paypalOrderId) return undefined;
      return withItems(db.prepare("SELECT * FROM orders WHERE paypal_order_id = ?").get(paypalOrderId));
    },
    // A claim is its own row, committed before the provider call. The PRIMARY KEY is
    // what rejects a second caller doing the same write for the same shop order.
    claimPaypal(claimKey, { shopOrderId, kind, reference }) {
      const t = now();
      const r = db
        .prepare(
          `INSERT OR IGNORE INTO paypal_claims (claim_key, shop_order_id, kind, reference, state, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'claimed', ?, ?)`,
        )
        .run(claimKey, shopOrderId, kind, reference ?? null, t, t);
      return r.changes === 1;
    },
    getClaim(claimKey) {
      return db.prepare("SELECT * FROM paypal_claims WHERE claim_key = ?").get(claimKey);
    },
    settleClaim(claimKey, { paypalOrderId, state } = {}) {
      db.prepare("UPDATE paypal_claims SET paypal_order_id = COALESCE(?, paypal_order_id), state = ?, updated_at = ? WHERE claim_key = ?").run(
        paypalOrderId ?? null,
        state ?? "settled",
        now(),
        claimKey,
      );
    },
    releaseClaim(claimKey) {
      db.prepare("DELETE FROM paypal_claims WHERE claim_key = ?").run(claimKey);
    },
    hasWebhookEvent(eventId) {
      return Boolean(db.prepare("SELECT event_id FROM webhook_events WHERE event_id = ?").get(eventId));
    },
    recordWebhookEvent(eventId, eventType) {
      const r = db.prepare("INSERT OR IGNORE INTO webhook_events (event_id, event_type, created_at) VALUES (?, ?, ?)").run(eventId, eventType ?? null, now());
      return r.changes === 1;
    },
    // Fulfil-exactly-once gate: only the caller that flips pending -> paid fulfils.
    markPaidIfPending(id, { method, reference, paidCents }) {
      const r = db
        .prepare(
          `UPDATE orders SET status = 'paid', payment_method = ?, payment_reference = ?, paid_cents = ?, paid_at = ?
           WHERE id = ? AND status = 'pending'`,
        )
        .run(method, reference, paidCents, now(), id);
      return r.changes === 1;
    },
  };
}
