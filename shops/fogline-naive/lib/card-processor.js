import { randomUUID } from "node:crypto";

// Client for the shop's card processor, in test mode. Amounts are integer cents.
// Any card number works, except numbers ending in 0002, which are declined.
export function createCardProcessor({ apiKey }) {
  if (!apiKey) throw new Error("card processor key missing");
  const seen = new Map();
  return {
    charges: {
      async create({ amount, currency, source, idempotencyKey, description }) {
        if (!Number.isInteger(amount) || amount <= 0) throw new Error("amount must be a positive integer number of cents");
        if (idempotencyKey && seen.has(idempotencyKey)) return seen.get(idempotencyKey);
        const number = String(source?.number ?? "").replace(/\D/g, "");
        const declined = number.length < 12 || number.endsWith("0002");
        const charge = {
          id: `ch_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
          object: "charge",
          amount,
          currency,
          description,
          status: declined ? "failed" : "succeeded",
          failure_message: declined ? "Your card was declined." : null,
          card_last4: number.slice(-4),
        };
        if (idempotencyKey) seen.set(idempotencyKey, charge);
        return charge;
      },
    },
  };
}
