import { PORTS, paypal } from "./config.ts";
import { PayPalProxy } from "./paypal/proxy.ts";
import { WebhookTap } from "./webhooks/tap.ts";
import { openTunnel, ensureWebhook } from "./webhooks/tunnel.ts";
import { startShop, assertPortFree, type ShopProcess } from "./shop-process.ts";
import type { Run, Phase } from "./events.ts";

export type Sandbox = { proxy: PayPalProxy; tap: WebhookTap; shop: ShopProcess; webhookId: string; publicUrl: string; close: () => Promise<void> };

/**
 * Everything a migrated shop needs to run against the real PayPal sandbox:
 * a recording proxy in front of PayPal's API, a public webhook address, and the shop process itself.
 */
export async function openSandbox(run: Run, phase: Phase, shopDir: string, dbName = "shop.db"): Promise<Sandbox> {
  for (const port of [PORTS.shop, PORTS.paypalProxy, PORTS.webhookTap]) await assertPortFree(port);
  const proxy = new PayPalProxy();
  const proxyUrl = await proxy.start(PORTS.paypalProxy);
  const shopUrl = `http://127.0.0.1:${PORTS.shop}`;
  const tap = new WebhookTap(`${shopUrl}/api/paypal/webhooks`);
  await tap.start(PORTS.webhookTap);
  const tunnel = await openTunnel(PORTS.webhookTap);
  const webhookUrl = `${tunnel.url}/paypal-webhooks`;
  const webhookId = await ensureWebhook(webhookUrl);
  run.emit(phase, "sandbox.ready", { proxy: proxyUrl, webhookUrl, webhookId });
  let shop: ShopProcess;
  try {
    shop = await startShop({
      dir: shopDir,
      port: PORTS.shop,
      dbFile: run.file(dbName),
      env: {
        PAYPAL_CLIENT_ID: paypal.clientId(),
        PAYPAL_CLIENT_SECRET: paypal.clientSecret(),
        PAYPAL_WEBHOOK_ID: webhookId,
        PAYPAL_API_BASE: proxyUrl,
        PAYPAL_TEST_BUYER_COUNTRY: "US",
        PAYPAL_ENV: "sandbox",
      },
    });
  } catch (err) {
    tunnel.close();
    await tap.stop();
    await proxy.stop();
    throw err;
  }
  run.emit(phase, "shop.started", { url: shop.url });
  return {
    proxy,
    tap,
    shop,
    webhookId,
    publicUrl: tunnel.url,
    close: async () => {
      run.writeJson(`${phase}-paypal-calls.json`, proxy.calls);
      run.writeJson(`${phase}-webhooks.json`, tap.deliveries.map(({ rawBody, ...d }) => ({ ...d, body: safeParse(rawBody) })));
      run.writeText(`${phase}-shop.log`, shop.logs.join("\n"));
      await shop.stop();
      tunnel.close();
      await tap.stop();
      await proxy.stop();
    },
  };
}

function safeParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
