import http from "node:http";

export type Delivery = {
  at: string;
  source: "paypal" | "attacker";
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
      const delivery = await this.forward("paypal", headers, rawBody);
      res.writeHead(delivery.shopStatus === 0 ? 502 : delivery.shopStatus, { "content-type": "text/plain" });
      res.end(delivery.shopBody.slice(0, 200));
    });
    await new Promise<void>((resolve) => this.server!.listen(port, "127.0.0.1", resolve));
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
    if (source === "paypal") {
      for (const w of [...this.waiters]) {
        if (w.match(delivery)) {
          this.waiters.splice(this.waiters.indexOf(w), 1);
          w.resolve(delivery);
        }
      }
    }
    return delivery;
  }

  /** Waits for a genuine PayPal delivery that matches. */
  waitFor(match: (d: Delivery) => boolean, timeoutMs = 90_000): Promise<Delivery | null> {
    const existing = this.deliveries.find((d) => d.source === "paypal" && match(d));
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
    return this.deliveries.filter((d) => d.source === "paypal" && (!type || d.eventType === type));
  }

  async stop() {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }
}
