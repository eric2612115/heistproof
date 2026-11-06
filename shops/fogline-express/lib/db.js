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
  `);
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
  };
}
