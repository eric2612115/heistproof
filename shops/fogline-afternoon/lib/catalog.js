// Product catalog. Prices are integer cents, the same unit the card processor charges in.
export const products = [
  {
    sku: "FOG-HOODIE",
    name: "Fogline Hoodie",
    blurb: "Heavyweight brushed fleece, garment-dyed in harbor fog grey.",
    priceCents: 4900,
    image: "/img/hoodie.svg",
  },
  {
    sku: "HARBOR-BEANIE",
    name: "Harbor Beanie",
    blurb: "Ribbed merino blend. Folds down when the wind turns.",
    priceCents: 2400,
    image: "/img/beanie.svg",
  },
  {
    sku: "FOGHORN-STICKER",
    name: "Foghorn Sticker",
    blurb: "Die-cut vinyl. Survives a dishwasher, probably.",
    priceCents: 300,
    image: "/img/sticker.svg",
  },
];

export function findProduct(sku) {
  return products.find((p) => p.sku === sku) ?? null;
}
