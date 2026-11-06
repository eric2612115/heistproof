import { PaypalClient, PaypalError } from "paypal";

// Server-side PayPal integration. Every Orders call goes through the APIMatic SDK
// (package `paypal`, client PaypalClient); the SDK's map/contract live in
// paypal-plan.md. Webhook signature verification has no SDK operation, so that one
// REST call is made directly — against the same PAYPAL_API_BASE, with a
// client-credentials token from the same base.

const DEFAULT_BASE = "https://api-m.sandbox.paypal.com";

// Catalog prices are integer cents; PayPal amounts are decimal strings in dollars.
// This is the one conversion function (rule: 4900 -> "49.00", 5 -> "0.05").
export function centsToPayPalAmount(cents) {
  if (!Number.isInteger(cents) || cents < 0) throw new Error("amount must be a non-negative integer number of cents");
  const dollars = Math.floor(cents / 100);
  const remainder = cents % 100;
  return `${dollars}.${String(remainder).padStart(2, "0")}`;
}

// Strict inverse: only PayPal's canonical "D.CC" shape counts. Returns null otherwise.
export function payPalAmountToCents(value) {
  if (typeof value !== "string") return null;
  const m = /^(\d+)\.(\d{2})$/.exec(value);
  if (!m) return null;
  return Number(m[1]) * 100 + Number(m[2]);
}

export class PayPalUpstreamError extends Error {
  constructor(httpStatus, message, { issue = null, outcomeUnknown = false, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "PayPalUpstreamError";
    this.httpStatus = httpStatus;
    this.issue = issue;
    this.outcomeUnknown = outcomeUnknown;
  }
}

function decodeRawBody(rawBody) {
  if (!rawBody) return null;
  try {
    return JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return null;
  }
}

// The API's reason, where it sent one: typed Error arm body, else parsed raw bytes.
function apiReasonAndIssue(err) {
  let body = null;
  const payload = err?.payload;
  if (payload && typeof payload === "object") {
    if (payload.body && typeof payload.body === "object") body = payload.body;
    else if ("rawBody" in payload) body = decodeRawBody(payload.rawBody);
  }
  if (!body) return { reason: null, issue: null };
  const details = Array.isArray(body.details) ? body.details : [];
  const issue = details.find((d) => d?.issue)?.issue ?? null;
  const parts = [body.message, ...details.map((d) => d?.description || d?.issue)].filter(Boolean);
  return { reason: parts.length ? [...new Set(parts)].join(" ") : null, issue };
}

// One error ladder for every call site (paypal-plan.md 1b.4). SDK err.message is
// logged by callers, never returned: it names the URL we dialled.
function translateError(err, { isWrite = false } = {}) {
  if (err instanceof PayPalUpstreamError) return err;
  if (err instanceof PaypalError || (err && typeof err === "object" && "kind" in err && "uri" in err)) {
    switch (err.kind) {
      case "api": {
        const { reason, issue } = apiReasonAndIssue(err);
        if (err.status === 401 || err.status === 403) {
          return new PayPalUpstreamError(502, "PayPal payments are temporarily unavailable.", { issue, cause: err });
        }
        if (err.status === 429) {
          return new PayPalUpstreamError(503, "PayPal payments are temporarily unavailable.", { issue, cause: err });
        }
        if (err.status >= 400 && err.status < 500) {
          return new PayPalUpstreamError(err.status, reason ?? "PayPal rejected the request.", { issue, cause: err });
        }
        return new PayPalUpstreamError(502, "PayPal payments are temporarily unavailable.", { issue, cause: err });
      }
      case "connection":
      case "timeout":
        return new PayPalUpstreamError(502, isWrite ? "The payment outcome is unknown. Please do not pay again yet." : "PayPal payments are temporarily unavailable.", {
          outcomeUnknown: isWrite,
          cause: err,
        });
      case "decode":
        // A 2xx we cannot read is unknown on a write; an error status stays that status.
        if (err.status >= 200 && err.status < 300) {
          return new PayPalUpstreamError(502, isWrite ? "The payment outcome is unknown. Please do not pay again yet." : "PayPal payments are temporarily unavailable.", {
            outcomeUnknown: isWrite,
            cause: err,
          });
        }
        if (err.status === 401 || err.status === 403) return new PayPalUpstreamError(502, "PayPal payments are temporarily unavailable.", { cause: err });
        if (err.status >= 400 && err.status < 500) return new PayPalUpstreamError(err.status, "PayPal rejected the request.", { cause: err });
        return new PayPalUpstreamError(502, "PayPal payments are temporarily unavailable.", { cause: err });
      case "auth":
      case "encode":
      default:
        // Never sent (credential could not be obtained / value would not encode):
        // an integration fault, not a payment failure, and never re-read.
        return new PayPalUpstreamError(502, "PayPal payments are temporarily unavailable.", { cause: err });
    }
  }
  return err; // outside the SDK family: a bug or an abort reason — rethrow raw
}

function isNeverSent(err) {
  return err instanceof PaypalError && (err.kind === "auth" || err.kind === "encode");
}

function isUnknownOutcome(err) {
  if (!(err instanceof PaypalError)) return false;
  if (err.kind === "connection" || err.kind === "timeout") return true;
  if (err.kind === "decode" && err.status >= 200 && err.status < 300) return true;
  return false;
}

// Find the captures on a decoded Order and check the fulfilment gate against the
// shop order. Nothing here trusts optional members: Order fields are all optional
// in the SDK model, so absence is checked explicitly.
export function inspectOrder(order, { shopOrderId, totalCents, currency }) {
  const units = Array.isArray(order?.purchaseUnits) ? order.purchaseUnits : [];
  const captures = [];
  for (const unit of units) {
    for (const capture of unit?.payments?.captures ?? []) {
      captures.push({ capture, unit });
    }
  }
  if (!captures.length) return { state: "no_capture", orderStatus: order?.status ?? null };
  // Prefer a COMPLETED capture; otherwise report the most relevant one.
  const entry = captures.find((c) => c.capture?.status === "COMPLETED") ?? captures[0];
  const { capture, unit } = entry;
  if (!capture) return { state: "no_capture", orderStatus: order?.status ?? null };
  if (capture.status !== "COMPLETED") return { state: "capture_not_completed", captureStatus: capture.status ?? null, capture };
  const paidCents = payPalAmountToCents(capture.amount?.value);
  const paidCurrency = typeof capture.amount?.currencyCode === "string" ? capture.amount.currencyCode.toLowerCase() : null;
  if (paidCents === null || paidCents !== totalCents || paidCurrency !== String(currency).toLowerCase()) {
    return { state: "amount_mismatch", capture, paidCents };
  }
  const customIds = [unit?.customId, capture.customId].filter((v) => typeof v === "string" && v.length > 0);
  if (!customIds.length || customIds.some((v) => v !== shopOrderId)) {
    return { state: "binding_mismatch", capture };
  }
  if (!capture.id) return { state: "amount_mismatch", capture };
  return { state: "captured", capture, paidCents };
}

export function createPayPalService({
  clientId,
  clientSecret,
  baseUrl = DEFAULT_BASE,
  webhookId = null,
  testBuyerCountry = null,
  fetchImpl = null,
} = {}) {
  if (!clientId) throw new Error("PAYPAL_CLIENT_ID is not configured. Set it in the environment before starting the shop.");
  if (!clientSecret) throw new Error("PAYPAL_CLIENT_SECRET is not configured. Set it in the environment before starting the shop.");
  const base = String(baseUrl || DEFAULT_BASE).replace(/\/+$/, "");

  // Built once and held: resource getters and the OAuth token cache live on it.
  // No ServerEnvironment exists on this SDK; the host is the serverOptions.baseUrl
  // override, bound explicitly to PAYPAL_API_BASE here. Logging is pinned off in
  // code so PAYPAL_CLIENT_LOG cannot switch it on; request bodies are never logged.
  const clientOptions = {
    serverOptions: { baseUrl: base },
    oauth2: { clientId, clientSecret },
    logging: { level: "off" },
    retry: { timeout: 15_000 },
  };
  if (fetchImpl) clientOptions.fetch = fetchImpl;
  const client = new PaypalClient(clientOptions);

  const doFetch = fetchImpl ?? globalThis.fetch;
  let cachedToken = null;

  async function getAccessToken() {
    if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value;
    const basic = Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");
    let res;
    try {
      res = await doFetch(`${base}/v1/oauth2/token`, {
        method: "POST",
        headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
        body: "grant_type=client_credentials",
      });
    } catch (err) {
      throw new PayPalUpstreamError(502, "PayPal payments are temporarily unavailable.", { cause: err });
    }
    if (!res.ok) throw new PayPalUpstreamError(502, "PayPal payments are temporarily unavailable.");
    const data = await res.json().catch(() => null);
    if (!data?.access_token) throw new PayPalUpstreamError(502, "PayPal payments are temporarily unavailable.");
    const expiresIn = Number(data.expires_in);
    cachedToken = { value: data.access_token, expiresAt: Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 3600_000) };
    return cachedToken.value;
  }

  return {
    clientId,
    baseUrl: base,

    config() {
      const sdkUrl = base.includes("api-m.paypal.com") && !base.includes("sandbox")
        ? "https://www.paypal.com/web-sdk/v6/core"
        : "https://www.sandbox.paypal.com/web-sdk/v6/core";
      return { clientId, sdkUrl, currency: "USD", ...(testBuyerCountry ? { testBuyerCountry } : {}) };
    },

    // Create an order for a shop order already priced by the server. The body is
    // built only from the cart lines; no browser amount ever reaches this call.
    async createOrder({ shopOrderId, cart, payPalRequestId }) {
      const currencyCode = String(cart.currency).toUpperCase();
      const amount = { currencyCode, value: centsToPayPalAmount(cart.totalCents) };
      let order;
      try {
        order = await client.orders.createOrder({
          payPalRequestId,
          prefer: "return=representation",
          body: {
            intent: "CAPTURE",
            purchaseUnits: [
              {
                referenceId: shopOrderId,
                customId: shopOrderId,
                invoiceId: shopOrderId,
                amount: { ...amount, breakdown: { itemTotal: { ...amount } } },
                items: cart.lines.map((line) => ({
                  name: line.name,
                  sku: line.sku,
                  quantity: String(line.qty),
                  unitAmount: { currencyCode, value: centsToPayPalAmount(line.unitCents) },
                })),
              },
            ],
          },
        });
      } catch (err) {
        // A create that may have happened but taught us no id cannot be re-read
        // (no search-by-reference operation): unknown, never "failed".
        if (isUnknownOutcome(err)) {
          throw new PayPalUpstreamError(502, "The payment outcome is unknown. Please do not pay again yet.", { outcomeUnknown: true, cause: err });
        }
        throw translateError(err, { isWrite: true });
      }
      if (!order?.id) {
        throw new PayPalUpstreamError(502, "The payment outcome is unknown. Please do not pay again yet.", { outcomeUnknown: true });
      }
      return order;
    },

    async getOrder(paypalOrderId) {
      try {
        return await client.orders.getOrder({ id: paypalOrderId });
      } catch (err) {
        throw translateError(err, { isWrite: false });
      }
    },

    // Capture, and on any unknown outcome (or ORDER_ALREADY_CAPTURED) settle from
    // what PayPal holds by re-reading the order. Never-sent failures (auth/encode)
    // settle nothing and are never re-read.
    async captureOrder({ paypalOrderId, payPalRequestId }) {
      try {
        return await client.orders.captureOrder({ id: paypalOrderId, prefer: "return=representation", payPalRequestId });
      } catch (err) {
        const { issue } = err instanceof PaypalError && err.kind === "api" ? apiReasonAndIssue(err) : { issue: null };
        const settleable = isUnknownOutcome(err) || issue === "ORDER_ALREADY_CAPTURED";
        if (!settleable) throw translateError(err, { isWrite: true });
        if (isNeverSent(err)) throw translateError(err, { isWrite: true });
        try {
          return await client.orders.getOrder({ id: paypalOrderId });
        } catch (rereadErr) {
          throw new PayPalUpstreamError(502, "The payment outcome is unknown. Please do not pay again yet.", { outcomeUnknown: true, cause: rereadErr });
        }
      }
    },

    // The one non-SDK REST call (the SDK declares no webhook operation), made to
    // the same base with a client-credentials token. True only on SUCCESS.
    async verifyWebhook({ headers, event }) {
      if (!webhookId) return false;
      try {
        const token = await getAccessToken();
        const res = await doFetch(`${base}/v1/notifications/verify-webhook-signature`, {
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
        const data = await res.json().catch(() => null);
        return data?.verification_status === "SUCCESS";
      } catch {
        return false;
      }
    },
  };
}
