import { findProduct } from "./catalog.js";

export const MAX_QTY_PER_LINE = 10;

// Prices a cart from the catalog. The browser only ever sends SKUs and quantities.
export function priceCart(items) {
  if (!Array.isArray(items) || items.length === 0) throw new Error("Your bag is empty.");
  const lines = [];
  for (const item of items) {
    const product = findProduct(item?.sku);
    if (!product) throw new Error(`Unknown product: ${String(item?.sku)}`);
    const qty = Number(item?.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY_PER_LINE) throw new Error(`Bad quantity for ${product.name}.`);
    lines.push({ sku: product.sku, name: product.name, qty, unitCents: product.priceCents, lineCents: product.priceCents * qty });
  }
  const totalCents = lines.reduce((sum, line) => sum + line.lineCents, 0);
  return { lines, totalCents, currency: "usd" };
}

export function formatMoney(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}
