import { getOrder } from "./paypal/rest.ts";
import { shopOrders, type ShopProcess } from "./shop-process.ts";
import type { ProxiedCall } from "./paypal/proxy.ts";
import type { PurchaseResult } from "./prove.ts";

export type Books = {
  /** False when the shop's back office shows no PayPal ids at all, so its books cannot be matched to PayPal's. */
  matched: boolean;
  orders: number;
  paid: number;
  mismatches: Array<{ order: string; problem: string }>;
};

const PAYPAL_ID = /\b[0-9A-Z]{17}\b/g;

/**
 * The shop's books against PayPal's, after every robbery of a round: each order the shop treats as paid or has shipped
 * must be backed by a completed PayPal capture, and no order may ship more parcels than PayPal captured payments.
 * It catches what any robbery left behind, not only what that robbery checked itself.
 */
export async function reconcile(shop: ShopProcess, calls: ProxiedCall[], legit: PurchaseResult): Promise<Books> {
  const orders = await shopOrders(shop);
  const ours = new Set(calls.filter((c) => c.method === "POST" && c.path === "/v2/checkout/orders" && c.status < 300).map((c) => (c.responseBody as any)?.id).filter((x): x is string => typeof x === "string"));
  const legitRecord = legit.shopOrder ? JSON.stringify(orders.find((o) => o.id === legit.shopOrder!.id) ?? legit.shopOrder) : "";
  if (!legitRecord || !(legitRecord.match(PAYPAL_ID) ?? []).length) return { matched: false, orders: orders.length, paid: orders.filter((o) => o.paid || o.shipments > 0).length, mismatches: [] };

  const records = new Map<string, any>();
  const record = async (id: string) => {
    if (!records.has(id)) records.set(id, (await getOrder(id)).body);
    return records.get(id);
  };
  const completed = (r: any) => ((r?.purchase_units?.[0]?.payments?.captures ?? []) as any[]).filter((c) => c.status === "COMPLETED");

  const mismatches: Books["mismatches"] = [];
  let paid = 0;
  for (const o of orders) {
    if (!o.paid && o.shipments === 0) continue;
    paid++;
    const ids = [...new Set(JSON.stringify(o).match(PAYPAL_ID) ?? [])];
    const captures: any[] = [];
    for (const id of ids.filter((x) => ours.has(x))) captures.push(...completed(await record(id)));
    // A shop may keep only the capture's id: find the PayPal order that holds it.
    if (!captures.length) for (const id of ours) for (const c of completed(await record(id))) if (ids.includes(c.id)) captures.push(c);
    if (!captures.length) mismatches.push({ order: o.id, problem: `${o.status} with ${o.shipments} parcel(s), but PayPal holds no completed capture for it` });
    else if (o.shipments > captures.length) mismatches.push({ order: o.id, problem: `${o.shipments} parcels for ${captures.length} completed capture(s)` });
  }
  return { matched: true, orders: orders.length, paid, mismatches };
}
