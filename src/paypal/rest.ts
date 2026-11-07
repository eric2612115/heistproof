import { paypal } from "../config.ts";

export type PayPalResponse<T = any> = { status: number; debugId: string | null; body: T };

let token: { value: string; expires: number; for: string } | null = null;

async function accessToken(): Promise<string> {
  // One token per PayPal target: the sandbox, or this run's offline stand-in.
  const target = `${paypal.apiBase()} ${paypal.clientId()}`;
  if (token && token.for === target && token.expires > Date.now() + 60_000) return token.value;
  const auth = Buffer.from(`${paypal.clientId()}:${paypal.clientSecret()}`).toString("base64");
  const res = await fetch(`${paypal.apiBase()}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const body = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !body.access_token) throw new Error(`PayPal OAuth failed (${res.status}): ${body.error_description ?? "unknown"}`);
  token = { value: body.access_token, expires: Date.now() + (body.expires_in ?? 300) * 1000, for: target };
  return token.value;
}

/** The harness's own PayPal REST calls (reading orders, managing the webhook). Never used by the shop. */
export async function pp<T = any>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<PayPalResponse<T>> {
  const res = await fetch(`${paypal.apiBase()}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }
  return { status: res.status, debugId: res.headers.get("paypal-debug-id"), body: parsed };
}

export const getOrder = (id: string) => pp("GET", `/v2/checkout/orders/${encodeURIComponent(id)}`);

export function orderAmount(order: any): { value: string; currency: string } | null {
  const amount = order?.purchase_units?.[0]?.amount;
  return amount ? { value: amount.value, currency: amount.currency_code } : null;
}

/** Asks PayPal whether a webhook delivery is genuine: signed by PayPal for this webhook, body unchanged. */
export async function verifyDelivery(headers: Record<string, string>, rawBody: string, webhookId: string): Promise<boolean> {
  let event: unknown;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return false;
  }
  const r = await pp("POST", "/v1/notifications/verify-webhook-signature", {
    auth_algo: headers["paypal-auth-algo"],
    cert_url: headers["paypal-cert-url"],
    transmission_id: headers["paypal-transmission-id"],
    transmission_sig: headers["paypal-transmission-sig"],
    transmission_time: headers["paypal-transmission-time"],
    webhook_id: webhookId,
    webhook_event: event,
  }).catch(() => null);
  return r?.status === 200 && r.body?.verification_status === "SUCCESS";
}

export function orderCapture(order: any): any | null {
  return order?.purchase_units?.[0]?.payments?.captures?.[0] ?? null;
}

export const WEBHOOK_EVENTS = [
  "CHECKOUT.ORDER.APPROVED",
  "CHECKOUT.ORDER.COMPLETED",
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.DENIED",
  "PAYMENT.CAPTURE.PENDING",
  "PAYMENT.CAPTURE.REFUNDED",
  "PAYMENT.CAPTURE.REVERSED",
];
