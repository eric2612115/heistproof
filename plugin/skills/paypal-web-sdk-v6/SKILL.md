---
name: paypal-web-sdk-v6
description: "Browser side of a PayPal checkout with the PayPal JS SDK v6: loading the core script, createInstance, findEligibleMethods, the paypal-button / venmo-button / paypal-pay-later-button web components, one-time payment sessions and Pay Later messaging. Load this before writing any browser code that shows PayPal, Venmo or Pay Later. Server-side PayPal API calls are NOT covered here; use the APIMatic PayPal SDK skills for those."
---

# PayPal JS SDK v6 in the browser

Source: PayPal's official v6 sample integration (github.com/paypal-examples/v6-web-sdk-sample-integration, `client/components/*/oneTimePayment` and `paypalMessages`). v6 replaces the v5 `paypal.Buttons()` API; do not mix the two.

## 1. Load the core script once

```html
<script async src="https://www.sandbox.paypal.com/web-sdk/v6/core" onload="onPayPalWebSdkLoaded()"></script>
```
Production uses `https://www.paypal.com/web-sdk/v6/core`. Pick the URL from server config, never hard-code the environment twice, and decide sandbox or live from an explicit setting (PAYPAL_ENV), not from the shape of the API base URL: a proxy or a test harness may sit at that address. A sandbox client id with the live script renders no buttons and logs nothing.

## 2. Create one SDK instance

```js
const sdk = await window.paypal.createInstance({
  clientId,                                   // browser-safe client id from your server; never the secret
  components: ["paypal-payments", "venmo-payments", "paypal-messages"],
  pageType: "checkout",
  // Sandbox only: makes Venmo and Pay Later eligible when the tester is outside the US.
  ...(testBuyerCountry ? { testBuyerCountry } : {}),
});
const methods = await sdk.findEligibleMethods({ currencyCode: "USD" });
```
`methods.isEligible("paypal" | "venmo" | "paylater")` returns a boolean. Show only eligible buttons. Pay Later needs its details: `const { productCode, countryCode } = methods.getDetails("paylater");`.

## 3. Buttons are web components, hidden until eligible

```html
<paypal-button id="paypal-button" type="pay" hidden></paypal-button>
<venmo-button id="venmo-button" hidden></venmo-button>
<paypal-pay-later-button id="paylater-button" hidden></paypal-pay-later-button>
```
For Pay Later set `button.productCode = productCode; button.countryCode = countryCode;` before removing `hidden`.

## 4. One session per method, started from the click

```js
const options = {
  async onApprove({ orderId }) { /* POST to your server's capture route; the server decides if it is paid */ },
  onCancel({ orderId }) { /* buyer closed the window: nothing is paid */ },
  onError(error) { /* show a message; do not mark anything paid */ },
};
const paypalSession = sdk.createPayPalOneTimePaymentSession(options);
const venmoSession = sdk.createVenmoOneTimePaymentSession(options);
const payLaterSession = sdk.createPayLaterOneTimePaymentSession(options);

button.addEventListener("click", async () => {
  // Call createOrder() but do NOT await it before start(): awaiting first loses the click's
  // transient activation and the popup is blocked.
  const createOrderPromise = createOrder();          // resolves to { orderId }
  await paypalSession.start({ presentationMode: "auto" }, createOrderPromise);
});
```
`createOrder()` POSTs to your server and returns `{ orderId: data.id }`, where `data.id` is the PayPal order id the server got from Orders v2. The browser sends only what is in the bag (SKUs and quantities), never prices or totals.

If the server's capture answers that the instrument was declined, tell the buyer to choose another way to pay and let them click a button again; the order stays unpaid.

## 5. Pay Later messaging

```html
<paypal-message id="paylater-message" amount="49.00" currency-code="USD" auto-bootstrap></paypal-message>
```
Create it with `sdk.createPayPalMessages()` after `createInstance` (components must include `"paypal-messages"`). Update `element.amount = "98.00"` (a decimal string in dollars) whenever the bag total changes. Show it near the price or the bag total.

## 6. What the server must expose for this page

- the browser-safe client id, the SDK script URL and, in sandbox only, the test buyer country (for example `GET /api/paypal/config`);
- a create-order route that prices the bag itself and returns the PayPal order id;
- a capture route for the PayPal order id.
