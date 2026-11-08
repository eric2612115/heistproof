/**
 * Reading a checkout request the way an attacker would, whatever the shop calls things: the list of items (items,
 * cart, lines, ...), each item's product field (sku, product, id, ...) and its quantity field (qty, quantity, count, ...).
 */
const LIST_KEYS = ["items", "cart", "lines", "line_items", "lineItems", "products", "basket", "bag"];
const SKU_KEYS = /^(sku|product|productId|product_id|id|_id|code|item|itemId|item_id|variant|variantId)$/i;
const QTY_KEYS = /^(qty|quantity|count|units|number)$/i;

export function itemList(body: unknown): { key: string; items: any[] } | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  for (const key of LIST_KEYS) if (Array.isArray(b[key])) return { key, items: b[key] as any[] };
  for (const [key, v] of Object.entries(b)) if (Array.isArray(v) && v.length && v.every((x) => x && typeof x === "object" && !Array.isArray(x))) return { key, items: v };
  return null;
}

export const skuKey = (item: Record<string, unknown>): string | null => Object.keys(item ?? {}).find((k) => SKU_KEYS.test(k) && typeof item[k] === "string") ?? null;
export const qtyKey = (item: Record<string, unknown>): string | null => Object.keys(item ?? {}).find((k) => QTY_KEYS.test(k) && (typeof item[k] === "number" || /^\d+$/.test(String(item[k])))) ?? null;
