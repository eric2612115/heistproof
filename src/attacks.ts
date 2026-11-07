import { getOrder, orderAmount } from "./paypal/rest.ts";
import { shopOrders, type ShopProcess } from "./shop-process.ts";
import { purchase, browser, type PurchaseResult, type ShopCall } from "./prove.ts";
import { paypal } from "./config.ts";
import type { PayPalProxy } from "./paypal/proxy.ts";
import type { WebhookTap, Delivery } from "./webhooks/tap.ts";
import type { Run } from "./events.ts";

export type Verdict = "held" | "robbed" | "skipped" | "error";
export type AttackOutcome = { id: string; title: string; rule: number[]; verdict: Verdict; summary: string; evidence: Record<string, unknown> };

export type AttackContext = {
  run: Run;
  shop: ShopProcess;
  proxy: PayPalProxy;
  tap: WebhookTap;
  legit: PurchaseResult;
  hoodie: Array<{ sku: string; qty: number }>;
};

type Attack = { id: string; title: string; rule: number[]; needsBuyer?: boolean; run: (ctx: AttackContext) => Promise<Omit<AttackOutcome, "id" | "title" | "rule">> };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** The checkout calls the shop's own page made during the real purchase: Heistproof learns the routes by watching. */
export function learnRoutes(legit: PurchaseResult): { create: ShopCall | null; capture: ShopCall | null } {
  const id = legit.paypalOrderId;
  const create = legit.calls.find((c) => id && JSON.stringify(c.response ?? "").includes(id) && !c.path.includes(id)) ?? null;
  const capture = legit.calls.find((c) => c !== create && id && (c.path.includes(id) || JSON.stringify(c.body ?? "").includes(id))) ?? inferredCapture(legit);
  return { create, capture };
}

const inferred = new WeakMap<PurchaseResult, ShopCall>();
function inferredCapture(legit: PurchaseResult): ShopCall | null {
  return inferred.get(legit) ?? null;
}

/**
 * When no purchase got as far as a capture, read the shop's own browser code for its capture route, the way an
 * attacker would: a path with "capture" in it and the order id interpolated.
 */
export async function discoverCaptureRoute(shop: ShopProcess, legit: PurchaseResult): Promise<void> {
  if (!legit.paypalOrderId || learnRoutes(legit).capture) return;
  const html = await (await fetch(shop.url)).text();
  const scripts = [...html.matchAll(/src="(\/[^"]+\.js)"/g)].map((m) => m[1]);
  for (const src of scripts) {
    const js = await (await fetch(`${shop.url}${src}`)).text();
    const m = /[`'"](\/[\w/-]*?)\$\{[^}]+\}([\w/-]*capture[\w/-]*)[`'"]/.exec(js) ?? /[`'"](\/[\w/-]*capture[\w/-]*)[`'"]/.exec(js);
    if (!m) continue;
    const route = m.length === 3 && m[2] ? `${m[1]}${legit.paypalOrderId}${m[2]}` : m[1];
    const body = route.includes(legit.paypalOrderId) ? {} : { orderID: legit.paypalOrderId, orderId: legit.paypalOrderId };
    inferred.set(legit, { method: "POST", path: route, body, status: 0, response: null });
    return;
  }
}

async function post(shop: ShopProcess, path: string, body: unknown) {
  const r = await fetch(`${shop.url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
  let json: any = null;
  const text = await r.text();
  try {
    json = JSON.parse(text);
  } catch {
    json = text.slice(0, 300);
  }
  return { status: r.status, body: json };
}

/** Finds the PayPal order id in whatever shape the shop's create route answers with. */
function paypalIdFrom(body: any): string | null {
  if (!body || typeof body !== "object") return null;
  for (const key of ["id", "orderId", "orderID", "paypalOrderId", "paypal_order_id"]) if (typeof body[key] === "string" && /^[0-9A-Z]{15,20}$/.test(body[key])) return body[key];
  const m = /"([0-9A-Z]{17})"/.exec(JSON.stringify(body));
  return m ? m[1] : null;
}

function withOrderId(call: ShopCall, from: string, to: string): { path: string; body: unknown } {
  return { path: call.path.split(from).join(to), body: JSON.parse(JSON.stringify(call.body ?? {}).split(from).join(to)) };
}

async function snapshot(shop: ShopProcess) {
  const orders = await shopOrders(shop);
  return {
    orders,
    paid: orders.filter((o) => ["paid", "fulfilled"].includes(o.status)).length,
    labels: orders.reduce((n, o) => n + (o.shipments ?? 0), 0),
  };
}

// What PayPal should charge: the bag total the shopper saw (the shop's own PayPal amount may be the bug).
const expectedValue = (ctx: AttackContext) => ctx.legit.bagTotal ?? ctx.legit.paypalAmount?.value ?? "49.00";

/** A genuine, signed PAYMENT.CAPTURE.COMPLETED delivery from this run. The sandbox can take a while to send one. */
async function genuineCompleted(ctx: AttackContext): Promise<Delivery | null> {
  const have = ctx.tap.genuine("PAYMENT.CAPTURE.COMPLETED");
  return have.find((d) => d.resourceId === ctx.legit.captureId) ?? have[0] ?? (await ctx.tap.waitFor((d) => d.eventType === "PAYMENT.CAPTURE.COMPLETED", 90_000));
}

/** Webhook attacks go last, so PayPal's slower deliveries have arrived by then. */
const ORDER = ["price-tamper", "bad-bag", "capture-unapproved", "approved-not-captured", "double-capture", "declined-capture", "forged-webhook", "webhook-replay", "out-of-order", "secret-leak"];

export const ATTACKS: Attack[] = [
  {
    id: "price-tamper",
    title: "Pay $0.01 for the $49 hoodie",
    rule: [1, 2],
    async run(ctx) {
      const { create } = learnRoutes(ctx.legit);
      if (!create) return { verdict: "error", summary: "Could not find the create-order request in the real purchase.", evidence: {} };
      const base = clone(create.body ?? {}) as any;
      const items = Array.isArray(base.items) ? base.items : Array.isArray(base.cart) ? base.cart : null;
      const variants: Array<{ name: string; body: any }> = [
        { name: "total fields set to one cent", body: { ...base, amount: "0.01", total: "0.01", totalCents: 1, price: 1, value: "0.01" } },
        { name: "item prices set to one cent", body: { ...base, ...(items ? { [Array.isArray(base.items) ? "items" : "cart"]: items.map((i: any) => ({ ...i, price: 1, priceCents: 1, unitCents: 1, unit_amount: { currency_code: "USD", value: "0.01" }, amount: "0.01" })) } : {}) } },
        { name: "currency switched to yen", body: { ...base, currency: "JPY", currency_code: "JPY", currencyCode: "JPY" } },
      ];
      const tries = [];
      let robbed = false;
      for (const v of variants) {
        const r = await post(ctx.shop, create.path, v.body);
        const id = paypalIdFrom(r.body);
        let amount = null;
        let debugId = null;
        if (id) {
          const o = await getOrder(id);
          amount = orderAmount(o.body);
          debugId = o.debugId;
          if (amount && (Number(amount.value) !== Number(expectedValue(ctx)) || amount.currency !== "USD")) robbed = true;
        }
        tries.push({ variant: v.name, shopStatus: r.status, paypalOrderId: id, paypalAmount: amount, debugId });
      }
      const worst = tries.find((t) => t.paypalAmount && (Number(t.paypalAmount.value) !== Number(expectedValue(ctx)) || t.paypalAmount.currency !== "USD"));
      if (!robbed) {
        return { verdict: "held", summary: `Every tampered request still produced a $${expectedValue(ctx)} USD PayPal order (or none).`, evidence: { request: create.path, expected: `USD ${expectedValue(ctx)}`, tries } };
      }
      // Follow through like a thief: tamper the request in the shopper's own browser, pay the wrong amount as the
      // sandbox buyer, and see whether the shop ships the hoodie anyway.
      const variant = variants[tries.indexOf(worst!)];
      const before = await snapshot(ctx.shop);
      const heist = await purchase({
        run: ctx.run,
        phase: "attack",
        shop: ctx.shop,
        tap: ctx.tap,
        items: ctx.hoodie,
        label: "attack-penny",
        tamperCreate: (body) => ({ ...body, ...Object.fromEntries(Object.entries(variant.body).filter(([k]) => !(k in base) || k === "items" || k === "cart")) }),
        skipAmountCheck: true,
        expectPaid: false,
      });
      await sleep(1500);
      const after = await snapshot(ctx.shop);
      // The shop owner's view of the same order: the back office.
      const office = await (await browser()).newPage();
      await office.goto(`${ctx.shop.url}/admin?key=${encodeURIComponent(ctx.shop.adminKey)}`).catch(() => {});
      await office.waitForTimeout(2500);
      const officeShot = "attack-penny-5-backoffice.png";
      await office.screenshot({ path: ctx.run.file(officeShot) }).catch(() => {});
      await office.close();
      heist.screenshots.push(officeShot);
      const pp = heist.paypalOrderId ? await getOrder(heist.paypalOrderId) : null;
      const captured = pp?.body?.purchase_units?.[0]?.payments?.captures?.[0]?.amount ?? null;
      const shipped = after.labels > before.labels;
      const shopOrder = after.orders.find((o: any) => JSON.stringify(o).includes(heist.paypalOrderId ?? "none")) ?? heist.shopOrder;
      return {
        verdict: "robbed",
        summary: shipped && captured
          ? `Shipped the $${expectedValue(ctx)} hoodie after PayPal captured ${captured.currency_code} ${captured.value} (order ${heist.paypalOrderId}); the shop's back office says ${shopOrder?.status ?? "paid"}.`
          : `The shop asked PayPal for ${worst!.paypalAmount!.currency} ${worst!.paypalAmount!.value} (order ${worst!.paypalOrderId}) after the browser said so.`,
        evidence: { request: create.path, expected: `USD ${expectedValue(ctx)}`, tries, followThrough: { paypalOrderId: heist.paypalOrderId, captured, shopOrder: shopOrder?.id, shopStatus: shopOrder?.status, shopPaidCents: shopOrder?.paid_cents, labelsAdded: after.labels - before.labels }, screenshots: heist.screenshots, paypalOrderId: heist.paypalOrderId },
      };
    },
  },
  {
    id: "bad-bag",
    title: "Negative, fractional and fake items",
    rule: [11],
    async run(ctx) {
      const { create } = learnRoutes(ctx.legit);
      if (!create) return { verdict: "error", summary: "No create-order request to replay.", evidence: {} };
      const base = clone(create.body ?? {}) as any;
      const key = Array.isArray(base.items) ? "items" : Array.isArray(base.cart) ? "cart" : null;
      if (!key) return { verdict: "skipped", summary: "The create request carries no item list.", evidence: { body: base } };
      const sku = base[key][0]?.sku ?? "FOG-HOODIE";
      const bags = [
        { name: "quantity -1", items: [{ sku, qty: -1, quantity: -1 }] },
        { name: "quantity 0.5", items: [{ sku, qty: 0.5, quantity: 0.5 }] },
        { name: "quantity 1000", items: [{ sku, qty: 1000, quantity: 1000 }] },
        { name: "unknown product", items: [{ sku: "FREE-HOODIE", qty: 1, quantity: 1 }] },
        { name: "empty bag", items: [] },
      ];
      const before = ctx.proxy.calls.length;
      const tries = [];
      for (const b of bags) {
        const r = await post(ctx.shop, create.path, { ...base, [key]: b.items });
        tries.push({ bag: b.name, shopStatus: r.status, paypalOrderId: paypalIdFrom(r.body) });
      }
      const created = ctx.proxy.since(before).filter((c) => c.method === "POST" && c.path === "/v2/checkout/orders" && c.status < 300);
      const robbed = created.length > 0;
      return {
        verdict: robbed ? "robbed" : "held",
        summary: robbed ? `${created.length} bad bag(s) still became PayPal orders.` : "All five bad bags were refused before any PayPal order was created.",
        evidence: { tries, paypalOrdersCreated: created.map((c) => ({ status: c.status, debugId: c.debugId, amount: (c.responseBody as any)?.purchase_units?.[0]?.amount })) },
      };
    },
  },
  {
    id: "capture-unapproved",
    title: "Claim payment for an order nobody approved",
    rule: [4],
    async run(ctx) {
      const { create, capture } = learnRoutes(ctx.legit);
      if (!create || !capture || !ctx.legit.paypalOrderId) return { verdict: "error", summary: "Could not learn the create and capture requests.", evidence: {} };
      const before = await snapshot(ctx.shop);
      const made = await post(ctx.shop, create.path, create.body);
      const fresh = paypalIdFrom(made.body);
      if (!fresh) return { verdict: "error", summary: "The shop did not return a PayPal order id.", evidence: { made } };
      const replay = withOrderId(capture, ctx.legit.paypalOrderId, fresh);
      const r = await post(ctx.shop, replay.path, replay.body);
      await sleep(1500);
      const after = await snapshot(ctx.shop);
      const robbed = after.paid > before.paid || after.labels > before.labels;
      const pp = await getOrder(fresh);
      return {
        verdict: robbed ? "robbed" : "held",
        summary: robbed ? `The shop marked order ${fresh} paid although PayPal says ${pp.body?.status}.` : `PayPal refused the capture (order ${fresh} is ${pp.body?.status}); the shop stayed unpaid.`,
        evidence: { paypalOrderId: fresh, paypalStatus: pp.body?.status, captureRequest: replay.path, shopAnswer: r, paidBefore: before.paid, paidAfter: after.paid, labelsBefore: before.labels, labelsAfter: after.labels },
      };
    },
  },
  {
    id: "forged-webhook",
    title: "Forge PayPal's 'payment completed' webhook",
    rule: [6],
    async run(ctx) {
      const { create } = learnRoutes(ctx.legit);
      const genuine = await genuineCompleted(ctx);
      if (!create || !genuine) return { verdict: "skipped", summary: "PayPal's sandbox delivered no PAYMENT.CAPTURE.COMPLETED webhook in time to forge from.", evidence: {} };
      const made = await post(ctx.shop, create.path, create.body);
      const target = paypalIdFrom(made.body);
      const before = await snapshot(ctx.shop);
      const pending = before.orders.find((o) => o.status === "pending" && JSON.stringify(o).includes(target ?? "none")) ?? before.orders.find((o) => o.status === "pending");
      const event = JSON.parse(genuine.rawBody);
      const forge = (e: any) => {
        e.id = `WH-FORGED-${Date.now()}`;
        e.resource.id = `FORGED${Date.now()}`;
        if (pending) e.resource.custom_id = pending.id;
        if (e.resource.supplementary_data?.related_ids) e.resource.supplementary_data.related_ids.order_id = target;
        return JSON.stringify(e);
      };
      const unsigned = await ctx.tap.forward("attacker", { "content-type": "application/json" }, forge(clone(event)));
      const resigned = await ctx.tap.forward("attacker", genuine.headers, forge(clone(event)));
      await sleep(1500);
      const after = await snapshot(ctx.shop);
      const robbed = after.paid > before.paid || after.labels > before.labels;
      return {
        verdict: robbed ? "robbed" : "held",
        summary: robbed ? "A forged event marked an unpaid order paid." : `Forged events were refused (HTTP ${unsigned.shopStatus} unsigned, ${resigned.shopStatus} with stolen headers); nothing changed.`,
        evidence: { targetShopOrder: pending?.id, targetPayPalOrder: target, unsignedAnswer: unsigned.shopStatus, stolenHeadersAnswer: resigned.shopStatus, paidBefore: before.paid, paidAfter: after.paid },
      };
    },
  },
  {
    id: "webhook-replay",
    title: "Replay a real webhook to ship twice",
    rule: [7, 8],
    async run(ctx) {
      const genuine = await genuineCompleted(ctx);
      if (!genuine) return { verdict: "skipped", summary: "PayPal's sandbox delivered no PAYMENT.CAPTURE.COMPLETED webhook in time to replay.", evidence: {} };
      const before = await snapshot(ctx.shop);
      const answers = [];
      for (let i = 0; i < 3; i++) answers.push((await ctx.tap.forward("attacker", genuine.headers, genuine.rawBody)).shopStatus);
      await sleep(1500);
      const after = await snapshot(ctx.shop);
      const robbed = after.labels > before.labels;
      return {
        verdict: robbed ? "robbed" : "held",
        summary: robbed ? `Replaying event ${genuine.eventId} printed ${after.labels - before.labels} extra shipping label(s).` : `Event ${genuine.eventId} replayed 3 times byte for byte: still one label.`,
        evidence: { eventId: genuine.eventId, answers, labelsBefore: before.labels, labelsAfter: after.labels },
      };
    },
  },
  {
    id: "out-of-order",
    title: "Send 'approved' after 'completed'",
    rule: [9],
    async run(ctx) {
      // The purchase's own "approved" event; PayPal's sandbox may still be on its way with it.
      const approved =
        ctx.tap.genuine("CHECKOUT.ORDER.APPROVED").find((d) => d.resourceId === ctx.legit.paypalOrderId) ??
        (await ctx.tap.waitFor((d) => d.eventType === "CHECKOUT.ORDER.APPROVED" && d.resourceId === ctx.legit.paypalOrderId, 60_000));
      if (!approved) return { verdict: "skipped", summary: "PayPal sent no CHECKOUT.ORDER.APPROVED event for the real purchase.", evidence: {} };
      const before = await snapshot(ctx.shop);
      const legitBefore = before.orders.find((o) => o.id === ctx.legit.shopOrder?.id);
      const r = await ctx.tap.forward("attacker", approved.headers, approved.rawBody);
      await sleep(1500);
      const after = await snapshot(ctx.shop);
      const legitAfter = after.orders.find((o) => o.id === ctx.legit.shopOrder?.id);
      const robbed = legitAfter?.status !== legitBefore?.status || after.labels > before.labels;
      return {
        verdict: robbed ? "robbed" : "held",
        summary: robbed ? `The late event moved order ${legitAfter?.id} from ${legitBefore?.status} to ${legitAfter?.status}.` : `Order ${legitAfter?.id} stayed ${legitAfter?.status} after a late 'approved' event.`,
        evidence: { eventId: approved.eventId, shopAnswer: r.shopStatus, before: legitBefore?.status, after: legitAfter?.status },
      };
    },
  },
  {
    id: "approved-not-captured",
    title: "Get it shipped on approval alone",
    rule: [4, 8],
    needsBuyer: true,
    async run(ctx) {
      const before = await snapshot(ctx.shop);
      const p = await purchase({ run: ctx.run, phase: "attack", shop: ctx.shop, tap: ctx.tap, items: ctx.hoodie, label: "attack-approved-only", onBeforeCapture: async () => "abort", expectPaid: false });
      const approvedEvent = p.paypalOrderId ? await ctx.tap.waitFor((d) => d.eventType === "CHECKOUT.ORDER.APPROVED" && d.resourceId === p.paypalOrderId, 60_000) : null;
      await sleep(1500);
      const after = await snapshot(ctx.shop);
      const robbed = after.labels > before.labels || after.paid > before.paid;
      (ctx as any).approvedOnly = p.paypalOrderId;
      return {
        verdict: robbed ? "robbed" : "held",
        summary: robbed
          ? `Order ${p.paypalOrderId} was approved but never captured, and the shop still marked it paid.`
          : `Buyer approved order ${p.paypalOrderId}, the capture was blocked${approvedEvent ? " and PayPal's 'approved' webhook arrived" : ""}: nothing paid, nothing shipped.`,
        evidence: { paypalOrderId: p.paypalOrderId, approvedWebhook: approvedEvent?.eventId ?? null, approvedWebhookAnswer: approvedEvent?.shopStatus ?? null, paidBefore: before.paid, paidAfter: after.paid, labelsBefore: before.labels, labelsAfter: after.labels, screenshots: p.screenshots },
      };
    },
  },
  {
    id: "double-capture",
    title: "Double-click: capture twice at once",
    rule: [8, 10],
    async run(ctx) {
      const { capture } = learnRoutes(ctx.legit);
      const target = (ctx as any).approvedOnly as string | undefined;
      if (!capture || !ctx.legit.paypalOrderId || !target) return { verdict: "skipped", summary: "Needs an approved, uncaptured order from the previous attack.", evidence: {} };
      const before = await snapshot(ctx.shop);
      const replay = withOrderId(capture, ctx.legit.paypalOrderId, target);
      const answers = await Promise.all([post(ctx.shop, replay.path, replay.body), post(ctx.shop, replay.path, replay.body)]);
      await sleep(4000);
      const after = await snapshot(ctx.shop);
      const pp = await getOrder(target);
      const captures = pp.body?.purchase_units?.[0]?.payments?.captures ?? [];
      const labels = after.labels - before.labels;
      const robbed = labels > 1;
      return {
        verdict: robbed ? "robbed" : "held",
        summary: robbed ? `Two simultaneous captures printed ${labels} labels for one payment.` : `Two simultaneous captures: PayPal captured ${captures.length}, the shop printed ${labels} label.`,
        evidence: { paypalOrderId: target, shopAnswers: answers.map((a) => a.status), paypalCaptures: captures.map((c: any) => ({ id: c.id, status: c.status, amount: c.amount })), labelsAdded: labels },
      };
    },
  },
  {
    id: "declined-capture",
    title: "Card declined at capture (PayPal negative testing)",
    rule: [5],
    needsBuyer: true,
    async run(ctx) {
      const before = await snapshot(ctx.shop);
      const mark = ctx.proxy.calls.length;
      ctx.proxy.arm({ id: "declined", method: "POST", path: /^\/v2\/checkout\/orders\/[^/]+\/capture$/, mockResponse: { mock_application_codes: "INSTRUMENT_DECLINED" }, times: 1 });
      const p = await purchase({ run: ctx.run, phase: "attack", shop: ctx.shop, tap: ctx.tap, items: ctx.hoodie, label: "attack-declined", expectPaid: false });
      ctx.proxy.disarm("declined");
      await sleep(1500);
      const after = await snapshot(ctx.shop);
      const injected = ctx.proxy.since(mark).find((c) => c.injected);
      const robbed = after.paid > before.paid || after.labels > before.labels;
      return {
        verdict: injected ? (robbed ? "robbed" : "held") : "error",
        summary: !injected
          ? "The shop never sent a capture call through the harness, so the decline could not be injected."
          : robbed
            ? `PayPal answered ${injected.status} ${(injected.responseBody as any)?.details?.[0]?.issue ?? ""} but the shop marked the order paid.`
            : `PayPal answered ${injected.status} ${(injected.responseBody as any)?.details?.[0]?.issue ?? ""} (debug id ${injected.debugId}); the shop kept the order unpaid.`,
        evidence: { paypalOrderId: p.paypalOrderId, injected: injected ? { status: injected.status, debugId: injected.debugId, issue: (injected.responseBody as any)?.details?.[0]?.issue } : null, shopAnswer: p.calls.at(-1)?.status ?? null, paidBefore: before.paid, paidAfter: after.paid, screenshots: p.screenshots },
      };
    },
  },
  {
    id: "secret-leak",
    title: "Find the PayPal secret in the browser",
    rule: [12],
    async run(ctx) {
      const secret = paypal.clientSecret();
      const pages = ["/", "/app.js", "/admin", "/api/paypal/config"];
      const html = await (await fetch(ctx.shop.url)).text();
      for (const m of html.matchAll(/src="(\/[^"]+\.js)"/g)) pages.push(m[1]);
      const hits: string[] = [];
      for (const p of [...new Set(pages)]) {
        const r = await fetch(`${ctx.shop.url}${p}`).catch(() => null);
        if (r && (await r.text()).includes(secret)) hits.push(p);
      }
      return {
        verdict: hits.length ? "robbed" : "held",
        summary: hits.length ? `The client secret is served at ${hits.join(", ")}.` : `Checked ${new Set(pages).size} pages and scripts: only the client id is public.`,
        evidence: { checked: [...new Set(pages)], leakedAt: hits },
      };
    },
  },
];

export async function runAttacks(ctx: AttackContext, only?: string[]): Promise<AttackOutcome[]> {
  const out: AttackOutcome[] = [];
  await discoverCaptureRoute(ctx.shop, ctx.legit).catch(() => {});
  for (const id of ORDER) {
    const a = ATTACKS.find((x) => x.id === id)!;
    if (only && !only.includes(a.id)) continue;
    ctx.run.emit("attack", "attack.start", { id: a.id, title: a.title });
    let outcome: AttackOutcome;
    try {
      outcome = { id: a.id, title: a.title, rule: a.rule, ...(await a.run(ctx)) };
    } catch (err) {
      outcome = { id: a.id, title: a.title, rule: a.rule, verdict: "error", summary: String((err as Error).message ?? err).slice(0, 300), evidence: {} };
    }
    ctx.run.emit("attack", "attack.result", outcome);
    out.push(outcome);
  }
  return out;
}

export type { Delivery };
