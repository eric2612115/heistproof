// Day-1 sandbox probes: OAuth, create an order, capture it with PayPal's negative-testing header (unapproved and
// approved later), and list webhooks. Prints PayPal's answers and debug ids, never credentials.
import { pp } from "../src/paypal/rest.ts";

const order = await pp("POST", "/v2/checkout/orders", {
  intent: "CAPTURE",
  purchase_units: [{ custom_id: "PROBE-1", amount: { currency_code: "USD", value: "49.00", breakdown: { item_total: { currency_code: "USD", value: "49.00" } } }, items: [{ name: "Probe hoodie", quantity: "1", unit_amount: { currency_code: "USD", value: "49.00" } }] }],
});
console.log("create", order.status, order.debugId, order.body?.id, order.body?.status);
const id = order.body?.id;

for (const code of ["INSTRUMENT_DECLINED", "TRANSACTION_REFUSED"]) {
  const r = await pp("POST", `/v2/checkout/orders/${id}/capture`, {}, { "PayPal-Mock-Response": JSON.stringify({ mock_application_codes: code }) });
  console.log(`capture+mock ${code}`, r.status, r.debugId, r.body?.name, r.body?.details?.[0]?.issue, r.body?.message?.slice?.(0, 120));
}
const plain = await pp("POST", `/v2/checkout/orders/${id}/capture`, {});
console.log("capture (no mock, unapproved)", plain.status, plain.debugId, plain.body?.name, plain.body?.details?.[0]?.issue);

const hooks = await pp("GET", "/v1/notifications/webhooks");
console.log("webhooks", hooks.status, (hooks.body?.webhooks ?? []).map((w: any) => ({ id: w.id, url: w.url, events: w.event_types?.length })));
console.log(`\nApprove this order as the sandbox buyer to probe an approved capture: https://www.sandbox.paypal.com/checkoutnow?token=${id}`);
