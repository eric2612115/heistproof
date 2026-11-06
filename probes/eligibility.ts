// Probe: which v6 payment methods are eligible for the sandbox merchant app (client id only, no secret).
import http from "node:http";
import { chromium } from "playwright";

const CLIENT_ID = process.env.PAYPAL_CLIENT_ID ?? "";
if (!CLIENT_ID) throw new Error("PAYPAL_CLIENT_ID is not set");
const PORT = 4419;

const page = (country: string) => `<!doctype html><html><head><meta charset="utf-8"><title>probe</title></head><body>
<paypal-message id="msg" amount="49.00" currency-code="USD" auto-bootstrap></paypal-message>
<paypal-button id="pp" type="pay" hidden></paypal-button>
<venmo-button id="venmo" hidden></venmo-button>
<paypal-pay-later-button id="pl" hidden></paypal-pay-later-button>
<script>
async function go() {
  const out = { country: ${JSON.stringify(country)} };
  try {
    const sdk = await window.paypal.createInstance({
      clientId: ${JSON.stringify(CLIENT_ID)},
      components: ["paypal-payments", "venmo-payments", "paypal-messages"],
      pageType: "checkout",
      testBuyerCountry: ${JSON.stringify(country)},
    });
    const methods = await sdk.findEligibleMethods({ currencyCode: "USD" });
    for (const m of ["paypal", "venmo", "paylater", "credit"]) out[m] = methods.isEligible(m);
    try { out.paylaterDetails = methods.getDetails("paylater"); } catch (e) { out.paylaterDetails = String(e); }
    try { sdk.createPayPalMessages(); out.messages = "created"; } catch (e) { out.messages = String(e); }
  } catch (e) { out.error = String(e && e.message || e); }
  window.__result = out;
}
</script>
<script async src="https://www.sandbox.paypal.com/web-sdk/v6/core" onload="go()"></script>
</body></html>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  res.writeHead(200, { "content-type": "text/html" });
  res.end(page(url.searchParams.get("country") ?? "US"));
});
await new Promise<void>((r) => server.listen(PORT, "127.0.0.1", r));
const browser = await chromium.launch();
try {
  for (const country of ["US"]) {
    const ctx = await browser.newContext({ locale: "en-US" });
    const p = await ctx.newPage();
    const logs: string[] = [];
    p.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`.slice(0, 300)));
    await p.goto(`http://localhost:${PORT}/?country=${country}`);
    await p.waitForFunction(() => (window as any).__result, null, { timeout: 30000 }).catch(() => {});
    const result = await p.evaluate(() => (window as any).__result ?? null);
    await p.waitForTimeout(4000);
    const msgText = await p.locator("#msg").evaluate((el: any) => (el.shadowRoot ? el.shadowRoot.textContent : el.textContent) ?? "").catch(() => "");
    console.log(JSON.stringify({ result, messageText: msgText.replace(/\s+/g, " ").trim().slice(0, 200), logs: logs.slice(0, 8) }, null, 2));
    await p.screenshot({ path: `eligibility-${country}.png`, fullPage: true });
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
