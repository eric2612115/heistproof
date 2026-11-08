import fs from "node:fs";
import path from "node:path";

/**
 * What Heistproof needs to know about a shop to buy from it like a shopper and to read its back office.
 * A shop describes itself in heistproof.json at its root; anything left out takes the sample shop's (Fogline's) value.
 * The attacks themselves need nothing shop-specific: they learn the checkout's routes by watching the real purchase.
 */
export type ShopProfile = {
  /** Starts the server. Its environment holds PORT, HOST, SHOP_DB, ADMIN_KEY and the PayPal variables. */
  start: string[];
  /** A GET path that answers 200 once the shop is up. */
  health: string;
  /**
   * What the shopper buys: the product, how many, its name in plain words (for the reports), and optionally a second
   * product of the shop, for the bag with a negative line.
   */
  product: { sku: string; qty: number; name?: string; other?: string };
  /** How the shopper fills and opens the bag: a localStorage key holding [{ sku, qty }], or a button to click per item. */
  bag: { storageKey?: string; add?: string; open?: string; total: string };
  /** The back office: an orders list (JSON, read with the admin key in a header) and the page to photograph. */
  admin: { orders: string; keyHeader: string; page: string };
  /** Field names in that orders list, and the statuses that mean the shop considers an order paid. */
  orders: { id: string; status: string; paid: string[]; shipments: string; reference: string; total?: string; totalUnit?: "cents" | "dollars" };
  /** Where the shop receives PayPal's webhooks. */
  webhooks: string;
  /** How the shop takes money. ["paypal"] means PayPal only: any order paid without a PayPal capture is then a mismatch. */
  payments?: string[];
};

export const FOGLINE: ShopProfile = {
  start: ["node", "server.js"],
  health: "/api/products",
  product: { sku: "FOG-HOODIE", qty: 1, name: "hoodie", other: "HARBOR-BEANIE" },
  bag: { storageKey: "fogline.bag", open: "#bag-button", total: "#bag-total" },
  admin: { orders: "/api/admin/orders", keyHeader: "x-admin-key", page: "/admin?key={key}" },
  orders: { id: "id", status: "status", paid: ["paid", "fulfilled"], shipments: "shipments", reference: "payment_reference", total: "total_cents", totalUnit: "cents" },
  webhooks: "/api/paypal/webhooks",
};

export function loadProfile(dir: string): ShopProfile {
  const file = path.join(dir, "heistproof.json");
  if (!fs.existsSync(file)) return FOGLINE;
  const given = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<ShopProfile>;
  return {
    start: given.start ?? FOGLINE.start,
    health: given.health ?? FOGLINE.health,
    // A shop that names its own product does not inherit Fogline's name or second product.
    product: given.product ? { ...given.product, qty: given.product.qty ?? 1, name: given.product.name ?? "item" } : FOGLINE.product,
    // A shop that names its own bag replaces Fogline's bag settings entirely (no stray localStorage key).
    bag: given.bag ? { ...given.bag, total: given.bag.total ?? FOGLINE.bag.total } : FOGLINE.bag,
    admin: { ...FOGLINE.admin, ...given.admin },
    orders: { ...FOGLINE.orders, ...given.orders },
    webhooks: given.webhooks ?? FOGLINE.webhooks,
    payments: given.payments,
  };
}

/** A shop order as the attacks read it: the shop's own record, plus its id, status, paid flag, shipments and payment reference. */
export type ShopOrder = Record<string, any> & { id: string; status: string; paid: boolean; shipments: number; payment_reference: string | null; total_cents?: number | null };

export function normalizeOrder(raw: Record<string, any>, p: ShopProfile): ShopOrder {
  const status = String(raw[p.orders.status] ?? "");
  const total = p.orders.total ? Number(raw[p.orders.total]) : NaN;
  return {
    ...raw,
    id: String(raw[p.orders.id] ?? ""),
    status,
    paid: p.orders.paid.includes(status),
    shipments: Number(raw[p.orders.shipments] ?? 0) || 0,
    payment_reference: raw[p.orders.reference] ?? null,
    total_cents: Number.isFinite(total) ? Math.round(p.orders.totalUnit === "dollars" ? total * 100 : total) : null,
  };
}
