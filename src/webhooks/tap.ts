import http from "node:http";

export type Delivery = {
  at: string;
  /** paypal: arrived with PayPal's signature headers and an event; attacker: sent by an attack; unknown: anything else. */
  source: "paypal" | "attacker" | "unknown";
  /** PayPal's own answer to verify-webhook-signature for this delivery (null when not asked). */
  paypalVerified?: boolean | null;
  eventId: string | null;
  eventType: string | null;
  resourceId: string | null;
  headers: Record<string, string>;
  rawBody: string;
  shopStatus: number;
  shopBody: string;
};

const PAYPAL_HEADERS = ["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"];

/**
 * Receives PayPal's webhook deliveries through the public tunnel, keeps an exact copy of each one
 * (headers and raw body, so it can be replayed byte for byte), and forwards it to the shop.
 */
export class WebhookTap {
  readonly deliveries: Delivery[] = [];
  private server: http.Server | null = null;
  private waiters: Array<{ match: (d: Delivery) => boolean; resolve: (d: Delivery) => void }> = [];

  /** Set once the webhook id is known: asks PayPal whether a delivery is genuine. Only verified deliveries count as PayPal's. */
  verifier: ((headers: Record<string, string>, rawBody: string) => Promise<boolean>) | null = null;

  /** Set once the webhook id is known: asks PayPal to resend this run's events of a type about some ids (see resendEvents). */
  resender: ((eventType: string, ids: string[]) => Promise<string[]>) | null = null;

  /** Every time Heistproof asked PayPal to resend an event the sandbox had not delivered, for the run's evidence. */
  readonly resends: Array<{ at: string; eventType: string; ids: string[]; resent: string[] }> = [];

  constructor(private shopWebhookUrl: string) {}

  async start(port: number) {
    this.server = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const rawBody = Buffer.concat(chunks).toString("utf8");
      const headers: Record<string, string> = {};
      for (const h of [...PAYPAL_HEADERS, "content-type", "user-agent"]) {
        const v = req.headers[h];
        if (typeof v === "string") headers[h] = v;
      }
      // Anything can reach a public address; only a signed PayPal event counts as PayPal's.
      let eventType: unknown = null;
      try {
        eventType = JSON.parse(rawBody)?.event_type;
      } catch {
        /* not JSON */
      }
      const signed = PAYPAL_HEADERS.every((h) => headers[h]) && typeof eventType === "string";
      const delivery = await this.forward(signed ? "paypal" : "unknown", headers, rawBody);
      res.writeHead(delivery.shopStatus === 0 ? 502 : delivery.shopStatus, { "content-type": "text/plain" });
      res.end(delivery.shopBody.slice(0, 200));
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(port, "127.0.0.1", resolve);
    });
  }

  /** Sends a delivery to the shop exactly as given and records what the shop answered. */
  async forward(source: Delivery["source"], headers: Record<string, string>, rawBody: string): Promise<Delivery> {
    let event: any = null;
    try {
      event = JSON.parse(rawBody);
    } catch {
      /* not JSON */
    }
    let shopStatus = 0;
    let shopBody = "";
    try {
      const r = await fetch(this.shopWebhookUrl, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: rawBody });
      shopStatus = r.status;
      shopBody = await r.text();
    } catch (err) {
      shopBody = String(err);
    }
    const delivery: Delivery = {
      at: new Date().toISOString(),
      source,
      eventId: event?.id ?? null,
      eventType: event?.event_type ?? null,
      resourceId: event?.resource?.id ?? null,
      headers,
      rawBody,
      shopStatus,
      shopBody: shopBody.slice(0, 500),
    };
    this.deliveries.push(delivery);
    if (source === "paypal" && this.verifier) {
      delivery.paypalVerified = await this.verifier(headers, rawBody).catch(() => null);
    }
    if (source === "paypal" && this.isPayPal(delivery)) {
      for (const w of [...this.waiters]) {
        if (w.match(delivery)) {
          this.waiters.splice(this.waiters.indexOf(w), 1);
          w.resolve(delivery);
        }
      }
    }
    return delivery;
  }

  /**
   * PayPal's own delivery: it came with PayPal's signature headers and, when a verifier is set, PayPal's
   * verify-webhook-signature said SUCCESS. Headers alone can be copied by anyone who reaches the public tunnel.
   */
  isPayPal(d: Delivery): boolean {
    return d.source === "paypal" && (!this.verifier || d.paypalVerified === true);
  }

  /**
   * Waits for PayPal's delivery of an event; halfway through, asks PayPal to resend this run's events of that type about
   * `ids` to this run's webhook (the sandbox sometimes never delivers an event on its own), then waits the rest.
   */
  async waitOrAsk(match: (d: Delivery) => boolean, eventType: string, ids: Array<string | null | undefined>, timeoutMs = 90_000): Promise<Delivery | null> {
    const first = await this.waitFor(match, Math.round(timeoutMs / 2));
    if (first || !this.resender) return first;
    const wanted = ids.filter((x): x is string => typeof x === "string" && x.length > 0);
    const resent = await this.resender(eventType, wanted).catch(() => [] as string[]);
    this.resends.push({ at: new Date().toISOString(), eventType, ids: wanted, resent });
    return resent.length ? this.waitFor(match, Math.round(timeoutMs / 2)) : null;
  }

  /** Waits for a genuine PayPal delivery that matches. */
  waitFor(match: (d: Delivery) => boolean, timeoutMs = 90_000): Promise<Delivery | null> {
    const existing = this.deliveries.find((d) => this.isPayPal(d) && match(d));
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve) => {
      const waiter = { match, resolve: (d: Delivery | null) => resolve(d) };
      this.waiters.push(waiter as any);
      setTimeout(() => {
        const i = this.waiters.indexOf(waiter as any);
        if (i >= 0) {
          this.waiters.splice(i, 1);
          resolve(null);
        }
      }, timeoutMs);
    });
  }

  genuine(type?: string) {
    return this.deliveries.filter((d) => this.isPayPal(d) && (!type || d.eventType === type));
  }

  async stop() {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }
}
