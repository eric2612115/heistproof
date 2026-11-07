/**
 * The browser half of the offline PayPal stand-in: a small script with the surface of PayPal's JS SDK v6 that the
 * shops use (createInstance, findEligibleMethods, one-time payment sessions for PayPal, Venmo and Pay Later, the
 * button web components and Pay Later messaging). Offline runs serve it in place of
 * https://www.sandbox.paypal.com/web-sdk/v6/core. A session opens the stand-in's approval page in a popup, as PayPal does.
 * Served for the live host (www.paypal.com) it fails the way PayPal's live script fails with a sandbox client id.
 */
export function standInSdk(opts: { origin: string; clientId: string; live: boolean }): string {
  return `(() => {
  const ORIGIN = ${JSON.stringify(opts.origin)};
  const CLIENT_ID = ${JSON.stringify(opts.clientId)};
  const LIVE = ${opts.live ? "true" : "false"};
  const BUTTONS = {
    "paypal-button": ["Pay with PayPal", "#ffc439", "#111111"],
    "venmo-button": ["Venmo", "#008cff", "#ffffff"],
    "paypal-pay-later-button": ["Pay Later", "#ffc439", "#111111"],
  };
  for (const [tag, [text, bg, fg]] of Object.entries(BUTTONS)) {
    if (customElements.get(tag)) continue;
    customElements.define(tag, class extends HTMLElement {
      connectedCallback() {
        if (this.shadowRoot) return;
        const root = this.attachShadow({ mode: "open" });
        root.innerHTML = '<style>:host{display:inline-block;min-width:200px;height:45px;cursor:pointer}:host([hidden]){display:none}' +
          'button{all:unset;box-sizing:border-box;display:flex;align-items:center;justify-content:center;width:100%;height:100%;border-radius:4px;background:' + bg + ';color:' + fg + ';font:600 16px system-ui,sans-serif}</style>' +
          '<button part="button" type="button">' + text + '</button>';
      }
    });
  }
  if (!customElements.get("paypal-message")) {
    customElements.define("paypal-message", class extends HTMLElement {
      static get observedAttributes() { return ["amount"]; }
      connectedCallback() {
        if (Object.prototype.hasOwnProperty.call(this, "amount")) { const v = this.amount; delete this.amount; this.amount = v; }
        this.render();
      }
      attributeChangedCallback() { this.render(); }
      get amount() { return this._amount ?? this.getAttribute("amount"); }
      set amount(v) { this._amount = v; this.render(); }
      render() {
        const root = this.shadowRoot ?? this.attachShadow({ mode: "open" });
        const a = Number(this.amount);
        root.innerHTML = '<span style="font:14px system-ui,sans-serif">' + (a > 0 ? 'PayPal Pay in 4 interest-free payments of $' + (a / 4).toFixed(2) + '. Learn more' : 'PayPal Pay Later. Learn more') + '</span>';
      }
    });
  }

  function session(fundingSource, handlers) {
    handlers = handlers || {};
    return {
      async start(_options, orderPromise) {
        const popup = window.open("about:blank", "heistproof-offline-paypal", "width=480,height=680");
        let orderId;
        try {
          const o = await (typeof orderPromise === "function" ? orderPromise() : orderPromise);
          orderId = o && (o.orderId || o.orderID || o.id);
          if (!orderId) throw new Error("The create-order step returned no order id.");
        } catch (err) {
          if (popup) popup.close();
          if (handlers.onError) handlers.onError(err);
          return;
        }
        if (!popup) { if (handlers.onError) handlers.onError(new Error("Popup blocked")); return; }
        popup.location.href = ORIGIN + "/checkoutnow?token=" + encodeURIComponent(orderId) + "&fundingSource=" + fundingSource;
        await new Promise((resolve) => {
          let done = false;
          const finish = () => { done = true; window.removeEventListener("message", onMessage); clearInterval(timer); resolve(); };
          const onMessage = async (ev) => {
            const d = ev.data || {};
            if (ev.origin !== ORIGIN || d.source !== "heistproof-offline-paypal" || d.orderId !== orderId || done) return;
            finish();
            try {
              if (d.type === "approve") { if (handlers.onApprove) await handlers.onApprove({ orderId, payerId: d.payerId }); }
              else if (d.type === "cancel") { if (handlers.onCancel) handlers.onCancel({ orderId }); }
              else if (handlers.onError) handlers.onError(new Error(d.message || "PayPal could not approve the order."));
            } catch (err) { if (handlers.onError) handlers.onError(err); }
          };
          window.addEventListener("message", onMessage);
          const timer = setInterval(() => {
            if (popup.closed && !done) setTimeout(() => { if (!done) { finish(); if (handlers.onCancel) handlers.onCancel({ orderId }); } }, 800);
          }, 400);
        });
      },
    };
  }

  window.paypal = {
    version: "6-offline-stand-in",
    async createInstance(options) {
      options = options || {};
      if (LIVE) throw new Error("PayPal live script (www.paypal.com) loaded with a sandbox client id: the buttons cannot render. Load https://www.sandbox.paypal.com/web-sdk/v6/core in sandbox.");
      if (options.clientId && options.clientId !== CLIENT_ID) throw new Error("PayPal: the client id is not valid for this environment.");
      if (!options.clientId && !options.clientToken) throw new Error("PayPal: createInstance needs a clientId or a clientToken.");
      return {
        async findEligibleMethods() {
          return { isEligible: (m) => ["paypal", "venmo", "paylater"].includes(m), getDetails: () => ({ canBeVaulted: false }) };
        },
        createPayPalOneTimePaymentSession: (h) => session("paypal", h),
        createVenmoOneTimePaymentSession: (h) => session("venmo", h),
        createPayLaterOneTimePaymentSession: (h) => session("paylater", h),
        createPayPalMessages: () => ({ async fetchContent() { return {}; } }),
      };
    },
  };
})();
`;
}
