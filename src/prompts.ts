export const MIGRATION_PROMPT = `A customer just asked this shop: "Do you take Venmo?" Today it takes cards only.

Add PayPal checkout to this shop so shoppers can pay with PayPal, Venmo or Pay Later next to the existing card form, and so the shop fulfils an order only after PayPal has really captured the right amount.

Use your skills, in this order:
1. APIMatic's PayPal Context Plugin for every server-side PayPal API call. Load paypal:typescript-integrate-paypal first and follow its plan-first workflow: install the SDK it names, read its SDK map, and write paypal-plan.md with the contract sheet before you edit any project file. The plugin's TypeScript skills also apply to this JavaScript (ESM) project.
2. heistproof:paypal-web-sdk-v6 for the browser buttons (PayPal, Venmo, Pay Later) and Pay Later messaging.
3. heistproof:checkout-hardening for the rules an attacker will test as soon as you finish.

Contract with the test harness (keep these names exactly):
- The server reads PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET and PAYPAL_WEBHOOK_ID from the environment, and the PayPal REST base URL from PAYPAL_API_BASE (default https://api-m.sandbox.paypal.com). Every PayPal REST call, including the OAuth token and webhook verification, goes to PAYPAL_API_BASE; pass it to the SDK as its base URL override.
- In sandbox the browser gets testBuyerCountry from PAYPAL_TEST_BUYER_COUNTRY (unset means do not send it).
- PayPal webhooks arrive at POST /api/paypal/webhooks.
- No PayPal credentials exist while you build, so make no live PayPal calls; the harness runs the shop against the PayPal sandbox after you finish.
- Keep the card checkout working and keep npm test green. Add tests for the new server code with a faked fetch (no network).
- Do not commit; the harness commits your work.

Finish with a short summary: the files you changed, the PayPal operations you used, and how you met each checkout-hardening rule.`;

export const BASELINE_PROMPT = `A customer just asked this shop: "Do you take Venmo?" Today it takes cards only.

Add PayPal checkout to this shop so shoppers can pay with PayPal, Venmo or Pay Later next to the existing card form.

Contract with the test harness (keep these names exactly): the server reads PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET and PAYPAL_WEBHOOK_ID from the environment and sends every PayPal REST call to PAYPAL_API_BASE (default https://api-m.sandbox.paypal.com); in sandbox the browser gets testBuyerCountry from PAYPAL_TEST_BUYER_COUNTRY; PayPal webhooks arrive at POST /api/paypal/webhooks. No PayPal credentials exist while you build, so make no live PayPal calls. Keep the card checkout working. Do not commit.

Finish with a short summary of what you changed.`;

export function fixPrompt(failures: Array<{ title: string; detail: string }>): string {
  return `Heistproof ran your checkout against the PayPal sandbox and attacked it. These checks failed:

${failures.map((f, i) => `${i + 1}. ${f.title}\n   ${f.detail}`).join("\n")}

Fix the code so each of these fails for the attacker, without breaking the card checkout or the PayPal buttons. Reload heistproof:checkout-hardening and the APIMatic PayPal skills if you need them, update paypal-plan.md if a contract changes, keep npm test green, and add a test for each fix. Do not commit. Finish with what you changed for each failure.`;
}
