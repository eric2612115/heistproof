import { getOrder, orderAmount } from "./paypal/rest.ts";
import { shopOrders, settledOrders, backOfficeUrl, type ShopProcess } from "./shop-process.ts";
import type { ShopOrder } from "./shop-profile.ts";
import { purchase, browser, type PurchaseResult, type ShopCall } from "./prove.ts";
import { paypal, pace } from "./config.ts";
import type { PayPalProxy } from "./paypal/proxy.ts";
import type { WebhookTap, Delivery } from "./webhooks/tap.ts";
import type { Run } from "./events.ts";

export type Verdict = "held" | "robbed" | "skipped" | "error";
export type AttackOutcome = {
  id: string;
  title: string;
  /** What the robbery tries, in plain words. */
  what: string;
  rule: number[];
  verdict: Verdict;
  summary: string;
  /** Parts of the robbery that could not be tested in this run (for example a webhook PayPal never sent). */
  untested?: string[];
  evidence: Record<string, unknown>;
};

export type AttackContext = {
  run: Run;
  round: number;
  shop: ShopProcess;
  proxy: PayPalProxy;
  tap: WebhookTap;
  legit: PurchaseResult;
  items: Array<{ sku: string; qty: number }>;
};

type Result = Omit<AttackOutcome, "id" | "title" | "what" | "rule">;
type Attack = { id: string; title: string; what: string; rule: number[]; run: (ctx: AttackContext) => Promise<Result> };

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const prefix = (ctx: AttackContext) => `round${ctx.round}`;

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
  for (const js of await shopScripts(shop)) {
    const m = /[`'"](\/[\w/-]*?)\$\{[^}]+\}([\w/-]*capture[\w/-]*)[`'"]/.exec(js.text) ?? /[`'"](\/[\w/-]*capture[\w/-]*)[`'"]/.exec(js.text);
    if (!m) continue;
    const route = m.length === 3 && m[2] ? `${m[1]}${legit.paypalOrderId}${m[2]}` : m[1];
    const body = route.includes(legit.paypalOrderId) ? {} : { orderID: legit.paypalOrderId, orderId: legit.paypalOrderId };
    inferred.set(legit, { method: "POST", path: route, body, status: 0, response: null });
    return;
  }
}

/** Every same-origin script the storefront loads, following module imports (what an attacker can read). */
async function shopScripts(shop: ShopProcess, limit = 40): Promise<Array<{ path: string; text: string }>> {
  const html = await (await fetch(shop.url)).text();
  const queue = [...html.matchAll(/<script[^>]*\ssrc=["']([^"']+)["']/g), ...html.matchAll(/<link[^>]*rel=["']modulepreload["'][^>]*href=["']([^"']+)["']/g)].map((m) => m[1]);
  const seen = new Set<string>();
  const out: Array<{ path: string; text: string }> = [];
  while (queue.length && out.length < limit) {
    const ref = queue.shift()!;
    let url: URL;
    try {
      url = new URL(ref, `${shop.url}/`);
    } catch {
      continue;
    }
    if (url.origin !== new URL(shop.url).origin || seen.has(url.pathname)) continue;
    seen.add(url.pathname);
    const r = await fetch(url).catch(() => null);
    if (!r?.ok) continue;
    const text = await r.text();
    out.push({ path: url.pathname, text });
    for (const m of text.matchAll(/(?:import|export)\s[^'"`]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|import\s*["']([^"']+)["']/g)) {
      const next = m[1] ?? m[2] ?? m[3];
      if (next && (next.startsWith("/") || next.startsWith("."))) queue.push(new URL(next, url).pathname);
    }
  }
  return out;
}

/**
 * Sends a request to the shop the way the shopper's browser sent it: from the same browser profile (its cookies) and
 * with the headers the page used (a CSRF token, say), so a refusal means the shop refused the tampering, not a stranger.
 */
async function send(ctx: AttackContext, call: Pick<ShopCall, "path" | "headers">, body: unknown) {
  const r = await (await browser()).request.post(`${ctx.shop.url}${call.path}`, {
    headers: { "content-type": "application/json", ...(call.headers ?? {}) },
    data: typeof body === "string" ? body : JSON.stringify(body ?? {}),
    failOnStatusCode: false,
  });
  const text = await r.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text.slice(0, 300);
  }
  return { status: r.status(), body: json };
}

/** Finds the PayPal order id in whatever shape the shop's create route answers with. */
function paypalIdFrom(body: any): string | null {
  if (!body || typeof body !== "object") return null;
  for (const key of ["id", "orderId", "orderID", "paypalOrderId", "paypal_order_id"]) if (typeof body[key] === "string" && /^[0-9A-Z]{15,20}$/.test(body[key])) return body[key];
  const m = /"([0-9A-Z]{17})"/.exec(JSON.stringify(body));
  return m ? m[1] : null;
}

function withOrderId(call: ShopCall, from: string, to: string): ShopCall {
  return { ...call, path: call.path.split(from).join(to), body: JSON.parse(JSON.stringify(call.body ?? {}).split(from).join(to)) };
}

// What PayPal should charge: the bag total the shopper saw (the shop's own PayPal amount may be the bug).
const expectedValue = (ctx: AttackContext) => ctx.legit.bagTotal ?? ctx.legit.paypalAmount?.value ?? "?";
const wrongAmount = (ctx: AttackContext, a: { value: string; currency: string } | null) => Boolean(a && (Number(a.value) !== Number(expectedValue(ctx)) || a.currency !== "USD"));

/** The shop orders an attack touched: those that mention one of the ids, or else the orders that are new since `before`. */
function targets(before: ShopOrder[], after: ShopOrder[], ids: Array<string | null | undefined>): ShopOrder[] {
  const wanted = ids.filter((x): x is string => typeof x === "string" && x.length >= 6);
  const named = after.filter((o) => wanted.some((id) => o.id === id || JSON.stringify(o).includes(id)));
  if (named.length) return named;
  const old = new Set(before.map((o) => o.id));
  return after.filter((o) => !old.has(o.id));
}

/** Did the attack make the shop treat any of these orders as paid, or print a label for them? */
function damage(before: ShopOrder[], after: ShopOrder[], touched: ShopOrder[]) {
  const was = new Map(before.map((o) => [o.id, o]));
  const paidNow = touched.filter((o) => o.paid && !was.get(o.id)?.paid);
  const labels = touched.reduce((n, o) => n + Math.max(0, o.shipments - (was.get(o.id)?.shipments ?? 0)), 0);
  return { paidNow, labels, orders: touched.map((o) => ({ id: o.id, before: was.get(o.id)?.status ?? null, after: o.status, labelsBefore: was.get(o.id)?.shipments ?? 0, labelsAfter: o.shipments })) };
}

const settle = (ctx: AttackContext, maxMs = 12_000) => settledOrders(ctx.shop, pace(1500), pace(maxMs));

/**
 * The positive control for every replayed request: the shop's own create-order request, sent again unchanged, must give
 * a PayPal order just like the shopper's did. If it does not, a refused tampered request would prove nothing.
 */
const controls = new WeakMap<AttackContext, Promise<{ ok: boolean; why: string; create: ShopCall | null; paypalOrderId: string | null }>>();
function control(ctx: AttackContext) {
  if (!controls.has(ctx))
    controls.set(
      ctx,
      (async () => {
        const { create } = learnRoutes(ctx.legit);
        if (!create) return { ok: false, why: "the real purchase showed no create-order request to replay", create: null, paypalOrderId: null };
        const r = await send(ctx, create, create.body);
        const id = paypalIdFrom(r.body);
        if (r.status >= 300 || !id) return { ok: false, why: `the shop answered its own create-order request, replayed unchanged, with HTTP ${r.status} and no PayPal order`, create, paypalOrderId: null };
        // Faithful means the same PayPal amount the shopper's own request produced (which may itself be the bug).
        const amount = orderAmount((await getOrder(id)).body);
        const want = ctx.legit.paypalAmount ?? { value: expectedValue(ctx), currency: "USD" };
        if (!amount || Number(amount.value) !== Number(want.value) || amount.currency !== want.currency) return { ok: false, why: `the unchanged request gave a PayPal order for ${amount?.currency} ${amount?.value}, where the shopper's own request gave ${want.currency} ${want.value}`, create, paypalOrderId: id };
        return { ok: true, why: "", create, paypalOrderId: id };
      })(),
    );
  return controls.get(ctx)!;
}
const noControl = (why: string): Result => ({ verdict: "error", summary: `Heistproof could not replay the checkout faithfully (${why}), so a refused robbery would prove nothing.`, evidence: { control: why } });

/** The ids a PayPal event names: its resource, the order the resource belongs to, and the shop's own references. */
function eventIds(d: Delivery): string[] {
  let r: any = {};
  try {
    r = JSON.parse(d.rawBody)?.resource ?? {};
  } catch {
    r = {};
  }
  return [r.id, r.custom_id, r.invoice_id, r.supplementary_data?.related_ids?.order_id].filter((x): x is string => typeof x === "string" && x.length >= 6);
}

/**
 * The shop order a PayPal event is about, or null. One sandbox app can serve several shops, and every webhook
 * registered on the app receives every event, so events about other shops' orders arrive here too.
 */
export function shopOrderFor(d: Delivery, orders: ShopOrder[], legit: PurchaseResult): ShopOrder | null {
  const ids = eventIds(d);
  const legitId = legit.shopOrder?.id;
  if (legitId && ids.some((id) => id === legit.captureId || id === legit.paypalOrderId)) return orders.find((o) => o.id === legitId) ?? null;
  return orders.find((o) => ids.some((id) => o.id === id || JSON.stringify(o).includes(id))) ?? null;
}

/**
 * A genuine, signed PAYMENT.CAPTURE.COMPLETED delivery from this run. With `ours`, only one about this shop's own
 * orders (a replay needs one); without, any will do as a template. The sandbox can take a while to send one.
 */
async function genuineCompleted(ctx: AttackContext, ours = true): Promise<Delivery | null> {
  const have = ctx.tap.genuine("PAYMENT.CAPTURE.COMPLETED");
  const legit = have.find((d) => d.resourceId === ctx.legit.captureId);
  if (legit) return legit;
  const orders = await shopOrders(ctx.shop).catch(() => [] as ShopOrder[]);
  const fits = (d: Delivery) => d.eventType === "PAYMENT.CAPTURE.COMPLETED" && (!ours || shopOrderFor(d, orders, ctx.legit) !== null);
  return have.find(fits) ?? (await ctx.tap.waitFor(fits, pace(90_000)));
}

/**
 * Webhook attacks go late, so PayPal's slower deliveries have arrived by then. Double capture goes after them: it uses
 * the order approval-alone left approved, whose "approved" webhook gets the longest time to arrive before it is captured.
 */
export const ORDER = ["price-tamper", "bad-bag", "capture-unapproved", "approved-not-captured", "declined-capture", "forged-webhook", "webhook-replay", "out-of-order", "double-capture", "secret-leak"];

/** The order approval-alone leaves approved and uncaptured at PayPal: double capture captures it twice at once. */
const approvedOrder = new WeakMap<AttackContext, string>();
/** Approval-alone's verdict on PayPal's "approved" webhook, finished just before double capture. */
const approvedOnly = new WeakMap<AttackContext, { orderId: string; outcome: AttackOutcome; finish: () => Promise<void> }>();

export const ATTACKS: Attack[] = [
  {
    id: "price-tamper",
    title: "Price tampering",
    what: "Pay $0.01 for the $49 hoodie",
    rule: [1, 2],
    async run(ctx) {
      const c = await control(ctx);
      if (!c.ok || !c.create) return noControl(c.why);
      const create = c.create;
      const base = clone(create.body ?? {}) as any;
      const items = Array.isArray(base.items) ? base.items : Array.isArray(base.cart) ? base.cart : null;
      const variants: Array<{ name: string; body: any }> = [
        { name: "total fields set to one cent", body: { ...base, amount: "0.01", total: "0.01", totalCents: 1, price: 1, value: "0.01" } },
        { name: "item prices set to one cent", body: { ...base, ...(items ? { [Array.isArray(base.items) ? "items" : "cart"]: items.map((i: any) => ({ ...i, price: 1, priceCents: 1, unitCents: 1, unit_amount: { currency_code: "USD", value: "0.01" }, amount: "0.01" })) } : {}) } },
        { name: "currency switched to yen", body: { ...base, currency: "JPY", currency_code: "JPY", currencyCode: "JPY" } },
      ];
      const tries = [];
      for (const v of variants) {
        const r = await send(ctx, create, v.body);
        const id = paypalIdFrom(r.body);
        let amount = null;
        let debugId = null;
        if (id) {
          const o = await getOrder(id);
          amount = orderAmount(o.body);
          debugId = o.debugId;
        }
        tries.push({ variant: v.name, shopStatus: r.status, paypalOrderId: id, paypalAmount: amount, debugId });
      }
      const worst = tries.find((t) => wrongAmount(ctx, t.paypalAmount));
      const evidence: Record<string, unknown> = { request: create.path, expected: `USD ${expectedValue(ctx)}`, control: { paypalOrderId: c.paypalOrderId }, tries };
      if (!worst) return { verdict: "held", summary: `Every tampered request still produced a USD ${expectedValue(ctx)} PayPal order, or none (the unchanged request did produce one).`, evidence };
      // Follow through like a thief: tamper the request in the shopper's own browser, pay the wrong amount as the
      // buyer, and see whether the shop ships the hoodie anyway.
      const variant = variants[tries.indexOf(worst)];
      const before = await settle(ctx);
      const heist = await purchase({
        run: ctx.run,
        phase: "attack",
        shop: ctx.shop,
        tap: ctx.tap,
        items: ctx.items,
        label: `${prefix(ctx)}-attack-penny`,
        tamperCreate: (body) => ({ ...body, ...Object.fromEntries(Object.entries(variant.body).filter(([k]) => !(k in base) || k === "items" || k === "cart")) }),
        skipAmountCheck: true,
        expectPaid: false,
      });
      const after = await settle(ctx);
      const touched = targets(before, after, [heist.paypalOrderId, heist.captureId]);
      const d = damage(before, after, touched);
      const shopOrder = touched[0] ?? heist.shopOrder;
      // The shop owner's view of the same order: the back office.
      const office = await (await browser()).newPage();
      await office.goto(backOfficeUrl(ctx.shop)).catch(() => {});
      await office.waitForTimeout(pace(2500));
      const officeShot = `${prefix(ctx)}-attack-penny-5-backoffice.png`;
      await office.screenshot({ path: ctx.run.file(officeShot) }).catch(() => {});
      await office.close();
      heist.screenshots.push(officeShot);
      const pp = heist.paypalOrderId ? await getOrder(heist.paypalOrderId) : null;
      const captured = pp?.body?.purchase_units?.[0]?.payments?.captures?.[0]?.amount ?? null;
      const followThrough = { paypalOrderId: heist.paypalOrderId, approved: heist.approved, captured, shopOrder: shopOrder?.id ?? null, shopStatus: shopOrder?.status ?? null, labelsAdded: d.labels, paidNow: d.paidNow.map((o) => o.id) };
      const robbed = d.paidNow.length > 0 || d.labels > 0;
      if (!robbed && captured) {
        return {
          verdict: "held",
          summary: `The shop asked PayPal for ${worst.paypalAmount!.currency} ${worst.paypalAmount!.value}, but after PayPal captured ${captured.currency_code} ${captured.value} it refused to ship (order ${heist.paypalOrderId}).`,
          evidence: { ...evidence, followThrough, screenshots: heist.screenshots, paypalOrderId: heist.paypalOrderId },
        };
      }
      return {
        verdict: "robbed",
        summary: robbed
          ? `Shipped the $${expectedValue(ctx)} hoodie after PayPal captured ${captured ? `${captured.currency_code} ${captured.value}` : "the tampered amount"} (order ${heist.paypalOrderId}); the shop's back office says ${shopOrder?.status ?? "paid"}.`
          : `The shop asked PayPal for ${worst.paypalAmount!.currency} ${worst.paypalAmount!.value} (order ${worst.paypalOrderId}) when the bag said USD ${expectedValue(ctx)}; the follow-through purchase did not finish (${heist.verdict}).`,
        evidence: { ...evidence, followThrough, screenshots: heist.screenshots, paypalOrderId: heist.paypalOrderId },
      };
    },
  },
  {
    id: "bad-bag",
    title: "Negative quantity",
    what: "Buy -1, 0.5 or 1,000 hoodies, or a product that doesn't exist",
    rule: [11],
    async run(ctx) {
      const c = await control(ctx);
      if (!c.ok || !c.create) return noControl(c.why);
      const base = clone(c.create.body ?? {}) as any;
      const key = Array.isArray(base.items) ? "items" : Array.isArray(base.cart) ? "cart" : null;
      if (!key) return { verdict: "skipped", summary: "The create request carries no item list.", evidence: { body: base } };
      const orig = base[key][0] ?? {};
      const sku = orig.sku ?? orig.id ?? orig.productId ?? ctx.items[0]?.sku;
      // Each bad bag keeps the real item's fields and changes only what the robbery is about.
      const withQty = (q: number) => ({ ...orig, ...("qty" in orig || !("quantity" in orig) ? { qty: q } : {}), ...("quantity" in orig ? { quantity: q } : {}) });
      const unknown = Object.fromEntries(Object.entries(orig).map(([k, v]) => [k, v === sku ? "FREE-HOODIE" : v]));
      const bags = [
        { name: "quantity -1", items: [withQty(-1)] },
        { name: "quantity 0.5", items: [withQty(0.5)] },
        { name: "quantity 1000", items: [withQty(1000)] },
        { name: "unknown product", items: [{ ...unknown, sku: "FREE-HOODIE" }] },
        { name: "empty bag", items: [] },
      ];
      const mark = ctx.proxy.calls.length;
      const tries = [];
      for (const b of bags) {
        const r = await send(ctx, c.create, { ...base, [key]: b.items });
        tries.push({ bag: b.name, shopStatus: r.status, paypalOrderId: paypalIdFrom(r.body) });
      }
      const created = ctx.proxy.since(mark).filter((x) => x.method === "POST" && x.path === "/v2/checkout/orders" && x.status < 300);
      const robbed = created.length > 0;
      return {
        verdict: robbed ? "robbed" : "held",
        summary: robbed ? `${created.length} bad bag(s) still became PayPal orders.` : "All five bad bags were refused before any PayPal order was created (the unchanged bag did create one).",
        evidence: { tries, paypalOrdersCreated: created.map((x) => ({ status: x.status, debugId: x.debugId, amount: (x.responseBody as any)?.purchase_units?.[0]?.amount })) },
      };
    },
  },
  {
    id: "capture-unapproved",
    title: "Payment nobody approved",
    what: "Claim payment for an order no buyer approved",
    rule: [4],
    async run(ctx) {
      const c = await control(ctx);
      if (!c.ok || !c.create) return noControl(c.why);
      const { capture } = learnRoutes(ctx.legit);
      if (!capture || !ctx.legit.paypalOrderId) return { verdict: "error", summary: "Could not learn the capture request from the real purchase.", evidence: {} };
      const before = await settle(ctx);
      const made = await send(ctx, c.create, c.create.body);
      const fresh = paypalIdFrom(made.body);
      if (!fresh) return { verdict: "error", summary: "The shop did not return a PayPal order id.", evidence: { made } };
      const replay = withOrderId(capture, ctx.legit.paypalOrderId, fresh);
      const r = await send(ctx, replay, replay.body);
      const after = await settle(ctx);
      const d = damage(before, after, targets(before, after, [fresh]));
      const robbed = d.paidNow.length > 0 || d.labels > 0;
      const pp = await getOrder(fresh);
      return {
        verdict: robbed ? "robbed" : "held",
        summary: robbed ? `The shop marked order ${fresh} paid although PayPal says ${pp.body?.status}.` : `PayPal refused the capture (order ${fresh} is ${pp.body?.status}); the shop kept it unpaid.`,
        evidence: { paypalOrderId: fresh, paypalStatus: pp.body?.status, captureRequest: replay.path, shopAnswer: r, orders: d.orders },
      };
    },
  },
  {
    id: "approved-not-captured",
    title: "Approval without payment",
    what: "Get it shipped before PayPal takes the money",
    rule: [4, 8],
    async run(ctx) {
      const before = await settle(ctx);
      const p = await purchase({ run: ctx.run, phase: "attack", shop: ctx.shop, tap: ctx.tap, items: ctx.items, label: `${prefix(ctx)}-attack-approved-only`, onBeforeCapture: async () => "abort", expectPaid: false });
      if (!p.paypalOrderId || !p.approved || !p.captureBlocked) {
        return { verdict: "error", summary: `The purchase never reached "approved, capture blocked" (${p.verdict}), so nothing was tested.`, evidence: { paypalOrderId: p.paypalOrderId, approved: p.approved, captureBlocked: p.captureBlocked, screenshots: p.screenshots } };
      }
      const status = (await getOrder(p.paypalOrderId)).body?.status;
      if (status !== "APPROVED") return { verdict: "error", summary: `PayPal says order ${p.paypalOrderId} is ${status}, not APPROVED, so approval alone was not what the shop saw.`, evidence: { paypalOrderId: p.paypalOrderId, paypalStatus: status } };
      approvedOrder.set(ctx, p.paypalOrderId);
      const after = await settle(ctx);
      const d = damage(before, after, targets(before, after, [p.paypalOrderId]));
      const robbed = d.paidNow.length > 0 || d.labels > 0;
      const approvedEvent = ctx.tap.genuine("CHECKOUT.ORDER.APPROVED").find((x) => x.resourceId === p.paypalOrderId) ?? null;
      const evidence = { paypalOrderId: p.paypalOrderId, paypalStatus: status, approvedWebhook: approvedEvent?.eventId ?? null, approvedWebhookAnswer: approvedEvent?.shopStatus ?? null, orders: d.orders, screenshots: p.screenshots };
      if (robbed) return { verdict: "robbed", summary: `Order ${p.paypalOrderId} was approved but never captured, and the shop still marked it paid or shipped it.`, evidence };
      const outcome: AttackOutcome = {
        id: "approved-not-captured",
        title: "Approval without payment",
        what: "Get it shipped before PayPal takes the money",
        rule: [4, 8],
        verdict: "held",
        summary: "",
        evidence,
      };
      // PayPal's "approved" webhook can take minutes in the sandbox: the verdict on that half waits until just before
      // double capture captures this order (see finish), so the event gets the whole attack sequence to arrive.
      const finish = async () => {
        const event = ctx.tap.genuine("CHECKOUT.ORDER.APPROVED").find((x) => x.resourceId === p.paypalOrderId) ?? (await ctx.tap.waitFor((x) => x.eventType === "CHECKOUT.ORDER.APPROVED" && x.resourceId === p.paypalOrderId, pace(15_000)));
        const now = await settle(ctx);
        const later = damage(before, now, targets(before, now, [p.paypalOrderId]));
        outcome.evidence = { ...outcome.evidence, approvedWebhook: event?.eventId ?? null, approvedWebhookAnswer: event?.shopStatus ?? null, orders: later.orders };
        if (later.paidNow.length || later.labels) {
          outcome.verdict = "robbed";
          outcome.summary = `Order ${p.paypalOrderId} was only approved, never captured, yet the shop ${later.labels ? "printed a shipping label" : "marked it paid"}${event ? " after PayPal's 'approved' webhook" : ""}.`;
        } else if (event) {
          outcome.summary = `Buyer approved order ${p.paypalOrderId}, the capture was blocked, and PayPal's 'approved' webhook arrived: nothing paid, nothing shipped.`;
        } else {
          outcome.summary = `Buyer approved order ${p.paypalOrderId} and the capture was blocked: nothing paid, nothing shipped. PayPal sent no 'approved' webhook during the run, so that path was not tested.`;
          outcome.untested = ["PayPal's 'approved' webhook (never delivered during the run)"];
        }
      };
      approvedOnly.set(ctx, { orderId: p.paypalOrderId, outcome, finish });
      return { verdict: "held", summary: "(finished just before double capture)", evidence };
    },
  },
  {
    id: "declined-capture",
    title: "Declined card",
    what: "Get it shipped after the card is declined",
    rule: [5],
    async run(ctx) {
      const before = await settle(ctx);
      const mark = ctx.proxy.calls.length;
      ctx.proxy.arm({ id: "declined", method: "POST", path: /^\/v2\/checkout\/orders\/[^/]+\/capture$/, mockResponse: { mock_application_codes: "INSTRUMENT_DECLINED" }, times: 1 });
      const p = await purchase({ run: ctx.run, phase: "attack", shop: ctx.shop, tap: ctx.tap, items: ctx.items, label: `${prefix(ctx)}-attack-declined`, expectPaid: false });
      ctx.proxy.disarm("declined");
      const after = await settle(ctx);
      const injected = ctx.proxy.since(mark).find((x) => x.injected);
      const d = damage(before, after, targets(before, after, [p.paypalOrderId]));
      const robbed = d.paidNow.length > 0 || d.labels > 0;
      const issue = (injected?.responseBody as any)?.details?.[0]?.issue ?? "";
      return {
        verdict: injected ? (robbed ? "robbed" : "held") : "error",
        summary: !injected
          ? `The shop never sent a capture call through the harness, so the decline could not be injected (${p.verdict}).`
          : robbed
            ? `PayPal answered ${injected.status} ${issue} but the shop marked the order paid or shipped it.`
            : `PayPal answered ${injected.status} ${issue} (debug id ${injected.debugId}); the shop kept the order unpaid.`,
        evidence: { paypalOrderId: p.paypalOrderId, injected: injected ? { status: injected.status, debugId: injected.debugId, issue } : null, shopAnswer: p.calls.at(-1)?.status ?? null, orders: d.orders, screenshots: p.screenshots },
      };
    },
  },
  {
    id: "forged-webhook",
    title: "Forged webhook",
    what: "Fake PayPal's 'payment completed' message",
    rule: [6],
    async run(ctx) {
      const c = await control(ctx);
      if (!c.ok || !c.create) return noControl(c.why);
      const genuine = await genuineCompleted(ctx, false);
      if (!genuine) return { verdict: "skipped", summary: "PayPal delivered no PAYMENT.CAPTURE.COMPLETED webhook in time to forge from.", evidence: {} };
      const before = await settle(ctx);
      const made = await send(ctx, c.create, c.create.body);
      const target = paypalIdFrom(made.body);
      const mid = await settle(ctx);
      const pending = targets(before, mid, [target]).find((o) => !o.paid) ?? null;
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
      const after = await settle(ctx);
      const d = damage(mid, after, targets(mid, after, [target, pending?.id]));
      const robbed = d.paidNow.length > 0 || d.labels > 0;
      return {
        verdict: robbed ? "robbed" : "held",
        summary: robbed ? `A forged event marked unpaid order ${pending?.id ?? target} paid.` : `Forged events were refused (HTTP ${unsigned.shopStatus} unsigned, ${resigned.shopStatus} with stolen headers); order ${pending?.id ?? target} stayed unpaid.`,
        evidence: { targetShopOrder: pending?.id ?? null, targetPayPalOrder: target, unsignedAnswer: unsigned.shopStatus, stolenHeadersAnswer: resigned.shopStatus, orders: d.orders },
      };
    },
  },
  {
    id: "webhook-replay",
    title: "Webhook replay",
    what: "Resend PayPal's real message to ship again",
    rule: [7, 8],
    async run(ctx) {
      const genuine = await genuineCompleted(ctx);
      if (!genuine) return { verdict: "skipped", summary: "PayPal delivered no PAYMENT.CAPTURE.COMPLETED webhook about this shop's orders in time to replay.", evidence: {} };
      const before = await settle(ctx);
      const target = shopOrderFor(genuine, before, ctx.legit);
      const answers = [];
      for (let i = 0; i < 3; i++) answers.push((await ctx.tap.forward("attacker", genuine.headers, genuine.rawBody)).shopStatus);
      const after = await settle(ctx);
      const d = damage(before, after, target ? after.filter((o) => o.id === target.id) : targets(before, after, eventIds(genuine)));
      const robbed = d.labels > 0;
      const order = target?.id ? ` for order ${target.id}` : "";
      return {
        verdict: robbed ? "robbed" : "held",
        summary: robbed ? `Replaying event ${genuine.eventId}${order} printed ${d.labels} extra shipping label(s).` : `Event ${genuine.eventId}${order} replayed 3 times byte for byte: no extra label.`,
        evidence: { eventId: genuine.eventId, targetShopOrder: target?.id ?? null, answers, orders: d.orders },
      };
    },
  },
  {
    id: "out-of-order",
    title: "Late event",
    what: "Send 'approved' after 'completed' to roll an order back",
    rule: [9],
    async run(ctx) {
      // A genuine "approved" event for an order of this shop that has since been paid: the real purchase's own, or
      // one from an earlier attack's order. PayPal's sandbox may still be on its way with them.
      const paidOrders = async () => (await settle(ctx)).filter((o) => o.paid);
      const forPaidOrder = (d: Delivery, paid: ShopOrder[]) => d.eventType === "CHECKOUT.ORDER.APPROVED" && !!d.resourceId && paid.some((o) => JSON.stringify(o).includes(d.resourceId!));
      let paid = await paidOrders();
      const have = ctx.tap.genuine("CHECKOUT.ORDER.APPROVED");
      let approved = have.find((d) => d.resourceId === ctx.legit.paypalOrderId) ?? have.find((d) => forPaidOrder(d, paid)) ?? null;
      if (!approved) {
        approved = await ctx.tap.waitFor((d) => d.eventType === "CHECKOUT.ORDER.APPROVED" && (d.resourceId === ctx.legit.paypalOrderId || forPaidOrder(d, paid)), pace(120_000));
        paid = await paidOrders();
      }
      if (!approved) return { verdict: "skipped", summary: "PayPal sent no CHECKOUT.ORDER.APPROVED event for any paid order of this shop.", evidence: {} };
      const before = await settle(ctx);
      const target = before.find((o) => JSON.stringify(o).includes(approved!.resourceId!)) ?? before.find((o) => o.id === ctx.legit.shopOrder?.id) ?? null;
      if (!target) return { verdict: "skipped", summary: `No shop order matches PayPal order ${approved.resourceId}.`, evidence: { eventId: approved.eventId } };
      const r = await ctx.tap.forward("attacker", approved.headers, approved.rawBody);
      const after = await settle(ctx);
      const targetAfter = after.find((o) => o.id === target.id);
      const d = damage(before, after, targetAfter ? [targetAfter] : []);
      const rolledBack = targetAfter?.status !== target.status;
      const robbed = rolledBack || d.labels > 0;
      return {
        verdict: robbed ? "robbed" : "held",
        summary: robbed
          ? rolledBack
            ? `The late event moved order ${target.id} from ${target.status} to ${targetAfter?.status}.`
            : `The late 'approved' event printed ${d.labels} more shipping label(s) for order ${target.id}.`
          : `Order ${target.id} stayed ${targetAfter?.status} after a late 'approved' event.`,
        evidence: { eventId: approved.eventId, targetShopOrder: target.id, targetPayPalOrder: approved.resourceId, shopAnswer: r.shopStatus, before: target.status, after: targetAfter?.status ?? null, orders: d.orders },
      };
    },
  },
  {
    id: "double-capture",
    title: "Double click",
    what: "Capture twice at once to get two shipments",
    rule: [8, 10],
    async run(ctx) {
      const { capture } = learnRoutes(ctx.legit);
      const orderId = approvedOrder.get(ctx);
      if (!capture || !ctx.legit.paypalOrderId || !orderId) return { verdict: "skipped", summary: "Needs the approved, uncaptured order that approval-alone leaves behind.", evidence: {} };
      const status = (await getOrder(orderId)).body?.status;
      if (status !== "APPROVED") return { verdict: "skipped", summary: `Order ${orderId} is ${status} at PayPal, not APPROVED, so there is nothing to capture twice.`, evidence: { paypalOrderId: orderId, paypalStatus: status } };
      const before = await settle(ctx);
      const replay = withOrderId(capture, ctx.legit.paypalOrderId, orderId);
      const answers = await Promise.all([send(ctx, replay, replay.body), send(ctx, replay, replay.body)]);
      const after = await settle(ctx, 15_000);
      const pp = await getOrder(orderId);
      const captures = pp.body?.purchase_units?.[0]?.payments?.captures ?? [];
      const d = damage(before, after, targets(before, after, [orderId, ...captures.map((c: any) => c.id)]));
      const robbed = d.labels > 1 || captures.length > 1;
      return {
        verdict: robbed ? "robbed" : "held",
        summary: robbed ? `Two simultaneous captures printed ${d.labels} labels for one payment.` : `Two simultaneous captures: PayPal captured ${captures.length}, the shop printed ${d.labels} label.`,
        evidence: { paypalOrderId: orderId, shopAnswers: answers.map((a) => a.status), paypalCaptures: captures.map((c: any) => ({ id: c.id, status: c.status, amount: c.amount })), orders: d.orders },
      };
    },
  },
  {
    id: "secret-leak",
    title: "Secret in the browser",
    what: "Look for the PayPal secret in every page and script",
    rule: [12],
    async run(ctx) {
      const secret = paypal.clientSecret();
      const basic = Buffer.from(`${paypal.clientId()}:${secret}`).toString("base64");
      const leaks = (text: string) => text.includes(secret) || text.includes(basic);
      const hits: string[] = [];
      const checked: string[] = [];
      const scripts = await shopScripts(ctx.shop);
      // Pages and JSON a stranger can open, and every GET endpoint the storefront's scripts mention.
      const endpoints = new Set(["/", "/admin", ctx.shop.profile.health, "/api/paypal/config"]);
      for (const s of scripts) for (const m of s.text.matchAll(/["'`](\/api\/[\w/-]+)["'`]/g)) endpoints.add(m[1]);
      for (const s of scripts) {
        checked.push(s.path);
        if (leaks(s.text)) hits.push(s.path);
      }
      for (const p of [...endpoints].slice(0, 40)) {
        const r = await fetch(`${ctx.shop.url}${p}`).catch(() => null);
        checked.push(p);
        if (r && leaks(await r.text())) hits.push(p);
      }
      // Everything the shop answered during the real purchase.
      for (const c of ctx.legit.calls) if (leaks(JSON.stringify(c.response ?? ""))) hits.push(`${c.method} ${c.path} (answer during the purchase)`);
      return {
        verdict: hits.length ? "robbed" : "held",
        summary: hits.length ? `The client secret is served at ${[...new Set(hits)].join(", ")}.` : `Checked ${new Set(checked).size} pages, scripts and endpoints, and every answer during the purchase: only the client id is public.`,
        evidence: { checked: [...new Set(checked)], leakedAt: [...new Set(hits)] },
      };
    },
  },
];

/** A picture of the shop owner's back office after an attack, with the orders it touched outlined. */
async function backOfficeShot(ctx: AttackContext, id: string, highlight: Array<string | null | undefined>): Promise<string | null> {
  const page = await (await browser()).newPage();
  try {
    await page.goto(backOfficeUrl(ctx.shop));
    await page.waitForTimeout(pace(2600));
    // The table may show a capture id or a shop order id rather than PayPal's order id: map through the back office API.
    const ids = highlight.filter((h): h is string => Boolean(h));
    const orders = await shopOrders(ctx.shop).catch(() => [] as ShopOrder[]);
    const marks = [...ids, ...orders.filter((o) => ids.some((x) => JSON.stringify(o).includes(x))).map((o) => o.id)];
    await page.evaluate((needles) => {
      for (const tr of Array.from(document.querySelectorAll("tr"))) {
        if (needles.some((n) => tr.textContent?.includes(n))) {
          (tr as HTMLElement).style.outline = "4px solid #ffb547";
          (tr as HTMLElement).style.background = "rgba(255,181,71,0.14)";
        }
      }
    }, marks);
    const file = `${prefix(ctx)}-attack-${id}-backoffice.png`;
    await page.screenshot({ path: ctx.run.file(file) });
    return file;
  } catch {
    return null;
  } finally {
    await page.close();
  }
}

async function record(ctx: AttackContext, a: Attack, outcome: AttackOutcome) {
  if (outcome.verdict !== "skipped" && a.id !== "secret-leak") {
    const ev = outcome.evidence as any;
    const touched = Array.isArray(ev?.orders) ? ev.orders.map((o: any) => o.id) : [];
    const shot = await backOfficeShot(ctx, a.id, [ev?.paypalOrderId, ev?.targetShopOrder, ev?.targetPayPalOrder, ev?.followThrough?.paypalOrderId, ev?.followThrough?.shopOrder, ...touched]);
    if (shot) outcome.evidence = { ...ev, screenshots: [...(ev?.screenshots ?? []), shot] };
  }
  ctx.run.emit("attack", "attack.result", { round: ctx.round, ...outcome });
}

export async function runAttacks(ctx: AttackContext, only?: string[]): Promise<AttackOutcome[]> {
  const out: AttackOutcome[] = [];
  await discoverCaptureRoute(ctx.shop, ctx.legit).catch(() => {});
  const finishApproved = async () => {
    const held = approvedOnly.get(ctx);
    if (!held || out.includes(held.outcome)) return;
    await held.finish().catch((err) => {
      held.outcome.verdict = "error";
      held.outcome.summary = String((err as Error).message ?? err).slice(0, 300);
    });
    await record(ctx, ATTACKS.find((x) => x.id === "approved-not-captured")!, held.outcome);
    out.push(held.outcome);
  };
  for (const id of ORDER) {
    const a = ATTACKS.find((x) => x.id === id)!;
    if (only && !only.includes(a.id)) continue;
    if (a.id === "double-capture") await finishApproved();
    ctx.run.emit("attack", "attack.start", { round: ctx.round, id: a.id, title: a.title, what: a.what });
    let outcome: AttackOutcome;
    try {
      outcome = { id: a.id, title: a.title, what: a.what, rule: a.rule, ...(await a.run(ctx)) };
    } catch (err) {
      outcome = { id: a.id, title: a.title, what: a.what, rule: a.rule, verdict: "error", summary: String((err as Error).message ?? err).slice(0, 300), evidence: {} };
    }
    // Approval-alone is judged later (see finish), unless it already failed or was robbed.
    const pending = approvedOnly.get(ctx);
    if (a.id === "approved-not-captured" && pending && outcome.verdict === "held") {
      ctx.run.emit("attack", "attack.waiting", { round: ctx.round, id: a.id, note: "Waiting for PayPal's 'approved' webhook before judging; the verdict comes just before double capture." });
      continue;
    }
    await record(ctx, a, outcome);
    out.push(outcome);
  }
  await finishApproved();
  return ORDER.map((id) => out.find((o) => o.id === id)).filter((o): o is AttackOutcome => Boolean(o));
}

export type { Delivery };
