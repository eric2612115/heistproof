import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { env, ROOT, sandboxBuyer, isOffline, pace, paypal } from "./config.ts";
import { getOrder, orderAmount, orderCapture } from "./paypal/rest.ts";
import { standInSdk } from "./paypal/stand-in-sdk.ts";
import { itemList } from "./checkout-shape.ts";
import { shopOrders, settledOrders, type ShopProcess } from "./shop-process.ts";
import type { ShopOrder } from "./shop-profile.ts";
import type { Run, Phase } from "./events.ts";
import type { WebhookTap } from "./webhooks/tap.ts";

/** A request the shopper's page sent to the shop, with what came back. Replays reuse its headers (CSRF tokens and the like). */
export type ShopCall = { method: string; path: string; body: unknown; status: number; response: unknown; headers?: Record<string, string> };

export type PurchaseResult = {
  ok: boolean;
  method: "paypal" | "venmo" | "paylater";
  verdict: string;
  /** Set when the purchase failed because of PayPal's sandbox or the test accounts, not the shop (never sent to the coding agent). */
  environment: string | null;
  bagTotal: string | null;
  paypalOrderId: string | null;
  paypalAmount: { value: string; currency: string } | null;
  /** PayPal's own status for the order at the end (CREATED, APPROVED, COMPLETED). */
  paypalStatus: string | null;
  captureId: string | null;
  captureStatus: string | null;
  /** The buyer pressed PayPal's approve button. */
  approved: boolean;
  /** Heistproof blocked the page's capture request after approval (an attack's setup). */
  captureBlocked: boolean;
  shopOrder: ShopOrder | null;
  calls: ShopCall[];
  screenshots: string[];
  buttons: Record<string, boolean>;
  payLaterMessage: string | null;
  consoleErrors: string[];
  /** PayPal scripts the page asked for, and PayPal requests that failed: the first clues when no button shows. */
  paypalScripts?: string[];
  failedRequests?: string[];
};

let context: BrowserContext | null = null;

export async function browser(): Promise<BrowserContext> {
  if (context) return context;
  const headless = env("HEISTPROOF_HEADED") !== "1";
  context = await chromium.launchPersistentContext(path.join(ROOT, ".heistproof", isOffline() ? "browser-profile-offline" : "browser-profile"), {
    headless,
    viewport: { width: 1440, height: 900 },
    // Film mode: sharper screenshots for zooming in.
    deviceScaleFactor: env("HEISTPROOF_FILM") === "1" ? 2 : 1,
    locale: "en-US",
    timezoneId: "America/Los_Angeles",
  });
  // Start every run signed out of PayPal, so the configured sandbox buyer is the one who pays.
  await context.clearCookies();
  if (isOffline()) await routeToStandIn(context);
  return context;
}

/** Offline: PayPal's browser script is the stand-in's, and nothing else from PayPal's domains loads. */
async function routeToStandIn(ctx: BrowserContext) {
  await ctx.route(/^https:\/\/([a-z0-9-]+\.)*paypal(objects)?\.com\//, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/web-sdk/v6/core")) {
      const live = url.hostname === "www.paypal.com";
      return route.fulfill({ status: 200, contentType: "application/javascript", body: standInSdk({ origin: paypal.apiBase(), clientId: paypal.clientId(), live }) });
    }
    return route.abort("blockedbyclient");
  });
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

/** Opens the shop like a shopper, fills the bag and returns the page with the checkout open. `watch` sees the page before it loads. */
export async function openCheckout(shop: ShopProcess, items: Array<{ sku: string; qty: number }>, watch?: (page: Page) => void): Promise<Page> {
  const ctx = await browser();
  const page = await ctx.newPage();
  watch?.(page);
  const { bag } = shop.profile;
  await page.goto(shop.url, { waitUntil: "domcontentloaded" });
  if (bag.storageKey) {
    await page.evaluate(([key, value]) => localStorage.setItem(key, value), [bag.storageKey, JSON.stringify(items)] as const);
    await page.reload({ waitUntil: "networkidle" });
  } else {
    await page.waitForLoadState("networkidle").catch(() => {});
    if (bag.add) for (const item of items) for (let i = 0; i < item.qty; i++) await page.click(bag.add.replace("{sku}", item.sku));
  }
  if (bag.open) await page.click(bag.open).catch(() => {});
  await page.waitForTimeout(pace(800));
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

type PurchaseOptions = {
  run: Run;
  phase: Phase;
  shop: ShopProcess;
  tap: WebhookTap | null;
  items: Array<{ sku: string; qty: number }>;
  method?: "paypal" | "venmo" | "paylater";
  label: string;
  /** Called after the buyer approves and before the page's capture request leaves; return "abort" to block it. */
  onBeforeCapture?: (orderId: string) => Promise<"continue" | "abort">;
  /** The attacker's edit of the page's create-order request body, as a thief would do in the browser's dev tools. */
  tamperCreate?: (body: any) => any;
  /** Skip the amount check (the attacker wants the wrong amount). */
  skipAmountCheck?: boolean;
  expectPaid?: boolean;
};

/** A purchase, started over (with a new PayPal order) when PayPal's sandbox checkout page itself fails. */
/**
 * Does PayPal's order charge what the bag says? The goods must cost exactly the bag total: PayPal's item total when the
 * order has a breakdown, else the whole amount. On top of the goods, the breakdown may add shipping, handling, insurance
 * or tax, but never a discount, and its parts must add up to the amount. A shop that adds $5 shipping passes; a shop that
 * asks for $4,900 for a $49 bag, or $0.01, does not.
 */
export function amountCheck(order: any, bagTotal: string | null | undefined): { ok: boolean; goods: string | null; extras: Array<{ kind: string; value: string }> } {
  const amount = order?.purchase_units?.[0]?.amount;
  if (!amount || bagTotal == null || amount.currency_code !== "USD") return { ok: false, goods: null, extras: [] };
  const b = amount.breakdown ?? {};
  const goods = String(b.item_total?.value ?? amount.value);
  const extras = ["shipping", "handling", "insurance", "tax_total"].filter((k) => Number(b[k]?.value ?? 0) > 0).map((k) => ({ kind: k === "tax_total" ? "tax" : k, value: String(b[k].value) }));
  const discounted = ["discount", "shipping_discount"].some((k) => Number(b[k]?.value ?? 0) > 0);
  const cents = (v: unknown) => Math.round(Number(v) * 100);
  const adds = cents(goods) + extras.reduce((n, e) => n + cents(e.value), 0);
  const ok = !discounted && cents(goods) === cents(bagTotal) && adds === cents(amount.value);
  return { ok, goods, extras };
}

export async function purchase(opts: PurchaseOptions): Promise<PurchaseResult> {
  let result = await purchaseOnce(opts);
  for (let attempt = 2; attempt <= 3 && result.environment === "sandbox-down"; attempt++) {
    opts.run.emit(opts.phase, "prove.sandbox_restart", { label: opts.label, attempt });
    await new Promise((r) => setTimeout(r, 5000));
    result = await purchaseOnce({ ...opts, label: `${opts.label}-try${attempt}` });
  }
  return result;
}

/** Why no button showed, in words the coding agent can act on. */
function noButton(method: string, r: PurchaseResult): string {
  const parts = [`The ${method} button never appeared.`];
  const scripts = r.paypalScripts ?? [];
  const live = scripts.find((u) => new URL(u).hostname === "www.paypal.com");
  if (!scripts.length) parts.push("The page never asked for PayPal's script (in sandbox: https://www.sandbox.paypal.com/web-sdk/v6/core).");
  else if (live) parts.push(`The page loaded PayPal's live script (${live}) in the sandbox; with a sandbox client id its buttons never render. Pick the script host from PAYPAL_ENV (sandbox or live), not from PAYPAL_API_BASE, which points at Heistproof's recording proxy.`);
  if (isOffline() && scripts.some((u) => !/\/web-sdk\/v6\/core/.test(u))) parts.push("Offline mode stands in for PayPal's JS SDK v6 only.");
  if (r.failedRequests?.length) parts.push(`Requests that failed: ${r.failedRequests.slice(0, 3).join(" | ")}.`);
  parts.push(r.consoleErrors.length ? `The browser console said: ${r.consoleErrors.slice(0, 4).join(" | ")}` : "The browser console showed no errors.");
  return parts.join(" ");
}

/**
 * One real sandbox purchase, the way a shopper makes it. Before approving, the PayPal order's amount is
 * checked against the bag total; a mismatch is reported and the purchase is cancelled.
 */
async function purchaseOnce(opts: PurchaseOptions): Promise<PurchaseResult> {
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
    environment: null,
    bagTotal: null,
    paypalOrderId: null,
    paypalAmount: null,
    paypalStatus: null,
    captureId: null,
    captureStatus: null,
    approved: false,
    captureBlocked: false,
    shopOrder: null,
    calls,
    screenshots: shots,
    buttons: {},
    payLaterMessage: null,
    consoleErrors: [],
    paypalScripts: [],
    failedRequests: [],
  };
  const known = new Set((await shopOrders(shop).catch(() => [] as ShopOrder[])).map((o) => o.id));

  const page = await openCheckout(shop, opts.items, (p) => {
    // What the shopper's browser complained about: handed to the coding agent when the checkout breaks.
    p.on("console", (m) => {
      if (m.type() === "error" && !/permissions policy|favicon/i.test(m.text())) result.consoleErrors.push(m.text().slice(0, 300));
    });
    p.on("pageerror", (err) => result.consoleErrors.push(`${err.name}: ${err.message}`.slice(0, 300)));
    p.on("request", (req) => {
      if (req.resourceType() === "script" && /(^|\.)paypal(objects)?\.com$/.test(new URL(req.url()).hostname)) result.paypalScripts!.push(req.url().slice(0, 200));
    });
    p.on("requestfailed", (req) => {
      if (/paypal/.test(new URL(req.url()).hostname)) result.failedRequests!.push(`${req.url().slice(0, 120)} (${req.failure()?.errorText ?? "failed"})`);
    });
  });
  const origin = new URL(shop.url).origin;
  let approvedOrderId: string | null = null;
  await page.route(`${origin}/**`, async (route) => {
    const req = route.request();
    if (req.method() === "POST" && !approvedOrderId && opts.tamperCreate) {
      let body: any = null;
      try {
        body = JSON.parse(req.postData() ?? "");
      } catch {
        /* not JSON */
      }
      if (itemList(body)) {
        const tampered = opts.tamperCreate(body);
        run.emit(phase, "prove.tampered", { label, path: new URL(req.url()).pathname, body: tampered });
        return route.continue({ postData: JSON.stringify(tampered) });
      }
    }
    if (req.method() === "POST" && approvedOrderId && opts.onBeforeCapture && (req.url().includes(approvedOrderId) || (req.postData() ?? "").includes(approvedOrderId))) {
      if ((await opts.onBeforeCapture(approvedOrderId)) === "abort") {
        result.captureBlocked = true;
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
    const headers = Object.fromEntries(Object.entries(await req.allHeaders().catch(() => ({}) as Record<string, string>)).filter(([k]) => /^(x-[\w-]+|content-type|authorization)$/i.test(k)));
    calls.push({ method: req.method(), path: new URL(req.url()).pathname, body, status: res.status(), response, headers });
  });

  result.bagTotal = money(await page.locator(shop.profile.bag.total).first().textContent().catch(() => null));
  // JS SDK v6 renders web components; v5 renders each button inside a PayPal iframe.
  await visible(page, "paypal-button, venmo-button, paypal-pay-later-button, iframe[src*='/smart/buttons']", pace(20_000));
  await page.waitForTimeout(pace(1500));
  for (const name of ["paypal", "venmo", "paylater"] as const) result.buttons[name] = Boolean(await payButton(page, name));
  result.payLaterMessage = await page
    .locator("paypal-message")
    .first()
    .evaluate((el: any) => (el.shadowRoot?.textContent ?? el.textContent ?? "").replace(/\s+/g, " ").trim(), null, { timeout: 2000 })
    .catch(() => null);
  await shot(page, "1-checkout");
  run.emit(phase, "prove.buttons", { label, buttons: result.buttons, payLaterMessage: result.payLaterMessage, bagTotal: result.bagTotal, paypalScripts: result.paypalScripts });
  if (!result.buttons[method]) {
    result.verdict = noButton(method, result);
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

  // Log in as the sandbox buyer if PayPal asks. Never past a CAPTCHA: if PayPal shows one, stop and say so.
  const buyer = isOffline() ? null : sandboxBuyer();
  const email = buyer?.email;
  const password = buyer?.password ?? null;
  // Only a CAPTCHA the buyer can actually see counts (PayPal's login page carries hidden captcha containers).
  const captcha = async () => {
    const lists = [
      popup.locator('iframe[src*="captcha" i], iframe[title*="captcha" i], iframe[src*="hcaptcha" i], iframe[src*="recaptcha" i]'),
      popup.getByText(/security challenge|verify you.re (a )?human|i.m not a robot/i),
    ];
    for (const list of lists) {
      const n = await list.count().catch(() => 0);
      for (let i = 0; i < n; i++) if (await list.nth(i).isVisible().catch(() => false)) return true;
    }
    return false;
  };
  const loginIfAsked = async () => {
    if (isOffline()) return; // the stand-in's buyer is already signed in
    if (await captcha()) throw new Error("captcha");
    const emailBox = popup.locator('input[name="login_email"], #email').first();
    if (!(await emailBox.waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false))) return;
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
    await popup.waitForTimeout(2000);
    if (await captcha()) throw new Error("captcha");
  };
  // PayPal's review page shows one primary button ("Complete Purchase", "Pay", "Continue").
  const approve = popup.locator('#payment-submit-btn, button[data-testid="submit-button-initial"], button:has-text("Complete Purchase"), button:has-text("Pay Now"), button:has-text("Continue to Review Order"), button:has-text("Agree & Continue")').first();

  // The amount check: what PayPal will charge versus what the shopper saw in the bag.
  if (result.paypalOrderId) {
    const order = await getOrder(result.paypalOrderId);
    result.paypalAmount = orderAmount(order.body);
    const check = amountCheck(order.body, result.bagTotal);
    const matches = check.ok;
    run.emit(phase, "prove.amount_check", { label, bagTotal: result.bagTotal, paypalAmount: result.paypalAmount, goods: check.goods, extras: check.extras, debugId: order.debugId, ok: Boolean(matches) });
    await popup.waitForTimeout(pace(2500));
    await shot(popup, "2-paypal");
    if (!matches && !opts.skipAmountCheck) {
      // Show the wrong amount on PayPal's own review page, then walk away without approving.
      if (password || isOffline()) {
        await loginIfAsked().catch(() => {});
        if (await approve.waitFor({ state: "visible", timeout: 30_000 }).then(() => true).catch(() => false)) {
          await popup.waitForTimeout(pace(1500));
          await shot(popup, "2b-paypal-wrong-amount");
        }
      }
      result.verdict = `PayPal would charge $${result.paypalAmount?.value ?? "?"} for a $${result.bagTotal} bag.`;
      result.paypalStatus = "CREATED";
      run.emit(phase, "prove.result", { label, ok: false, verdict: result.verdict, screenshots: [...shots] });
      await popup.close().catch(() => {});
      await page.close();
      return result;
    }
  }

  const stop = async (verdict: string, environment: string | null, name: string) => {
    await shot(popup, name);
    result.verdict = verdict;
    result.environment = environment;
    run.emit(phase, "prove.result", { label, ok: false, verdict, environment, screenshots: [...shots] });
    await popup.close().catch(() => {});
    await page.close();
    return result;
  };
  try {
    await loginIfAsked();
  } catch {
    return stop("PayPal asked for a CAPTCHA, so Heistproof stopped (it never solves one). Run with HEISTPROOF_HEADED=1 and complete it yourself.", "captcha", "3-captcha");
  }
  try {
    // PayPal's sandbox sometimes shows "Things don't appear to be working at the moment" with a Try again button.
    // That is the sandbox, not the shop: press Try again (twice at most) and keep waiting for the review page.
    const glitch = popup.getByText(/don.t appear to be working/i);
    const deadline = Date.now() + 60_000;
    let retries = 0;
    for (;;) {
      if (await approve.isVisible().catch(() => false)) break;
      if (retries < 2 && (await glitch.count().catch(() => 0))) {
        retries++;
        run.emit(phase, "prove.sandbox_retry", { label, attempt: retries });
        await popup.getByRole("button", { name: /try again/i }).click().catch(() => {});
        await popup.waitForTimeout(2500);
        await loginIfAsked().catch(() => {});
      }
      if (Date.now() > deadline) throw new Error("no review page");
      await popup.waitForTimeout(500);
    }
    await popup.waitForTimeout(pace(1500));
    await shot(popup, "3-review");
    approvedOrderId = result.paypalOrderId;
    await approve.click();
    result.approved = true;
    run.emit(phase, "prove.approved", { label, paypalOrderId: result.paypalOrderId });
  } catch {
    const refused = await popup.getByText(/info isn't correct|incorrect/i).count().catch(() => 0);
    const seller = await popup.getByText(/account of the seller/i).count().catch(() => 0);
    const sandboxDown = await popup.getByText(/don.t appear to be working/i).count().catch(() => 0);
    if (seller) return stop("The sandbox buyer is the shop's own seller account; use a Personal sandbox account as SANDBOX_BUYER_EMAIL.", "seller-account", "3-stuck");
    if (sandboxDown) return stop("PayPal's sandbox checkout page kept failing (\"Things don't appear to be working\"); not the shop's fault, try again.", "sandbox-down", "3-stuck");
    if (refused) return stop("PayPal refused the sandbox buyer's login (check SANDBOX_BUYER_PASSWORD).", "buyer-login", "3-stuck");
    return stop("Could not find PayPal's approve button (see screenshot).", null, "3-stuck");
  }
  await popup.waitForEvent("close", { timeout: 60_000 }).catch(() => {});

  // Wait for the outcome instead of a fixed pause: PayPal's capture, or the shop's answer to the page's capture request.
  const id = result.paypalOrderId;
  const answered = () => calls.some((c) => id && (c.path.includes(id) || JSON.stringify(c.body ?? "").includes(id)));
  const deadline = Date.now() + (result.captureBlocked ? pace(4000) : isOffline() ? 10_000 : 30_000);
  let answeredAt = 0;
  while (id && Date.now() < deadline) {
    const status = (await getOrder(id).catch(() => null))?.body?.status;
    if (status === "COMPLETED") break;
    if (answered() && !answeredAt) answeredAt = Date.now();
    if (answeredAt && Date.now() - answeredAt > pace(3000)) break;
    await page.waitForTimeout(pace(1000));
  }
  await shot(page, "4-after");

  // What PayPal holds and what the shop recorded.
  if (id) {
    const order = await getOrder(id);
    const capture = orderCapture(order.body);
    result.paypalStatus = order.body?.status ?? null;
    result.captureId = capture?.id ?? null;
    result.captureStatus = capture?.status ?? order.body?.status ?? null;
  }
  const orders = await settledOrders(shop, pace(1500), pace(12_000));
  const fresh = orders.filter((o) => !known.has(o.id));
  result.shopOrder =
    orders.find((o) => o.payment_reference && (o.payment_reference === result.captureId || o.payment_reference === id)) ??
    orders.find((o) => (id && JSON.stringify(o).includes(id)) || (result.captureId && JSON.stringify(o).includes(result.captureId))) ??
    (fresh.length === 1 ? fresh[0] : null);
  const paid = Boolean(result.shopOrder?.paid);
  if (opts.expectPaid === false) {
    result.ok = !paid;
    result.verdict = paid ? "The shop marked the order paid." : "The shop kept the order unpaid.";
  } else {
    result.ok = paid && result.captureStatus === "COMPLETED" && result.shopOrder?.shipments === 1;
    result.verdict = result.ok
      ? `Paid $${result.paypalAmount?.value}: capture ${result.captureId} COMPLETED, shop order ${result.shopOrder!.id} ${result.shopOrder!.status}, 1 label.`
      : `Capture ${result.captureStatus ?? "missing"}; shop order ${result.shopOrder?.id ?? "?"} is ${result.shopOrder?.status ?? "?"} with ${result.shopOrder?.shipments ?? 0} labels.`;
  }
  run.emit(phase, "prove.result", { label, ok: result.ok, verdict: result.verdict, captureId: result.captureId, paypalStatus: result.paypalStatus, shopOrder: result.shopOrder?.id, screenshots: [...shots] });
  await page.close();
  return result;
}
