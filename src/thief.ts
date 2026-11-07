import fs from "node:fs";
import { askModel, firstJson } from "./llm.ts";
import { browser, purchase, type PurchaseResult } from "./prove.ts";
import { settledOrders, type ShopProcess } from "./shop-process.ts";
import { reconcile, type Books } from "./books.ts";
import { shopOrderFor, shopScripts, type AttackOutcome } from "./attacks.ts";
import { pace } from "./config.ts";
import { redact } from "./secrets.ts";
import type { PayPalProxy } from "./paypal/proxy.ts";
import type { WebhookTap } from "./webhooks/tap.ts";
import type { Run } from "./events.ts";

/**
 * The AI thief: after the ten scripted robberies, a model plays a dishonest shopper or a rogue shopping agent. It sees only
 * what any visitor can see (the storefront's scripts, the requests the shop's own page sent during the real purchase, and
 * the shape of the PayPal events the shop receives), invents robberies of its own, and Heistproof carries them out against
 * the shop, step by step, through a small fixed set of moves that can only reach this shop. The model never decides who
 * won: the books do (src/books.ts), compared before and after each plan with PayPal's own records.
 */

export type ThiefStep =
  | { do: "request"; method: string; path: string; body?: unknown; headers?: Record<string, string>; times?: number; together?: boolean; save?: string }
  | { do: "buy"; tamper?: Record<string, unknown>; blockCapture?: boolean; save?: string }
  | { do: "webhook"; event: "PAYMENT.CAPTURE.COMPLETED" | "CHECKOUT.ORDER.APPROVED"; edit?: Record<string, unknown>; signed?: boolean; times?: number }
  | { do: "wait"; ms: number };
export type ThiefPlan = { name: string; idea: string; expect: string; steps: ThiefStep[] };
export type ThiefOutcome = { name: string; idea: string; expect: string; verdict: "held" | "robbed" | "error"; summary: string; steps: Array<{ step: ThiefStep; result: string }>; mismatches: Books["mismatches"] };
export type ThiefReport = { ran: boolean; reason?: string; model?: string; provider?: string; source?: "model" | "replay"; dropped?: string[]; plans: ThiefOutcome[] };

export type ThiefContext = { run: Run; round: number; shop: ShopProcess; proxy: PayPalProxy; tap: WebhookTap; legit: PurchaseResult; items: Array<{ sku: string; qty: number }>; scripted: AttackOutcome[] };

export const MAX_PLANS = 6;
const MAX_STEPS = 8;
const SAVE = /^[a-z][\w-]{0,30}$/i;
const HEADER = /^(content-type|x-[\w-]{1,40})$/i;

/** Keeps only plans Heistproof can carry out safely: known moves, paths on this shop only, small bodies. */
export function validatePlans(raw: unknown): { plans: ThiefPlan[]; dropped: string[] } {
  const dropped: string[] = [];
  const plans: ThiefPlan[] = [];
  const list = Array.isArray((raw as any)?.plans) ? ((raw as any).plans as any[]) : [];
  for (const [i, p] of list.slice(0, MAX_PLANS).entries()) {
    const label = typeof p?.name === "string" ? p.name.slice(0, 80) : `plan ${i + 1}`;
    if (!p || typeof p.name !== "string" || !Array.isArray(p.steps) || p.steps.length === 0) {
      dropped.push(`${label}: not a plan`);
      continue;
    }
    const steps: ThiefStep[] = [];
    for (const s of p.steps.slice(0, MAX_STEPS)) {
      const why = checkStep(s);
      if (why) dropped.push(`${label}: step dropped (${why})`);
      else steps.push(s as ThiefStep);
    }
    if (!steps.length) {
      dropped.push(`${label}: no usable step`);
      continue;
    }
    plans.push({ name: p.name.slice(0, 80), idea: String(p.idea ?? "").slice(0, 300), expect: String(p.expect ?? "").slice(0, 300), steps });
  }
  if (list.length > MAX_PLANS) dropped.push(`${list.length - MAX_PLANS} plan(s) over the limit of ${MAX_PLANS}`);
  return { plans, dropped };
}

function checkStep(s: any): string | null {
  const small = (v: unknown, n: number) => JSON.stringify(v ?? null).length <= n;
  if (!s || typeof s !== "object") return "not an object";
  if (s.save !== undefined && (typeof s.save !== "string" || !SAVE.test(s.save) || s.save === "legit")) return "bad save name";
  switch (s.do) {
    case "request":
      if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(String(s.method).toUpperCase())) return "unknown method";
      if (typeof s.path !== "string" || !s.path.startsWith("/") || s.path.startsWith("//") || /[\s\\]|:\/\//.test(s.path) || s.path.length > 300) return "path must be on this shop";
      if (s.headers !== undefined && (typeof s.headers !== "object" || Object.entries(s.headers).some(([k, v]) => !HEADER.test(k) || typeof v !== "string"))) return "only content-type and x- headers";
      if (!small(s.body, 20_000)) return "body too large";
      if (s.times !== undefined && !(Number.isInteger(s.times) && s.times >= 1 && s.times <= 3)) return "times must be 1 to 3";
      return null;
    case "buy":
      if (s.tamper !== undefined && (typeof s.tamper !== "object" || Array.isArray(s.tamper) || !small(s.tamper, 5000))) return "tamper must be a small object";
      return null;
    case "webhook":
      if (!["PAYMENT.CAPTURE.COMPLETED", "CHECKOUT.ORDER.APPROVED"].includes(s.event)) return "unknown event";
      if (s.edit !== undefined && (typeof s.edit !== "object" || Array.isArray(s.edit) || Object.keys(s.edit).length > 20 || !small(s.edit, 5000))) return "edit must be a small object";
      if (s.times !== undefined && !(Number.isInteger(s.times) && s.times >= 1 && s.times <= 3)) return "times must be 1 to 3";
      return null;
    case "wait":
      return Number.isFinite(s.ms) && s.ms >= 0 && s.ms <= 5000 ? null : "wait 0 to 5000 ms";
    default:
      return "unknown move";
  }
}

/** Replaces {{name.path}} with saved values; a value that is only a placeholder keeps its type. */
export function fill(value: unknown, saved: Record<string, unknown>): unknown {
  const lookup = (expr: string) => expr.split(".").reduce<any>((v, k) => (v == null ? undefined : v[k]), saved);
  if (typeof value === "string") {
    const whole = /^\{\{\s*([\w.-]+)\s*\}\}$/.exec(value);
    if (whole) return lookup(whole[1]) ?? value;
    return value.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (m, expr) => {
      const v = lookup(expr);
      return v == null ? m : String(v);
    });
  }
  if (Array.isArray(value)) return value.map((v) => fill(v, saved));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, saved)]));
  return value;
}

function setPath(target: any, dotted: string, v: unknown) {
  const keys = dotted.split(".");
  let o = target;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  o[keys.at(-1)!] = v;
}

const deepMerge = (a: any, b: any): any => (b && typeof b === "object" && !Array.isArray(b) && a && typeof a === "object" && !Array.isArray(a) ? { ...a, ...Object.fromEntries(Object.entries(b).map(([k, v]) => [k, deepMerge(a[k], v)])) } : b);
const cut = (v: unknown, n: number) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s && s.length > n ? `${s.slice(0, n)}...` : (s ?? "");
};

/** What any visitor (and so any thief) can see of this shop, as text for the model. Never the shop's server code or secrets. */
async function whatAVisitorSees(ctx: ThiefContext): Promise<string> {
  const scripts = await shopScripts(ctx.shop, 8).catch(() => []);
  const deliveries = ctx.tap.genuine().slice(0, 6).map((d) => ({ event: d.eventType, sample: cut(JSON.parse(d.rawBody).resource, 900), shopAnswered: d.shopStatus }));
  const parts = [
    `The storefront's scripts (${scripts.length}):`,
    ...scripts.map((s) => `--- ${s.path}\n${cut(s.text, 6000)}`),
    "",
    "Requests the shop's own page sent during one real purchase (method, path, body, status, answer):",
    ...ctx.legit.calls.map((c) => `- ${c.method} ${c.path} body=${cut(c.body, 800)} -> ${c.status} ${cut(c.response, 800)}`),
    "",
    `The real purchase: bag total $${ctx.legit.bagTotal}, PayPal order ${ctx.legit.paypalOrderId}, capture ${ctx.legit.captureId ?? "none"}, shop order ${ctx.legit.shopOrder?.id ?? "unknown"}.`,
    "",
    "PayPal events the shop received (you may resend one, edited or not; you cannot sign a new one):",
    ...deliveries.map((d) => `- ${d.event}: resource ${d.sample} (shop answered ${d.shopAnswered})`),
    "",
    "The ten known robberies already tried, and how each ended:",
    ...ctx.scripted.map((a) => `- ${a.title} (${a.what}): ${a.verdict}`),
  ];
  return redact(parts.join("\n"));
}

const SYSTEM = `You are the AI thief in Heistproof, a security test the shop's owner runs on their own computer against PayPal's sandbox (test money only, nothing real is taken). You play a dishonest shopper or a rogue AI shopping agent.
Goal: get goods without paying their full price, get more parcels than you paid for, or make the shop treat an order as paid when PayPal never captured the money.
You only know what any visitor can see. Ten well-known robberies were already tried; invent different ones: other fields, other routes the scripts mention, other orders of steps, combinations.
Answer with one JSON object and nothing else.`;

function instructions(n: number): string {
  return `Write exactly ${n} robbery plans as {"plans":[...]}. Each plan: {"name": short title, "idea": the mistake you hope the shop made, "expect": what you would get if it works, "steps": [...]} with at most ${MAX_STEPS} steps from these moves:
- {"do":"request","method":"POST","path":"/a/route/the/scripts/use","body":{...},"headers":{"x-...":"..."},"times":1,"together":false,"save":"a"}: a request to this shop as the shopper (same cookies; the page's own headers are added for you). times up to 3; together:true sends them at the same moment.
- {"do":"buy","tamper":{...},"blockCapture":false,"save":"b"}: a real purchase in the shopper's browser; the buyer approves on PayPal's page. tamper is merged into the create-order request body the page sends. blockCapture:true stops the page's capture request after approval.
- {"do":"webhook","event":"PAYMENT.CAPTURE.COMPLETED","edit":{"resource.custom_id":"..."},"signed":true,"times":1}: resend a real PayPal event the shop received (PAYMENT.CAPTURE.COMPLETED or CHECKOUT.ORDER.APPROVED), with edits at dotted paths. signed:true keeps PayPal's original signature headers (an edited body no longer matches them); signed:false sends none.
- {"do":"wait","ms":1000}
Values may use placeholders: {{legit.paypalOrderId}}, {{legit.captureId}}, {{legit.shopOrderId}}, {{legit.bagTotal}}, {{a.status}} and {{a.body.<field>}} for a saved request's answer, {{b.paypalOrderId}}, {{b.captureId}}, {{b.shopOrderId}} for a saved purchase.
Paths must be routes of this shop (starting with /). Do not repeat the ten known robberies as they were run.`;
}

/** Runs one plan, step by step, and judges it by the books: a new mismatch with PayPal's records means it got through. */
async function carryOut(ctx: ThiefContext, plan: ThiefPlan, k: number, books: Books): Promise<{ outcome: ThiefOutcome; books: Books }> {
  const saved: Record<string, any> = { legit: { paypalOrderId: ctx.legit.paypalOrderId, captureId: ctx.legit.captureId, shopOrderId: ctx.legit.shopOrder?.id ?? null, bagTotal: ctx.legit.bagTotal } };
  const create = ctx.legit.calls.find((c) => ctx.legit.paypalOrderId && JSON.stringify(c.response ?? "").includes(ctx.legit.paypalOrderId));
  const pageHeaders = create?.headers ?? {};
  const log: ThiefOutcome["steps"] = [];
  for (const raw of plan.steps) {
    const step = fill(raw, saved) as ThiefStep;
    try {
      if (step.do === "request") {
        const send = async () => {
          const r = await (await browser()).request.fetch(`${ctx.shop.url}${step.path}`, {
            method: step.method.toUpperCase(),
            headers: { "content-type": "application/json", ...pageHeaders, ...(step.headers ?? {}) },
            data: step.body === undefined || step.method.toUpperCase() === "GET" ? undefined : typeof step.body === "string" ? step.body : JSON.stringify(step.body),
            failOnStatusCode: false,
          });
          const text = await r.text();
          let body: any = text.slice(0, 2000);
          try {
            body = JSON.parse(text);
          } catch {
            /* not JSON */
          }
          return { status: r.status(), body };
        };
        const n = step.times ?? 1;
        const answers = step.together ? await Promise.all(Array.from({ length: n }, send)) : await (async () => {
          const out = [];
          for (let i = 0; i < n; i++) out.push(await send());
          return out;
        })();
        if (step.save) saved[step.save] = answers.at(-1);
        log.push({ step: raw, result: answers.map((a) => `HTTP ${a.status} ${cut(a.body, 160)}`).join(" | ") });
      } else if (step.do === "buy") {
        const p = await purchase({
          run: ctx.run,
          phase: "attack",
          shop: ctx.shop,
          tap: ctx.tap,
          items: ctx.items,
          label: `round${ctx.round}-thief-${k}-buy`,
          tamperCreate: step.tamper ? (body) => deepMerge(body, step.tamper) : undefined,
          onBeforeCapture: step.blockCapture ? async () => "abort" : undefined,
          skipAmountCheck: true,
          expectPaid: false,
        });
        if (step.save) saved[step.save] = { paypalOrderId: p.paypalOrderId, captureId: p.captureId, shopOrderId: p.shopOrder?.id ?? null, approved: p.approved, captured: p.captureStatus };
        log.push({ step: raw, result: `PayPal order ${p.paypalOrderId ?? "none"}, ${p.approved ? "approved" : "not approved"}, capture ${p.captureStatus ?? "none"}, shop order ${p.shopOrder?.id ?? "?"} ${p.shopOrder?.status ?? ""}` });
      } else if (step.do === "webhook") {
        const orders = await settledOrders(ctx.shop, pace(500), pace(4000));
        const genuine = ctx.tap.genuine(step.event);
        const source = genuine.find((d) => shopOrderFor(d, orders, ctx.legit)) ?? genuine.at(-1);
        if (!source) {
          log.push({ step: raw, result: `PayPal sent no ${step.event} to resend` });
          continue;
        }
        let body = source.rawBody;
        if (step.edit && Object.keys(step.edit).length) {
          const event = JSON.parse(source.rawBody);
          for (const [p, v] of Object.entries(step.edit)) setPath(event, p, v);
          body = JSON.stringify(event);
        }
        const headers = step.signed === false ? { "content-type": "application/json" } : source.headers;
        const answers = [];
        for (let i = 0; i < (step.times ?? 1); i++) answers.push((await ctx.tap.forward("attacker", headers, body)).shopStatus);
        log.push({ step: raw, result: `resent ${step.event} ${source.eventId} (${step.edit ? "edited" : "unchanged"}, ${step.signed === false ? "unsigned" : "with PayPal's headers"}): shop answered ${answers.join(", ")}` });
      } else if (step.do === "wait") {
        await new Promise((r) => setTimeout(r, step.ms));
        log.push({ step: raw, result: `waited ${step.ms} ms` });
      }
    } catch (err) {
      log.push({ step: raw, result: `failed: ${String((err as Error).message ?? err).slice(0, 200)}` });
    }
  }
  await settledOrders(ctx.shop, pace(1500), pace(12_000));
  const after = await reconcile(ctx.shop, ctx.proxy.calls, ctx.legit);
  const known = new Set(books.mismatches.map((m) => `${m.order}|${m.problem}`));
  const fresh = after.mismatches.filter((m) => !known.has(`${m.order}|${m.problem}`));
  const outcome: ThiefOutcome = {
    name: plan.name,
    idea: plan.idea,
    expect: plan.expect,
    verdict: fresh.length ? "robbed" : "held",
    summary: fresh.length ? `Got through: ${fresh.map((m) => `order ${m.order} ${m.problem}`).join("; ")}.` : "The books still match PayPal's records: nothing taken.",
    steps: log,
    mismatches: fresh,
  };
  return { outcome, books: after };
}

/** The AI thief's round: invent plans (or replay recorded ones), carry each out, and let the books judge. */
export async function runThief(ctx: ThiefContext, opts: { plansFile?: string; count?: number; carry?: ThiefPlan[] } = {}): Promise<ThiefReport> {
  let raw: unknown;
  let model: string | undefined;
  let provider: string | undefined;
  let source: ThiefReport["source"] = "model";
  if (opts.plansFile) {
    raw = JSON.parse(fs.readFileSync(opts.plansFile, "utf8"));
    source = "replay";
  } else {
    try {
      const seen = await whatAVisitorSees(ctx);
      let answer = await askModel(SYSTEM, `${seen}\n\n${instructions(opts.count ?? MAX_PLANS)}`, 32_000);
      // A model that spends its whole budget thinking answers nothing: ask once more, for fewer and shorter plans.
      if (!firstJson(answer.text)) answer = await askModel(SYSTEM, `${seen}\n\n${instructions(4)}\nThink briefly. Reply with the JSON now; keep each plan to its essential steps.`, 32_000);
      // Kept with the run: exactly what the model answered (the plans it invented are judged, not trusted).
      ctx.run.writeText(`round${ctx.round}-thief-answer.txt`, `stop: ${answer.stop}\n\n${answer.text}`);
      raw = firstJson(answer.text);
      model = answer.model;
      provider = answer.provider;
    } catch (err) {
      const report: ThiefReport = { ran: false, reason: `the model could not be asked: ${String((err as Error).message ?? err).slice(0, 200)}`, plans: [] };
      ctx.run.emit("attack", "thief.skipped", { round: ctx.round, reason: report.reason });
      return report;
    }
  }
  const checked = validatePlans(raw);
  const dropped = checked.dropped;
  // Plans that got through in an earlier round run again first, so a fix is seen to hold.
  const carried = (opts.carry ?? []).filter((c) => !checked.plans.some((p) => p.name === c.name));
  const plans = [...carried, ...checked.plans];
  ctx.run.writeJson(`round${ctx.round}-thief-plans.json`, { plans });
  ctx.run.emit("attack", "thief.start", { round: ctx.round, source, model, provider, planned: plans.length, plans: plans.map((p) => ({ name: p.name, idea: p.idea })), dropped });
  if (!plans.length) {
    const report: ThiefReport = { ran: false, reason: "the model gave no plan Heistproof could carry out", model, provider, source, dropped, plans: [] };
    ctx.run.emit("attack", "thief.skipped", { round: ctx.round, reason: report.reason, dropped });
    return report;
  }
  let books = await reconcile(ctx.shop, ctx.proxy.calls, ctx.legit);
  const outcomes: ThiefOutcome[] = [];
  for (const [k, plan] of plans.entries()) {
    ctx.run.emit("attack", "thief.plan", { round: ctx.round, index: k, name: plan.name, idea: plan.idea, expect: plan.expect, steps: plan.steps });
    let outcome: ThiefOutcome;
    try {
      const done = await carryOut(ctx, plan, k, books);
      outcome = done.outcome;
      books = done.books;
    } catch (err) {
      outcome = { name: plan.name, idea: plan.idea, expect: plan.expect, verdict: "error", summary: String((err as Error).message ?? err).slice(0, 300), steps: [], mismatches: [] };
    }
    ctx.run.emit("attack", "thief.result", { round: ctx.round, index: k, ...outcome });
    outcomes.push(outcome);
  }
  return { ran: true, model, provider, source, dropped, plans: outcomes };
}
