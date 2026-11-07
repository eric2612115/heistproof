// Copper Kettle storefront. The cart lives in this page; the server prices it and decides when an order is paid.
const $ = (s) => document.querySelector(s);
const csrf = document.querySelector('meta[name="csrf-token"]').content;
const post = (url, body) => fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify(body ?? {}) });

let catalog = [];
const cart = new Map(); // product -> count
const money = (n) => `$${Number(n).toFixed(2)}`;
const cartTotal = () => [...cart].reduce((sum, [sku, count]) => sum + Number(catalog.find((p) => p.sku === sku)?.price ?? 0) * count, 0);
const lines = () => [...cart].map(([product, count]) => ({ product, count }));

function render() {
  $("#cart-lines").innerHTML = [...cart]
    .map(([sku, count]) => `<li><span>${count} × ${catalog.find((p) => p.sku === sku)?.name ?? sku}</span><span>${money(Number(catalog.find((p) => p.sku === sku)?.price ?? 0) * count)}</span></li>`)
    .join("") || "<li class=empty>Nothing here yet.</li>";
  $("#cart-total").textContent = money(cartTotal());
  $("#cart-count").textContent = String([...cart.values()].reduce((a, b) => a + b, 0));
  const message = $("#paylater-message");
  if (message) message.amount = cartTotal().toFixed(2);
}
const notice = (text) => ($("#notice").textContent = text);
const openCart = (open = true) => $("#cart").setAttribute("aria-hidden", open ? "false" : "true");

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Could not load PayPal"));
    document.head.append(s);
  });
}

async function initPayPal() {
  const config = await (await fetch("/api/paypal/client")).json();
  if (!config.clientId) return;
  await loadScript(config.sdkUrl);
  const sdk = await window.paypal.createInstance({
    clientId: config.clientId,
    components: ["paypal-payments", "venmo-payments", "paypal-messages"],
    pageType: "checkout",
    ...(config.testBuyerCountry ? { testBuyerCountry: config.testBuyerCountry } : {}),
  });
  try {
    sdk.createPayPalMessages();
    $("#paylater-message").hidden = false;
  } catch {
    /* messaging is optional */
  }
  const methods = await sdk.findEligibleMethods({ currencyCode: "USD" });
  const createOrder = async () => {
    const res = await post("/api/checkout/paypal", { lines: lines() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Could not start PayPal checkout.");
    return { orderId: data.paypalOrderId };
  };
  const handlers = {
    async onApprove({ orderId }) {
      const res = await post(`/api/checkout/paypal/${encodeURIComponent(orderId)}/capture`);
      const data = await res.json();
      if (res.status === 202) return notice("Your payment is pending; we will email you when PayPal completes it.");
      if (!res.ok) return notice(data.error ?? "The payment did not go through.");
      cart.clear();
      render();
      notice(`Thank you! Order ${data.ref} is on its way.`);
    },
    onCancel: () => notice("PayPal checkout was cancelled. Nothing was charged."),
    onError: () => notice("PayPal could not complete that payment. Please try again."),
  };
  const wire = (selector, session) => {
    const button = $(selector);
    button.hidden = false;
    button.addEventListener("click", async () => {
      notice("");
      // Start the session in the click itself (the popup needs it); the order is created meanwhile.
      const order = createOrder();
      order.catch((err) => notice(err.message));
      await session.start({ presentationMode: "auto" }, order).catch((err) => notice(err.message));
    });
  };
  if (methods.isEligible("paypal")) wire("#paypal-button", sdk.createPayPalOneTimePaymentSession(handlers));
  if (methods.isEligible("venmo")) wire("#venmo-button", sdk.createVenmoOneTimePaymentSession(handlers));
  if (methods.isEligible("paylater")) wire("#paylater-button", sdk.createPayLaterOneTimePaymentSession(handlers));
}

async function main() {
  catalog = await (await fetch("/api/catalog")).json();
  $("#products").innerHTML = catalog
    .map((p) => `<article><h3>${p.name}</h3><p>${p.blurb}</p><p class="price">${money(p.price)}</p><button type="button" data-add="${p.sku}">Add to cart</button></article>`)
    .join("");
  document.body.addEventListener("click", (e) => {
    const add = e.target.closest("[data-add]");
    if (add) {
      cart.set(add.dataset.add, Math.min(10, (cart.get(add.dataset.add) ?? 0) + 1));
      render();
    }
  });
  $("#cart-open").addEventListener("click", () => openCart(true));
  $("#cart-close").addEventListener("click", () => openCart(false));
  render();
  initPayPal().catch((err) => console.error("PayPal unavailable:", err.message));
}
main();
