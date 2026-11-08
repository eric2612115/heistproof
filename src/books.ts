import { getOrder } from "./paypal/rest.ts";
import { shopOrders, type ShopProcess } from "./shop-process.ts";
import { itemList, skuKey, qtyKey } from "./checkout-shape.ts";
import type { ShopOrder } from "./shop-profile.ts";
import type { ProxiedCall } from "./paypal/proxy.ts";
import type { PurchaseResult } from "./prove.ts";

export type Books = {
  /** False when the shop's back office shows no PayPal ids at all, so its books cannot be matched to PayPal's. */
  matched: boolean;
  orders: number;
  /** Paid or shipped orders that carry a PayPal reference, each checked against PayPal's records. */
  paid: number;
  /** Paid or shipped orders with no PayPal reference (paid another way, such as the shop's card form): not PayPal's to vouch for. */
  otherPaid?: number;
  mismatches: Array<{ order: string; problem: string }>;
  /** Why the books could not be read, when they could not. */
  error?: string;
};

const PAYPAL_ID = /\b[0-9A-Z]{17}\b/g;
const cents = (v: unknown) => Math.round(Number(v) * 100);
const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;

/** What an order is for, as "sku x qty" lines, whether the shop keeps them as a list or as JSON text. */
export function goodsOf(order: Record<string, any>): string | null {
  let list = itemList(order)?.items ?? null;
  if (!list) {
    for (const [k, v] of Object.entries(order)) {
      if (typeof v !== "string" || !/items|lines|cart/i.test(k)) continue;
      try {
        const parsed = JSON.parse(v);
        if (Array.isArray(parsed)) list = parsed;
      } catch {
        /* not JSON */
      }
    }
  }
  if (!list?.length) return null;
  const lines = list.map((i) => `${i?.[skuKey(i) ?? "sku"] ?? "?"} x ${Number(i?.[qtyKey(i) ?? "qty"] ?? 1)}`);
  return lines.sort().join(", ");
}

/**
 * The shop's books against PayPal's, after every robbery of a round. Each order the shop treats as paid or has shipped
 * must be backed by a completed PayPal capture that covers the order's total; no order may ship more parcels than PayPal
 * captured payments; and the goods of the real purchase must never ship for less than the real purchase paid. It catches
 * what any robbery left behind, scripted or invented by the AI thief, not only what that robbery checked itself.
 */
export async function reconcile(shop: ShopProcess, calls: ProxiedCall[], legit: PurchaseResult): Promise<Books> {
  const orders = await shopOrders(shop);
  const ours = new Set(calls.filter((c) => c.method === "POST" && c.path === "/v2/checkout/orders" && c.status < 300).map((c) => (c.responseBody as any)?.id).filter((x): x is string => typeof x === "string"));
  const legitOrder: ShopOrder | undefined = legit.shopOrder ? (orders.find((o) => o.id === legit.shopOrder!.id) ?? legit.shopOrder) : undefined;
  if (!legitOrder || !(JSON.stringify(legitOrder).match(PAYPAL_ID) ?? []).length) return { matched: false, orders: orders.length, paid: orders.filter((o) => o.paid || o.shipments > 0).length, mismatches: [] };

  const records = new Map<string, any>();
  const record = async (id: string) => {
    if (!records.has(id)) records.set(id, (await getOrder(id)).body);
    return records.get(id);
  };
  const completed = (r: any) => ((r?.purchase_units?.[0]?.payments?.captures ?? []) as any[]).filter((c) => c.status === "COMPLETED");
  // Where the shopper's browser creates the PayPal order, Heistproof never sees it being made: any order the shop's
  // records name that this PayPal app can read is one of ours.
  const browserMade = shop.profile.capture === "browser";
  const isOurs = async (id: string) => ours.has(id) || (browserMade && Boolean((await record(id))?.id === id));
  const capturesOf = async (o: ShopOrder) => {
    const ids = [...new Set(JSON.stringify(o).match(PAYPAL_ID) ?? [])];
    const found: any[] = [];
    for (const id of ids) if (await isOurs(id)) found.push(...completed(await record(id)));
    // A shop may keep only the capture's id: find the PayPal order that holds it.
    if (!found.length) for (const id of ours) for (const c of completed(await record(id))) if (ids.includes(c.id)) found.push(c);
    return found;
  };

  // The real purchase sets the price of its goods: what the shopper paid for exactly those items.
  const legitGoods = goodsOf(legitOrder);
  const legitPaid = legit.ok ? (await capturesOf(legitOrder)).reduce((n, c) => n + cents(c.amount?.value), 0) : 0;

  const mismatches: Books["mismatches"] = [];
  const paypalOnly = shop.profile.payments?.length === 1 && shop.profile.payments[0] === "paypal";
  // One payment pays for one order: the same completed capture may not stand behind two orders the shop shipped.
  const claimedBy = new Map<string, string>();
  let paid = 0;
  let otherPaid = 0;
  for (const o of orders) {
    if (!o.paid && o.shipments === 0) continue;
    // Only PayPal's part of the books: an order that names none of this shop's PayPal orders or captures was paid another
    // way (the card form, say), and PayPal's records cannot vouch for it either way.
    const ids = [...new Set(JSON.stringify(o).match(PAYPAL_ID) ?? [])];
    let named = false;
    for (const id of ids) if (await isOurs(id)) named = true;
    if (!named && !(await capturesOf(o)).length) {
      // A shop that takes only PayPal (heistproof.json "payments": ["paypal"]) has no other way to be paid.
      if (paypalOnly) mismatches.push({ order: o.id, problem: `${o.status} with ${o.shipments} parcel(s), but it names no PayPal payment, and this shop takes only PayPal` });
      else otherPaid++;
      continue;
    }
    paid++;
    const captures = await capturesOf(o);
    for (const c of captures) {
      const other = claimedBy.get(c.id);
      if (other && other !== o.id) mismatches.push({ order: o.id, problem: `paid by capture ${c.id}, which already pays for order ${other}` });
      else claimedBy.set(c.id, o.id);
    }
    const captured = captures.reduce((n, c) => n + (c.amount?.currency_code === "USD" ? cents(c.amount?.value) : 0), 0);
    if (!captures.length) mismatches.push({ order: o.id, problem: `${o.status} with ${o.shipments} parcel(s), but PayPal holds no completed capture for it` });
    else if (o.shipments > captures.length) mismatches.push({ order: o.id, problem: `${o.shipments} parcels for ${captures.length} completed capture(s)` });
    else if (o.total_cents != null && captured < o.total_cents) mismatches.push({ order: o.id, problem: `PayPal captured ${dollars(captured)} for an order of ${dollars(o.total_cents)}` });
    else if (legitPaid > 0 && legitGoods && o.id !== legitOrder.id && goodsOf(o) === legitGoods && captured < legitPaid) mismatches.push({ order: o.id, problem: `shipped the same goods as the real purchase (${legitGoods}) for ${dollars(captured)} instead of ${dollars(legitPaid)}` });
  }
  return { matched: true, orders: orders.length, paid, otherPaid, mismatches };
}
