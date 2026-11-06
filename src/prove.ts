import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { env, ROOT } from "./config.ts";
import { getOrder, orderAmount, orderCapture } from "./paypal/rest.ts";
import { shopOrders, type ShopProcess } from "./shop-process.ts";
import type { Run, Phase } from "./events.ts";
import type { WebhookTap } from "./webhooks/tap.ts";

export type ShopCall = { method: string; path: string; body: unknown; status: number; response: unknown };

export type PurchaseResult = {
  ok: boolean;
  method: "paypal" | "venmo" | "paylater";
  verdict: string;
  bagTotal: string | null;
  paypalOrderId: string | null;
  paypalAmount: { value: string; currency: string } | null;
  captureId: string | null;
  captureStatus: string | null;
  shopOrder: any | null;
  calls: ShopCall[];
  screenshots: string[];
  buttons: Record<string, boolean>;
  payLaterMessage: string | null;
};

let context: BrowserContext | null = null;

export async function browser(): Promise<BrowserContext> {
  if (context) return context;
  const headless = env("HEISTPROOF_HEADED") !== "1";
  context = await chromium.launchPersistentContext(path.join(ROOT, ".heistproof", "browser-profile"), {
    headless,
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
    timezoneId: "America/Los_Angeles",
  });
  return context;
}

export async function closeBrowser() {
  await context?.close();
  context = null;
}


const V6: Record<string, string> = { paypal: "paypal-button", venmo: "venmo-button", paylater: "paypal-pay-later-button" };

/** The clickable button for a payment method, whether the page uses JS SDK v6 or v5. */
async function payButton(page: Page, method: "paypal" | "venmo" | "paylater") {
  const v6 = page.locator(V6[method]).first();
  if (await v6.isVisible().catch(() => false)) return v6;
  for (const frame of page.frames()) {
    if (!/\/smart\/buttons/.test(frame.url())) continue;
    const b = frame.locator(`[data-funding-source="${method}"]`).first();
    if (await b.isVisible().catch(() => false)) return b;
  }
  return null;
}

const money = (s: string | null | undefined) => (s ? s.replace(/[^0-9.]/g, "") : null);

/** Opens the shop like a shopper, fills the bag and returns the page with the checkout panel open. */
export async function openCheckout(shop: ShopProcess, items: Array<{ sku: string; qty: number }>): Promise<Page> {
  const ctx = await browser();
  const page = await ctx.newPage();
  await page.goto(shop.url, { waitUntil: "domcontentloaded" });
  await page.evaluate((bag) => localStorage.setItem("fogline.bag", JSON.stringify(bag)), items);
  await page.reload({ waitUntil: "networkidle" });
  await page.click("#bag-button");
  await page.waitForTimeout(800);
  return page;
}

async function visible(page: Page, selector: string, timeout = 15_000) {
  try {
    await page.locator(selector).first().waitFor({ state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
}

/**
 * One real sandbox purchase, the way a shopper makes it. Before approving, the PayPal order's amount is
 * checked against the bag total; a mismatch is reported and the purchase is cancelled.
 */
export async function purchase(opts: {
  run: Run;
  phase: Phase;
  shop: ShopProcess;
  tap: WebhookTap | null;
  items: Array<{ sku: string; qty: number }>;
  method?: "paypal" | "venmo" | "paylater";
  label: string;
  /** Called after the buyer approves and before the page's capture request leaves; return "abort" to block it. */
  onBeforeCapture?: (orderId: string) => Promise<"continue" | "abort">;
  expectPaid?: boolean;
}): Promise<PurchaseResult> {
  const { run, phase, shop, label } = opts;
  const method = opts.method ?? "paypal";
  const shots: string[] = [];
  const shot = async (p: Page, name: string) => {
    const file = run.file(`${label}-${name}.png`);
    await p.screenshot({ path: file }).catch(() => {});
    shots.push(path.basename(file));
  };
  const calls: ShopCall[] = [];
  const result: PurchaseResult = {
    ok: false,
    method,
    verdict: "",
    bagTotal: null,
    paypalOrderId: null,
    paypalAmount: null,
    captureId: null,
    captureStatus: null,
    shopOrder: null,
    calls,
    screenshots: shots,
    buttons: {},
    payLaterMessage: null,
  };

  const page = await openCheckout(shop, opts.items);
  const origin = new URL(shop.url).origin;
  let abortCapture = false;
  let approvedOrderId: string | null = null;
  await page.route(`${origin}/**`, async (route) => {
    const req = route.request();
    if (req.method() === "POST" && approvedOrderId && opts.onBeforeCapture && (req.url().includes(approvedOrderId) || (req.postData() ?? "").includes(approvedOrderId))) {
      if ((await opts.onBeforeCapture(approvedOrderId)) === "abort") {
        abortCapture = true;
        run.emit(phase, "prove.capture_blocked", { label, url: new URL(req.url()).pathname });
        return route.abort("failed");
      }
    }
    return route.continue();
  });
  page.on("response", async (res) => {
    const req = res.request();
    if (!req.url().startsWith(origin) || req.method() !== "POST") return;
    let body: unknown = req.postData();
    try {
      body = JSON.parse(String(body));
    } catch {
      /* raw */
    }
    let response: unknown = null;
    try {
      response = await res.json();
    } catch {
      /* not json */
    }
    calls.push({ method: req.method(), path: new URL(req.url()).pathname, body, status: res.status(), response });
  });

  result.bagTotal = money(await page.locator("#bag-total").textContent());
  // JS SDK v6 renders web components; v5 renders each button inside a PayPal iframe.
  await visible(page, "paypal-button, iframe[src*='/smart/buttons']", 20_000);
  await page.waitForTimeout(1500);
  for (const name of ["paypal", "venmo", "paylater"] as const) result.buttons[name] = Boolean(await payButton(page, name));
  result.payLaterMessage = await page
    .locator("paypal-message")
    .first()
    .evaluate((el: any) => (el.shadowRoot?.textContent ?? el.textContent ?? "").replace(/\s+/g, " ").trim(), null, { timeout: 2000 })
    .catch(() => null);
  await shot(page, "1-checkout");
  run.emit(phase, "prove.buttons", { label, buttons: result.buttons, payLaterMessage: result.payLaterMessage, bagTotal: result.bagTotal });
  if (!result.buttons[method]) {
    result.verdict = `The ${method} button never appeared.`;
    await page.close();
    return result;
  }

  const popupPromise = page.context().waitForEvent("page", { timeout: 30_000 });
  await (await payButton(page, method))!.click();
  let popup: Page;
  try {
    popup = await popupPromise;
  } catch {
    result.verdict = "Clicking the button opened no PayPal window.";
    await shot(page, "2-no-popup");
    await page.close();
    return result;
  }
  await popup.waitForLoadState("domcontentloaded").catch(() => {});
  for (let i = 0; i < 40 && !result.paypalOrderId; i++) {
    result.paypalOrderId = new URL(popup.url()).searchParams.get("token");
    if (!result.paypalOrderId) await popup.waitForTimeout(500);
  }
  if (!result.paypalOrderId) {
    const created = calls.find((c) => (c.response as any)?.id);
    result.paypalOrderId = (created?.response as any)?.id ?? null;
  }
  run.emit(phase, "prove.order_created", { label, paypalOrderId: result.paypalOrderId });

  // Log in as the sandbox buyer if PayPal asks.
  const email = env("SANDBOX_BUYER_EMAIL");
  const password = env("SANDBOX_BUYER_PASSWORD");
  const loginIfAsked = async () => {
    const emailBox = popup.locator('input[name="login_email"], #email').first();
    if (!(await emailBox.isVisible({ timeout: 8000 }).catch(() => false))) return;
    if (!password) {
      run.emit(phase, "prove.needs_login", { label, note: "Log in as the sandbox buyer in the PayPal window (no password configured)." });
      await popup.waitForSelector('input[name="login_email"], #email', { state: "detached", timeout: 180_000 }).catch(() => {});
      return;
    }
    await emailBox.fill(email ?? "");
    const next = popup.locator("#btnNext");
    if (await next.isVisible().catch(() => false)) await next.click();
    const pw = popup.locator('input[name="login_password"], #password').first();
    await pw.waitFor({ state: "visible", timeout: 15_000 });
    await pw.fill(password);
    await popup.locator("#btnLogin").click();
    run.emit(phase, "prove.logged_in", { label, buyer: email });
  };
  // PayPal's review page shows one primary button ("Complete Purchase", "Pay", "Continue").
  const approve = popup.locator('#payment-submit-btn, button[data-testid="submit-button-initial"], button:has-text("Complete Purchase"), button:has-text("Pay Now"), button:has-text("Continue to Review Order"), button:has-text("Agree & Continue")').first();

  // The amount check: what PayPal will charge versus what the shopper saw in the bag.
  if (result.paypalOrderId) {
    const order = await getOrder(result.paypalOrderId);
    result.paypalAmount = orderAmount(order.body);
    const matches = result.paypalAmount && result.bagTotal && Number(result.paypalAmount.value) === Number(result.bagTotal);
    run.emit(phase, "prove.amount_check", { label, bagTotal: result.bagTotal, paypalAmount: result.paypalAmount, debugId: order.debugId, ok: Boolean(matches) });
    await popup.waitForTimeout(2500);
    await shot(popup, "2-paypal");
    if (!matches) {
      // Show the wrong amount on PayPal's own review page, then walk away without approving.
      if (password) {
        await loginIfAsked().catch(() => {});
        if (await approve.isVisible({ timeout: 30_000 }).catch(() => false)) {
          await popup.waitForTimeout(1500);
          await shot(popup, "2b-paypal-wrong-amount");
        }
      }
      result.verdict = `PayPal would charge $${result.paypalAmount?.value ?? "?"} for a $${result.bagTotal} bag.`;
      run.emit(phase, "prove.result", { label, ok: false, verdict: result.verdict, screenshots: [...shots] });
      await popup.close().catch(() => {});
      await page.close();
      return result;
    }
  }

  await loginIfAsked();
  try {
    await approve.waitFor({ state: "visible", timeout: 45_000 });
    await popup.waitForTimeout(1500);
    await shot(popup, "3-review");
    approvedOrderId = result.paypalOrderId;
    await approve.click();
    run.emit(phase, "prove.approved", { label, paypalOrderId: result.paypalOrderId });
  } catch {
    await shot(popup, "3-stuck");
    const refused = await popup.getByText(/info isn't correct|incorrect/i).count().catch(() => 0);
    result.verdict = refused ? "PayPal refused the sandbox buyer's login (check SANDBOX_BUYER_PASSWORD)." : "Could not find PayPal's approve button (see screenshot).";
    run.emit(phase, "prove.result", { label, ok: false, verdict: result.verdict, screenshots: [...shots] });
    await popup.close().catch(() => {});
    await page.close();
    return result;
  }
  await popup.waitForEvent("close", { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(abortCapture ? 3000 : 6000);
  await shot(page, "4-after");

  // What PayPal holds and what the shop recorded.
  if (result.paypalOrderId) {
    const order = await getOrder(result.paypalOrderId);
    const capture = orderCapture(order.body);
    result.captureId = capture?.id ?? null;
    result.captureStatus = capture?.status ?? order.body?.status ?? null;
  }
  const orders = await shopOrders(shop);
  result.shopOrder = orders.find((o) => o.payment_reference && (o.payment_reference === result.captureId || o.payment_reference === result.paypalOrderId)) ?? orders[0] ?? null;
  const paid = ["paid", "fulfilled"].includes(result.shopOrder?.status);
  if (opts.expectPaid === false) {
    result.ok = !paid;
    result.verdict = paid ? "The shop marked the order paid." : "The shop kept the order unpaid.";
  } else {
    result.ok = paid && result.captureStatus === "COMPLETED" && result.shopOrder?.shipments === 1;
    result.verdict = result.ok
      ? `Paid $${result.paypalAmount?.value}: capture ${result.captureId} COMPLETED, shop order ${result.shopOrder.id} ${result.shopOrder.status}, 1 label.`
      : `Capture ${result.captureStatus ?? "missing"}; shop order ${result.shopOrder?.id ?? "?"} is ${result.shopOrder?.status ?? "?"} with ${result.shopOrder?.shipments ?? 0} labels.`;
  }
  run.emit(phase, "prove.result", { label, ok: result.ok, verdict: result.verdict, captureId: result.captureId, shopOrder: result.shopOrder?.id, screenshots: [...shots] });
  await page.close();
  return result;
}
