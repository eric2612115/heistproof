import fs from "node:fs";
import crypto from "node:crypto";

/** Orders and processed webhook events in one JSON file (SHOP_DB), written on every change. */
export function openStore(file) {
  const data = file && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8") || "{}") : {};
  data.orders ??= [];
  data.events ??= [];
  const save = () => file && fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return {
    orders: () => data.orders,
    byRef: (ref) => data.orders.find((o) => o.ref === ref),
    byPayPal: (id) => data.orders.find((o) => o.paypal_order === id),
    add(order) {
      const o = { ref: `KC-${crypto.randomBytes(3).toString("hex").toUpperCase()}`, state: "awaiting_payment", paypal_order: null, paypal_capture: null, parcels: 0, created_at: new Date().toISOString(), history: [], ...order };
      data.orders.push(o);
      save();
      return o;
    },
    note(order, what) {
      order.history.push({ at: new Date().toISOString(), what });
      save();
    },
    seen: (eventId) => data.events.includes(eventId),
    remember(eventId) {
      data.events.push(eventId);
      save();
    },
    save,
  };
}
