// Fogline storefront: catalog, bag and card checkout.
const BAG_KEY = "fogline.bag";
let products = [];

export const bag = {
  read() {
    try {
      return JSON.parse(localStorage.getItem(BAG_KEY) ?? "[]");
    } catch {
      return [];
    }
  },
  write(items) {
    localStorage.setItem(BAG_KEY, JSON.stringify(items));
    renderBag();
  },
  add(sku) {
    const items = bag.read();
    const line = items.find((i) => i.sku === sku);
    if (line) line.qty += 1;
    else items.push({ sku, qty: 1 });
    bag.write(items);
  },
  setQty(sku, qty) {
    bag.write(bag.read().map((i) => (i.sku === sku ? { ...i, qty } : i)).filter((i) => i.qty > 0));
  },
  clear() {
    bag.write([]);
  },
};

export function formatMoney(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function bagTotalCents() {
  return bag.read().reduce((sum, item) => {
    const p = products.find((x) => x.sku === item.sku);
    return sum + (p ? p.priceCents * item.qty : 0);
  }, 0);
}

const $ = (sel) => document.querySelector(sel);

function renderHero() {
  const p = products[0];
  $("#hero").innerHTML = `
    <div class="hero-art"><img src="${p.image}" alt="${p.name}" /></div>
    <div class="hero-copy">
      <p class="kicker">Drop 07 &middot; Harbor fog</p>
      <h1>${p.name}</h1>
      <p class="blurb">${p.blurb}</p>
      <p class="price" id="hero-price">${p.price}</p>
      <button class="add" id="add-${p.sku}" type="button" data-sku="${p.sku}">Add to bag</button>
    </div>`;
}

function renderGrid() {
  $("#product-grid").innerHTML = products
    .slice(1)
    .map(
      (p) => `
      <article class="card">
        <img src="${p.image}" alt="${p.name}" />
        <h3>${p.name}</h3>
        <p>${p.blurb}</p>
        <div class="card-foot"><span>${p.price}</span><button class="add small" id="add-${p.sku}" type="button" data-sku="${p.sku}">Add</button></div>
      </article>`,
    )
    .join("");
}

export function renderBag() {
  const items = bag.read();
  $("#bag-count").textContent = items.reduce((n, i) => n + i.qty, 0);
  $("#bag-lines").innerHTML =
    items
      .map((i) => {
        const p = products.find((x) => x.sku === i.sku);
        if (!p) return "";
        return `<li><img src="${p.image}" alt="" /><div><strong>${p.name}</strong><span>${formatMoney(p.priceCents)}</span></div>
          <div class="qty"><button type="button" data-dec="${p.sku}" aria-label="One less">&minus;</button><span>${i.qty}</span><button type="button" data-inc="${p.sku}" aria-label="One more">+</button></div></li>`;
      })
      .join("") || `<li class="empty">Your bag is empty.</li>`;
  const total = formatMoney(bagTotalCents());
  $("#bag-total").textContent = total;
  $("#pay-card").textContent = `Pay ${total}`;
  document.dispatchEvent(new CustomEvent("bag:change", { detail: { items, totalCents: bagTotalCents() } }));
}

export function openPanel() {
  $("#checkout-panel").classList.add("open");
  $("#checkout-panel").setAttribute("aria-hidden", "false");
  $("#scrim").classList.add("open");
}

function closePanel() {
  $("#checkout-panel").classList.remove("open");
  $("#checkout-panel").setAttribute("aria-hidden", "true");
  $("#scrim").classList.remove("open");
}

export function showError(message) {
  $("#checkout-error").textContent = message ?? "";
}

export async function showConfirmation(orderId) {
  const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`);
  const order = await res.json();
  bag.clear();
  $("#bag-view").hidden = true;
  $("#panel-title").textContent = "Thank you";
  const box = $("#order-confirmation");
  box.hidden = false;
  box.innerHTML = `<p class="kicker">Order ${order.id}</p><h3>${order.status === "fulfilled" ? "Paid and on its way." : `Status: ${order.status}`}</h3>
    <p>${order.items.map((i) => `${i.qty} &times; ${i.name}`).join("<br />")}</p><p class="price">${order.total}</p>`;
}

async function payByCard(event) {
  event.preventDefault();
  showError("");
  const form = event.currentTarget;
  const button = $("#pay-card");
  button.disabled = true;
  try {
    const res = await fetch("/api/checkout/card", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        items: bag.read(),
        email: form.email.value,
        card: { number: form.number.value, exp: form.exp.value, cvc: form.cvc.value },
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Payment failed");
    await showConfirmation(data.orderId);
  } catch (err) {
    showError(err.message);
  } finally {
    button.disabled = false;
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.async = true;
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error("Could not load PayPal"));
    document.head.appendChild(script);
  });
}

// PayPal / Venmo / Pay Later via the PayPal Web SDK v6. The browser only ever
// sends SKUs and quantities; the server prices the bag and decides if it is paid.
async function initPayPal() {
  let config;
  try {
    const res = await fetch("/api/paypal/config");
    if (!res.ok) return;
    config = await res.json();
  } catch {
    return;
  }
  if (!config.clientId) return;
  try {
    await loadScript(config.sdkUrl);
    const sdk = await window.paypal.createInstance({
      clientId: config.clientId,
      components: ["paypal-payments", "venmo-payments", "paypal-messages"],
      pageType: "checkout",
      ...(config.testBuyerCountry ? { testBuyerCountry: config.testBuyerCountry } : {}),
    });
    try {
      sdk.createPayPalMessages();
    } catch { /* messaging is decorative; buttons still work */ }
    const message = $("#paylater-message");
    const syncMessage = () => {
      if (message) message.amount = formatMoney(bagTotalCents()).replace("$", "");
    };
    syncMessage();
    document.addEventListener("bag:change", syncMessage);

    const methods = await sdk.findEligibleMethods({ currencyCode: config.currencyCode ?? "USD" });

    const createOrder = async () => {
      const res = await fetch("/api/paypal/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: bag.read(), email: $("#email")?.value || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not start PayPal checkout");
      return { orderId: data.id };
    };
    const options = {
      async onApprove({ orderId }) {
        try {
          const res = await fetch(`/api/paypal/orders/${encodeURIComponent(orderId)}/capture`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          });
          const data = await res.json();
          if (res.status === 202) {
            showError("Your payment is pending. We will confirm once PayPal completes it.");
            return;
          }
          if (!res.ok) throw new Error(data.error ?? "Payment failed. Please choose another way to pay.");
          await showConfirmation(data.orderId);
        } catch (err) {
          showError(err.message);
        }
      },
      onCancel() {
        showError("PayPal checkout was cancelled. Nothing was charged.");
      },
      onError() {
        showError("PayPal could not complete that payment. Please choose another way to pay.");
      },
    };

    const wire = (buttonId, session, eligible) => {
      const button = $(buttonId);
      if (!button || !eligible) return;
      button.hidden = false;
      button.addEventListener("click", async () => {
        showError("");
        try {
          // Do NOT await createOrder before start(): awaiting first loses the
          // click's transient activation and the popup is blocked.
          const createOrderPromise = createOrder();
          createOrderPromise.catch(() => {});
          await session.start({ presentationMode: "auto" }, createOrderPromise);
        } catch (err) {
          showError(err.message ?? "PayPal could not start. Please try again.");
        }
      });
    };

    if (methods.isEligible("paypal")) {
      wire("#paypal-button", sdk.createPayPalOneTimePaymentSession(options), true);
    }
    if (methods.isEligible("venmo")) {
      wire("#venmo-button", sdk.createVenmoOneTimePaymentSession(options), true);
    }
    if (methods.isEligible("paylater")) {
      const button = $("#paylater-button");
      const { productCode, countryCode } = methods.getDetails("paylater");
      if (button) {
        button.productCode = productCode;
        button.countryCode = countryCode;
      }
      wire("#paylater-button", sdk.createPayLaterOneTimePaymentSession(options), true);
    }
  } catch {
    // PayPal unavailable: the card form remains fully usable.
  }
}

async function main() {
  products = await (await fetch("/api/products")).json();
  renderHero();
  renderGrid();
  renderBag();
  document.body.addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t) return;
    if (t.dataset.sku) {
      bag.add(t.dataset.sku);
      openPanel();
    }
    if (t.dataset.inc) bag.setQty(t.dataset.inc, bag.read().find((i) => i.sku === t.dataset.inc).qty + 1);
    if (t.dataset.dec) bag.setQty(t.dataset.dec, bag.read().find((i) => i.sku === t.dataset.dec).qty - 1);
  });
  $("#bag-button").addEventListener("click", openPanel);
  $("#close-panel").addEventListener("click", closePanel);
  $("#scrim").addEventListener("click", closePanel);
  $("#card-form").addEventListener("submit", payByCard);
  initPayPal();
}

main();
