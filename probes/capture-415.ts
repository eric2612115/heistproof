// Does PayPal's capture endpoint refuse a request with no body and no Content-Type? (It is a POST with an optional body.)
import { paypal } from "../src/config.ts";
const id = process.argv[2];
const auth = Buffer.from(`${paypal.clientId()}:${paypal.clientSecret()}`).toString("base64");
const tok = (await (await fetch(`${paypal.apiBase()}/v1/oauth2/token`, { method: "POST", headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" })).json()).access_token;
const r = await fetch(`${paypal.apiBase()}/v2/checkout/orders/${id}/capture`, { method: "POST", headers: { Authorization: `Bearer ${tok}` } });
const b = await r.json().catch(() => ({}));
console.log("no body, no content-type:", r.status, b.name ?? b.status, r.headers.get("paypal-debug-id"));
