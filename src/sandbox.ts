import { PORTS, paypal, isOffline, usePayPalStandIn } from "./config.ts";
import { PayPalProxy } from "./paypal/proxy.ts";
import { PayPalStandIn } from "./paypal/stand-in.ts";
import { verifyDelivery } from "./paypal/rest.ts";
import { WebhookTap } from "./webhooks/tap.ts";
import { openTunnel, ensureWebhook } from "./webhooks/tunnel.ts";
import { startShop, assertPortFree, type ShopProcess } from "./shop-process.ts";
import { loadProfile } from "./shop-profile.ts";
import type { Run, Phase } from "./events.ts";

export type Sandbox = { proxy: PayPalProxy; tap: WebhookTap; shop: ShopProcess; webhookId: string; publicUrl: string; standIn: PayPalStandIn | null; close: () => Promise<void> };

/**
 * Everything a migrated shop needs for one round: a recording proxy in front of PayPal (the real sandbox, or the offline
 * stand-in), an address for PayPal's webhooks, and the shop process itself. Evidence files are named by round
 * (round0-paypal-calls.json, ...), so later rounds never overwrite earlier ones.
 */
export async function openSandbox(run: Run, phase: Phase, shopDir: string, round: number): Promise<Sandbox> {
  for (const port of [PORTS.shop, PORTS.paypalProxy, PORTS.webhookTap, ...(isOffline() ? [PORTS.paypalStandIn] : [])]) await assertPortFree(port);
  const label = `round${round}`;
  const cleanup: Array<() => Promise<void> | void> = [];
  const undo = async () => {
    for (const f of cleanup.reverse()) await Promise.resolve(f()).catch(() => {});
  };
  try {
    let standIn: PayPalStandIn | null = null;
    if (isOffline()) {
      standIn = new PayPalStandIn();
      await standIn.start(PORTS.paypalStandIn);
      cleanup.push(() => standIn!.stop());
      usePayPalStandIn({ clientId: standIn.clientId, clientSecret: standIn.clientSecret, apiBase: standIn.url });
      cleanup.push(() => usePayPalStandIn(null));
    }
    const proxy = new PayPalProxy();
    const proxyUrl = await proxy.start(PORTS.paypalProxy);
    cleanup.push(() => proxy.stop());
    const shopUrl = `http://127.0.0.1:${PORTS.shop}`;
    const tap = new WebhookTap(`${shopUrl}${loadProfile(shopDir).webhooks}`);
    await tap.start(PORTS.webhookTap);
    cleanup.push(() => tap.stop());
    let webhookUrl: string;
    let webhookId: string;
    let publicUrl: string;
    if (standIn) {
      publicUrl = `http://127.0.0.1:${PORTS.webhookTap}`;
      webhookUrl = `${publicUrl}/paypal-webhooks`;
      standIn.webhookUrl = webhookUrl;
      webhookId = standIn.webhookId;
    } else {
      const tunnel = await openTunnel(PORTS.webhookTap);
      cleanup.push(() => tunnel.close());
      publicUrl = tunnel.url;
      webhookUrl = `${tunnel.url}/paypal-webhooks`;
      webhookId = await ensureWebhook(webhookUrl);
    }
    tap.verifier = (headers, rawBody) => verifyDelivery(headers, rawBody, webhookId);
    run.emit(phase, "sandbox.ready", { round, proxy: proxyUrl, webhookUrl, webhookId, offline: Boolean(standIn) });
    const shop = await startShop({
      dir: shopDir,
      port: PORTS.shop,
      dbFile: run.file(`shop-${label}.db`),
      env: {
        PAYPAL_CLIENT_ID: paypal.clientId(),
        PAYPAL_CLIENT_SECRET: paypal.clientSecret(),
        PAYPAL_WEBHOOK_ID: webhookId,
        PAYPAL_API_BASE: proxyUrl,
        PAYPAL_TEST_BUYER_COUNTRY: "US",
        PAYPAL_ENV: "sandbox",
      },
    });
    run.emit(phase, "shop.started", { url: shop.url });
    return {
      proxy,
      tap,
      shop,
      webhookId,
      publicUrl,
      standIn,
      close: async () => {
        run.writeJson(`${label}-paypal-calls.json`, proxy.calls);
        run.writeJson(`${label}-webhooks.json`, tap.deliveries.map(({ rawBody, ...d }) => ({ ...d, body: safeParse(rawBody) })));
        run.writeText(`${label}-shop.log`, shop.logs.join("\n"));
        await shop.stop();
        await undo();
      },
    };
  } catch (err) {
    await undo();
    throw err;
  }
}

function safeParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
