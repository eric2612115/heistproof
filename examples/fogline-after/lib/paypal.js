import { PaypalClient, PaypalError, CheckoutPaymentIntent } from "paypal";

// The ONE place cents (shop/catalog unit) become PayPal decimal dollars.
// 4900 -> "49.00", 5 -> "0.05". Never via floating point.
export function formatPayPalAmount(cents) {
  if (!Number.isInteger(cents) || cents < 0) throw new Error("amount must be a non-negative integer number of cents");
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

// Exact inverse for amounts PayPal returns ("49.00" -> 4900). Rejects anything
// that is not a plain decimal with at most two fraction digits.
export function parsePayPalAmount(value) {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value ?? "").trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || 0);
}

export class PayPalServiceError extends Error {
  constructor(message, { httpStatus = 502, paypalStatus = null, issue = null, outcomeUnknown = false, neverSent = false } = {}) {
    super(message);
    this.name = "PayPalServiceError";
    this.httpStatus = httpStatus;
    this.paypalStatus = paypalStatus;
    this.issue = issue;
    this.outcomeUnknown = outcomeUnknown;
    this.neverSent = neverSent;
  }
}

function payloadReason(err) {
  const payload = err?.payload;
  if (!payload || typeof payload !== "object") return null;
  if ("rawBody" in payload) return null; // undeclared arm: raw bytes, no trusted reason
  const body = payload.body;
  if (!body || typeof body !== "object") return null;
  const parts = [body.message, ...(Array.isArray(body.details) ? body.details.map((d) => d?.description || d?.issue) : [])].filter(Boolean);
  return parts.length ? [...new Set(parts)].join(": ") : null;
}

function payloadIssues(err) {
  const body = err?.payload && "body" in err.payload ? err.payload.body : null;
  if (!body || !Array.isArray(body.details)) return [];
  return body.details.map((d) => d?.issue).filter(Boolean);
}

function payloadDebugId(err) {
  const body = err?.payload && "body" in err.payload ? err.payload.body : null;
  return body?.debugId ?? null;
}

// One translation ladder for every SDK call (plan 1b.4). Arm tags are
// per-operation and are never switched on; err.status is the discriminator.
export function translatePayPalError(err) {
  if (err instanceof PayPalServiceError) return err;
  if (!(err instanceof PaypalError)) return null; // outside the family: caller rethrows
  const debugId = payloadDebugId(err);
  if (debugId) console.error(`[paypal] api error debug_id=${debugId} status=${err.status ?? ""} kind=${err.kind}`);
  switch (err.kind) {
    case "api": {
      const issues = payloadIssues(err);
      const issue = issues[0] ?? null;
      if (err.status === 401 || err.status === 403) {
        return new PayPalServiceError("Payment provider unavailable.", { httpStatus: 502, paypalStatus: err.status, issue, neverSent: false });
      }
      if (err.status === 429) {
        return new PayPalServiceError("Payment provider temporarily unavailable.", { httpStatus: 503, paypalStatus: err.status, issue });
      }
      if (err.status >= 400 && err.status < 500) {
        return new PayPalServiceError(payloadReason(err) ?? "Payment request rejected.", { httpStatus: err.status, paypalStatus: err.status, issue });
      }
      return new PayPalServiceError("Payment provider error.", { httpStatus: 502, paypalStatus: err.status, issue });
    }
    case "decode":
      // 2xx we cannot read = outcome unknown; on an error status the provider
      // did reject, only the detail was lost.
      if (err.status >= 200 && err.status < 300) {
        return new PayPalServiceError("Payment outcome unknown.", { httpStatus: 502, paypalStatus: err.status, outcomeUnknown: true });
      }
      if (err.status >= 400 && err.status < 500) {
        return new PayPalServiceError("Payment request rejected.", { httpStatus: err.status, paypalStatus: err.status });
      }
      return new PayPalServiceError("Payment provider error.", { httpStatus: 502, paypalStatus: err.status });
    case "connection":
    case "timeout":
      return new PayPalServiceError("Payment outcome unknown.", { httpStatus: 502, outcomeUnknown: true });
    case "auth":
    case "encode":
      // Nothing was sent: our credentials / our bug, never a buyer failure.
      return new PayPalServiceError("Payment provider unavailable.", { httpStatus: 502, neverSent: true });
    default:
      return new PayPalServiceError("Payment provider error.", { httpStatus: 502 });
  }
}

function isUnknown(err) {
  const t = translatePayPalError(err);
  return Boolean(t?.outcomeUnknown);
}

// Assess what PayPal holds for a shop order. Pure: SDK Order (camelCase) in.
export function assessPayPalOrder(paypalOrder, shopOrder) {
  const totalCents = shopOrder.total_cents;
  const currency = String(shopOrder.currency ?? "").toUpperCase();
  let sawPending = false;
  let sawCapture = false;
  let sawMismatch = false;
  for (const unit of paypalOrder?.purchaseUnits ?? []) {
    const unitCustomId = unit?.customId;
    for (const capture of unit?.payments?.captures ?? []) {
      sawCapture = true;
      if (capture.status === "PENDING") sawPending = true;
      if (capture.status !== "COMPLETED") continue;
      const customId = capture.customId ?? unitCustomId;
      const cents = capture.amount ? parsePayPalAmount(capture.amount.value) : null;
      const captureCurrency = String(capture.amount?.currencyCode ?? "").toUpperCase();
      if (customId === shopOrder.id && cents === totalCents && captureCurrency === currency) {
        return { state: "completed", capture };
      }
      sawMismatch = true;
    }
    // A purchase unit explicitly bound to a different shop order can never settle this one.
    if (unitCustomId && unitCustomId !== shopOrder.id && (unit?.payments?.captures ?? []).some((c) => c.status === "COMPLETED")) {
      sawMismatch = true;
    }
  }
  if (sawMismatch) return { state: "mismatch", capture: null };
  if (sawPending) return { state: "pending", capture: null };
  if (sawCapture) return { state: "not_completed", capture: null };
  return { state: "none", capture: null };
}

export function createPayPalService({ clientId, clientSecret, webhookId, baseUrl, testBuyerCountry, fetchImpl } = {}) {
  if (!clientId) throw new Error("PAYPAL_CLIENT_ID is not configured");
  if (!clientSecret) throw new Error("PAYPAL_CLIENT_SECRET is not configured");
  const resolvedBase = String(baseUrl || "https://api-m.sandbox.paypal.com").replace(/\/+$/, "");
  const transport = fetchImpl ?? globalThis.fetch;
  if (typeof transport !== "function") throw new Error("no fetch available for PayPal client");

  // Built once and held: OAuth token cache and memoized resources live on it.
  // No ServerEnvironment exists on this SDK; the host is the serverOptions.baseUrl
  // override. Both the operations and the OAuth token request track this base.
  const client = new PaypalClient({
    serverOptions: { baseUrl: resolvedBase },
    oauth2: { clientId, clientSecret },
    logging: { level: "off" },
    ...(fetchImpl ? { fetch: (request) => transport(request) } : {}),
  });

  let cachedToken = null; // { value, expiresAt } for webhook verification only

  async function getAccessToken() {
    if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value;
    const res = await transport(`${resolvedBase}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw new PayPalServiceError("Payment provider unavailable.", { httpStatus: 502, neverSent: true });
    const body = await res.json();
    if (!body?.access_token) throw new PayPalServiceError("Payment provider unavailable.", { httpStatus: 502, neverSent: true });
    cachedToken = { value: body.access_token, expiresAt: Date.now() + Number(body.expires_in ?? 3600) * 1000 };
    return cachedToken.value;
  }

  const service = {
    client,
    clientId,
    baseUrl: resolvedBase,

    getBrowserConfig() {
      let sdkUrl = "https://www.sandbox.paypal.com/web-sdk/v6/core";
      try {
        const host = new URL(resolvedBase).hostname;
        if (host === "api-m.paypal.com") sdkUrl = "https://www.paypal.com/web-sdk/v6/core";
      } catch { /* keep sandbox default for local/fake bases */ }
      const isSandbox = sdkUrl.includes("sandbox");
      return {
        clientId,
        sdkUrl,
        currencyCode: "USD",
        ...(isSandbox && testBuyerCountry ? { testBuyerCountry } : {}),
      };
    },

    // claimReference is the shop order id; it is sent as PayPal-Request-Id so a
    // re-issue after an unknown outcome is deduped by PayPal (plan 1b.1).
    async createOrder({ shopOrderId, cart, email }) {
      const currencyCode = String(cart.currency).toUpperCase();
      const request = {
        payPalRequestId: shopOrderId,
        body: {
          intent: CheckoutPaymentIntent.Capture,
          purchaseUnits: [
            {
              referenceId: shopOrderId,
              customId: shopOrderId,
              invoiceId: shopOrderId,
              amount: {
                currencyCode,
                value: formatPayPalAmount(cart.totalCents),
                breakdown: { itemTotal: { currencyCode, value: formatPayPalAmount(cart.totalCents) } },
              },
              items: cart.lines.map((line) => ({
                name: line.name,
                unitAmount: { currencyCode, value: formatPayPalAmount(line.unitCents) },
                quantity: String(line.qty),
                sku: line.sku,
              })),
            },
          ],
        },
      };
      const attempt = async () => {
        const order = await client.orders.createOrder(request);
        if (!order?.id) {
          throw new PayPalServiceError("Payment outcome unknown.", { httpStatus: 502, outcomeUnknown: true });
        }
        return order;
      };
      try {
        return await attempt();
      } catch (err) {
        const translated = translatePayPalError(err);
        if (!translated) throw err;
        if (!translated.outcomeUnknown) throw translated;
        // Unknown: the create may have reached PayPal. Re-issue once with the
        // SAME PayPal-Request-Id (stored on the claim); never report "failed".
        try {
          return await attempt();
        } catch (retryErr) {
          const t2 = translatePayPalError(retryErr);
          if (!t2) throw retryErr;
          throw t2.outcomeUnknown ? new PayPalServiceError("Payment outcome unknown.", { httpStatus: 502, outcomeUnknown: true }) : t2;
        }
      }
    },

    async getOrder(paypalOrderId) {
      try {
        const order = await client.orders.getOrder({ id: paypalOrderId });
        if (!order?.id) throw new PayPalServiceError("Payment outcome unknown.", { httpStatus: 502, outcomeUnknown: true });
        return order;
      } catch (err) {
        const translated = translatePayPalError(err);
        if (!translated) throw err;
        throw translated;
      }
    },

    // On ORDER_ALREADY_CAPTURED or any unknown outcome, settle from what
    // PayPal holds via getOrder — never resend the capture blindly.
    async captureOrder(paypalOrderId, claimKey) {
      try {
        const order = await client.orders.captureOrder({
          id: paypalOrderId,
          payPalRequestId: claimKey,
          prefer: "return=representation",
          // Real sandbox (debug id ca56775236e7a) rejects a capture with no
          // body / no Content-Type: 415 UNSUPPORTED_MEDIA_TYPE. Sending an
          // empty JSON object makes the SDK send "{}" as application/json.
          // The SDK map calls the body optional, but PayPal's answer wins.
          body: {},
        });
        if (!order?.id || !order?.purchaseUnits) {
          // Thin 2xx: outcome unknown until re-read.
          return await service.getOrder(paypalOrderId);
        }
        return order;
      } catch (err) {
        const translated = translatePayPalError(err);
        if (!translated) throw err;
        const alreadyCaptured = translated.issue === "ORDER_ALREADY_CAPTURED" || payloadIssues(err).includes("ORDER_ALREADY_CAPTURED");
        if (alreadyCaptured || translated.outcomeUnknown) {
          try {
            return await service.getOrder(paypalOrderId);
          } catch {
            throw translated; // still unknown (or already-captured but unreadable): never "failed"
          }
        }
        throw translated;
      }
    },

    // The SDK has no webhook operation; verification goes to the same
    // configured base URL (plan: webhook verification section).
    async verifyWebhook(headers, event) {
      if (!webhookId) throw new PayPalServiceError("Payment provider unavailable.", { httpStatus: 502, neverSent: true });
      const token = await getAccessToken();
      const res = await transport(`${resolvedBase}/v1/notifications/verify-webhook-signature`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          auth_algo: headers.authAlgo,
          cert_url: headers.certUrl,
          transmission_id: headers.transmissionId,
          transmission_sig: headers.transmissionSig,
          transmission_time: headers.transmissionTime,
          webhook_id: webhookId,
          webhook_event: event,
        }),
      });
      if (!res.ok) return false;
      const body = await res.json().catch(() => null);
      return body?.verification_status === "SUCCESS";
    },
  };
  return service;
}

export function createPayPalServiceFromEnv(env = process.env, fetchImpl) {
  return createPayPalService({
    clientId: env.PAYPAL_CLIENT_ID,
    clientSecret: env.PAYPAL_CLIENT_SECRET,
    webhookId: env.PAYPAL_WEBHOOK_ID,
    baseUrl: env.PAYPAL_API_BASE || "https://api-m.sandbox.paypal.com",
    testBuyerCountry: env.PAYPAL_TEST_BUYER_COUNTRY || undefined,
    fetchImpl,
  });
}
