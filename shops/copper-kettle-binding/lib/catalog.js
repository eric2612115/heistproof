// Prices live here, on the server. The browser only ever says which products and how many.
export const CATALOG = {
  "KC-KETTLE": { name: "Copper Kettle", cents: 6400, blurb: "Hand-hammered copper, 1.5 litres, brass whistle." },
  "KC-MUG": { name: "Enamel Mug", cents: 1800, blurb: "Speckled enamel, 350 ml." },
  "KC-TOWEL": { name: "Linen Tea Towel", cents: 1200, blurb: "Stonewashed linen, 50 x 70 cm." },
};

const MAX_LINES = 10;
const MAX_COUNT = 10;

/** Validates a cart sent by the browser and prices it from the catalog. Throws a shopper-readable message. */
export function priceLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) throw new Error("Your cart is empty.");
  if (lines.length > MAX_LINES) throw new Error("Too many lines in the cart.");
  const merged = new Map();
  for (const line of lines) {
    const product = CATALOG[line?.product];
    if (!product) throw new Error("A product in your cart no longer exists.");
    const count = line.count;
    if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) throw new Error(`You can buy 1 to ${MAX_COUNT} of each product.`);
    merged.set(line.product, (merged.get(line.product) ?? 0) + count);
  }
  const priced = [...merged].map(([sku, count]) => {
    if (count > MAX_COUNT) throw new Error(`You can buy 1 to ${MAX_COUNT} of each product.`);
    return { product: sku, name: CATALOG[sku].name, count, unit_cents: CATALOG[sku].cents };
  });
  return { lines: priced, total_cents: priced.reduce((n, l) => n + l.count * l.unit_cents, 0) };
}

export const dollars = (cents) => (cents / 100).toFixed(2);
