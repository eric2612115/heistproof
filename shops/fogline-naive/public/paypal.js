// PayPal button (added in an afternoon).
import { bag, showConfirmation, showError } from "/app.js";

const config = await (await fetch("/api/paypal/config")).json();
const script = document.createElement("script");
script.src = "https://www.sandbox.paypal.com/web-sdk/v6/core";
script.onload = async () => {
  const sdk = await window.paypal.createInstance({
    clientId: config.clientId,
    components: ["paypal-payments"],
    pageType: "checkout",
    ...(config.testBuyerCountry ? { testBuyerCountry: config.testBuyerCountry } : {}),
  });
  const session = sdk.createPayPalOneTimePaymentSession({
    async onApprove({ orderId }) {
      const res = await fetch(`/api/paypal/orders/${orderId}/capture`, { method: "POST" });
      const data = await res.json();
      if (data.orderId) await showConfirmation(data.orderId);
    },
    onError(err) {
      showError(err.message);
    },
  });
  const button = document.querySelector("#paypal-button");
  button.removeAttribute("hidden");
  button.addEventListener("click", () => {
    const orderPromise = fetch("/api/paypal/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: bag.read() }),
    })
      .then((r) => r.json())
      .then((d) => ({ orderId: d.id }));
    session.start({ presentationMode: "auto" }, orderPromise);
  });
};
document.head.append(script);
