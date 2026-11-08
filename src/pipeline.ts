import { openSandbox } from "./sandbox.ts";
import { purchase, closeBrowser, type PurchaseResult } from "./prove.ts";
import { runAttacks, shopOrderFor, ORDER, type AttackOutcome } from "./attacks.ts";
import { runCodingAgent } from "./agent.ts";
import { fixPrompt } from "./prompts.ts";
import { diff, runTests, commit, ensureInstalled } from "./workspace.ts";
import { loadProfile } from "./shop-profile.ts";
import { shopOrders } from "./shop-process.ts";
import { reconcile, type Books } from "./books.ts";
import { runThief, type ThiefReport, type ThiefPlan } from "./thief.ts";
import { pace } from "./config.ts";
import type { Run, Phase } from "./events.ts";

export type PayPalError = { call: string; status: number; name: string | null; issue: string | null; message: string | null; debugId: string | null };
/** How the shop answered PayPal's genuine, signed PAYMENT.CAPTURE.COMPLETED event for its own order ("verified" in older runs means accepted). */
export type WebhookStatus = "accepted" | "verified" | "refused" | "not-delivered";
export type Round = { round: number; offline?: boolean; tests: boolean; prove: PurchaseResult; attacks: AttackOutcome[]; webhookVerified?: boolean; webhook?: WebhookStatus; webhookEvent?: string | null; paypalErrors?: PayPalError[]; books?: Books; thief?: ThiefReport };

export type Verdict = "safe" | "unsafe" | "incomplete";

/** Every robbery a check must run, and see blocked, before it can say "safe". */
export const ALL_ATTACKS = ORDER;

/**
 * safe: the tests pass, the real purchase worked, all ten robberies ran and were blocked, and the shop's books match PayPal's.
 * unsafe: a robbery worked, the books do not match (an order paid or shipped without PayPal's capture behind it), the tests
 * fail, the shop refused PayPal's genuine webhook, or the purchase failed because of the shop.
 * incomplete: nothing got through, but not every robbery ran (one was skipped or errored, or only some were asked for),
 * or PayPal's sandbox stopped the purchase. Run it again; an incomplete check is never "safe".
 */
export function verdictOf(r: Round): Verdict {
  if (r.attacks.some((a) => a.verdict === "robbed") || r.thief?.plans.some((p) => p.verdict === "robbed") || !r.tests || (r.webhook === "refused" && !r.offline) || (r.books?.mismatches.length ?? 0) > 0) return "unsafe";
  // Offline, the stand-in's certificate address is local: a shop that checks PayPal's certificate itself refuses its
  // events. Only the sandbox can tell whether that shop accepts PayPal's real ones.
  if (r.webhook === "refused" && r.offline) return "incomplete";
  if (!r.prove.ok) return environmentProblem(r) ? "incomplete" : "unsafe";
  const held = new Set(r.attacks.filter((a) => a.verdict === "held").map((a) => a.id));
  if (ALL_ATTACKS.some((id) => !held.has(id))) return "incomplete";
  if (r.thief?.plans.some((p) => p.verdict === "error")) return "incomplete";
  // Safe also needs the books: matched to PayPal's records, every paid order backed. Books that could not be read or
  // matched leave the check incomplete.
  if (!r.books?.matched) return "incomplete";
  return "safe";
}

/**
 * What a verdict covered, in one line. Safe without the AI thief means safe against the ten scripted robberies only: a
 * mistake outside the ten is the thief's to find, and it needs a model key.
 */
export function verdictLine(r: Round): string {
  const v = verdictOf(r);
  if (v === "safe" && !r.thief?.ran) return `${VERDICT_LINE.safe} against the ten scripted robberies (the AI thief did not run: ${r.thief?.reason ?? "it was not asked to"}; mistakes outside the ten were not looked for)`;
  if (v === "incomplete" && !r.books?.matched && r.attacks.every((a) => a.verdict === "held")) return `${VERDICT_LINE.incomplete} (the shop's books could not be matched to PayPal's records)`;
  return VERDICT_LINE[v];
}

export function isSafe(r: Round): boolean {
  return verdictOf(r) === "safe";
}

export const VERDICT_LINE: Record<Verdict, string> = {
  safe: "SAFE TO SHIP",
  unsafe: "DO NOT SHIP",
  incomplete: "INCOMPLETE: nothing got through, but not every robbery could run; run the check again",
};

/** One full check of the shop as it is now: build, a real purchase, then every attack. */
/** The AI thief for a check: off, or on (inventing plans with the configured model, or replaying recorded plans). */
export type ThiefOption = { plansFile?: string; carry?: ThiefPlan[] } | false;

export async function checkShop(run: Run, shopDir: string, round: number, opts: { attacks?: string[]; skipAttacks?: boolean; method?: "paypal" | "venmo" | "paylater"; thief?: ThiefOption } = {}): Promise<Round> {
  const phase: Phase = round === 0 ? "prove" : "fix";
  ensureInstalled(shopDir);
  const tests = runTests(shopDir);
  run.emit("build", "build.tests", { round, ok: tests.ok, output: tests.output.slice(-3000) });
  const { sku, qty } = loadProfile(shopDir).product;
  const items = [{ sku, qty }];
  const sandbox = await openSandbox(run, phase, shopDir, round);
  try {
    const legit = await purchase({ run, phase: "prove", shop: sandbox.shop, tap: sandbox.tap, items, label: `round${round}-purchase${opts.method && opts.method !== "paypal" ? `-${opts.method}` : ""}`, method: opts.method });
    // What PayPal itself refused during the shopper's purchase (the shop's own calls, seen by the proxy).
    const paypalErrors: PayPalError[] = sandbox.proxy.calls
      .filter((c) => c.status >= 400 && !c.injected)
      .map((c) => {
        const b = (c.responseBody ?? {}) as { name?: string; message?: string; details?: Array<{ issue?: string; description?: string }> };
        return { call: `${c.method} ${c.path}`, status: c.status, name: b.name ?? null, issue: b.details?.[0]?.issue ?? null, message: b.details?.[0]?.description ?? b.message ?? null, debugId: c.debugId };
      });
    if (paypalErrors.length) run.emit("prove", "prove.paypal_errors", { round, errors: paypalErrors });
    if (legit.ok && legit.captureId) {
      // Give PayPal a minute to deliver the purchase's PAYMENT.CAPTURE.COMPLETED; the sandbox is sometimes slower.
      await sandbox.tap.waitOrAsk((d) => d.eventType === "PAYMENT.CAPTURE.COMPLETED" && d.resourceId === legit.captureId, "PAYMENT.CAPTURE.COMPLETED", [legit.captureId, legit.paypalOrderId], pace(60_000));
    }
    let attacks: AttackOutcome[] = [];
    if (!opts.skipAttacks && (legit.ok || legit.paypalOrderId)) {
      // Once a buyer could approve a payment, every robbery can be tried, even if the shop then misbehaved (shipped
      // twice, or shipped without capturing); a robbery that lacks what it needs says so and does not count as blocked.
      // Without that, only the robberies that need no buyer can run.
      const buyerFree = ["price-tamper", "bad-bag", "capture-unapproved", "secret-leak"];
      const buyerWorks = legit.ok || legit.approved || legit.captureStatus === "COMPLETED";
      const only = buyerWorks ? opts.attacks : (opts.attacks ?? buyerFree).filter((id) => buyerFree.includes(id));
      attacks = await runAttacks({ run, round, shop: sandbox.shop, proxy: sandbox.proxy, tap: sandbox.tap, legit, items }, only);
    }
    // Then the AI thief invents robberies of its own (only on a complete check, once a buyer could approve).
    let thief: ThiefReport | undefined;
    const shopCouldBePaid = legit.ok || legit.captureStatus === "COMPLETED";
    if (opts.thief !== false && opts.thief !== undefined && !opts.skipAttacks && !opts.attacks && !shopCouldBePaid) {
      thief = { ran: false, reason: legit.approved ? "the shop's capture did not work, so nothing could be paid for the thief to steal" : "the real purchase never reached a buyer's approval, so there was no checkout to rob", plans: [] };
      run.emit("attack", "thief.skipped", { round, reason: thief.reason });
    } else if (opts.thief !== false && opts.thief !== undefined && !opts.skipAttacks && !opts.attacks && shopCouldBePaid) {
      thief = await runThief({ run, round, shop: sandbox.shop, proxy: sandbox.proxy, tap: sandbox.tap, legit, items, scripted: attacks }, opts.thief).catch((err) => ({ ran: false, reason: `the AI thief failed: ${String((err as Error).message ?? err).slice(0, 200)}`, plans: [] }));
    }
    // After every robbery, the shop's books against PayPal's own records.
    // A failure to read the books is recorded, not swallowed: without them the check cannot be called safe.
    const books: Books | undefined = legit.paypalOrderId
      ? await reconcile(sandbox.shop, sandbox.proxy.calls, legit).catch((err) => ({ matched: false, orders: 0, paid: 0, mismatches: [], error: String((err as Error).message ?? err).slice(0, 200) }))
      : undefined;
    if (books) run.emit("attack", "books.reconciled", { round, ...books });
    // The webhook verdict for the round: how the shop answered PayPal's genuine PAYMENT.CAPTURE.COMPLETED for one of its
    // own orders. Events about other shops' orders (one sandbox app can serve several projects) do not count.
    const orders = await shopOrders(sandbox.shop).catch(() => []);
    const ours = sandbox.tap.genuine("PAYMENT.CAPTURE.COMPLETED").filter((d) => d.resourceId === legit.captureId || shopOrderFor(d, orders, legit));
    const best = ours.find((d) => d.resourceId === legit.captureId) ?? ours[0];
    const webhook: WebhookStatus = !best ? "not-delivered" : best.shopStatus >= 200 && best.shopStatus < 300 ? "accepted" : "refused";
    if (sandbox.tap.resends.length) run.emit("prove", "webhook.resends", { round, resends: sandbox.tap.resends });
    run.emit("prove", "prove.webhook", { round, status: webhook, eventId: best?.eventId ?? null, resourceId: best?.resourceId ?? null, shopStatus: best?.shopStatus ?? null, paypalVerified: best?.paypalVerified ?? null, ok: webhook === "accepted" });
    const result: Round = { round, offline: Boolean(sandbox.standIn), tests: tests.ok, prove: legit, attacks, webhook, webhookEvent: best?.eventId ?? null, paypalErrors, books, thief };
    run.writeJson(`round${round}.json`, result);
    return result;
  } finally {
    await sandbox.close();
    await closeBrowser();
  }
}

const LEGACY_ENVIRONMENT = /sandbox checkout page kept failing|sandbox buyer|SANDBOX_BUYER|seller account|CAPTCHA/;

/** Problems with PayPal's sandbox or the test accounts, not with the shop's code: never sent to the coding agent. */
export function environmentProblem(r: Round): string | null {
  if (r.prove.ok) return null;
  if (r.prove.environment) return r.prove.verdict;
  // Runs recorded before the purchase step named the reason.
  if (r.prove.environment === undefined && LEGACY_ENVIRONMENT.test(r.prove.verdict)) return r.prove.verdict;
  return null;
}

export function failures(r: Round): Array<{ title: string; detail: string }> {
  const out: Array<{ title: string; detail: string }> = [];
  if (!r.tests) out.push({ title: "npm test fails", detail: "Run npm test and fix the failures." });
  if (!r.prove.ok) {
    const errors = (r.paypalErrors ?? []).filter((e) => !e.call.includes("/v1/oauth2/token"));
    const told = errors.map((e) => `PayPal answered ${e.call} with HTTP ${e.status} ${e.name ?? ""}${e.issue ? ` (${e.issue})` : ""}${e.message ? `: ${e.message}` : ""} [debug id ${e.debugId}]`).join("; ");
    out.push({ title: "The real purchase did not complete correctly", detail: `${r.prove.verdict}${told ? ` ${told}.` : ""}` });
  }
  if (r.webhook === "refused" && !r.offline) out.push({ title: "The shop refused PayPal's genuine PAYMENT.CAPTURE.COMPLETED webhook", detail: `A genuine, signed delivery (event ${r.webhookEvent}) to the shop's webhook route did not get a 2xx answer.` });
  for (const a of r.attacks) if (a.verdict === "error") out.push({ title: `Robbery "${a.title}" could not run`, detail: a.summary });
  for (const a of r.attacks) if (a.verdict === "robbed") out.push({ title: `Robbery "${a.title}" worked (${a.what}; rules ${a.rule.join(", ")})`, detail: a.summary });
  for (const p of r.thief?.plans ?? []) if (p.verdict === "robbed") out.push({ title: `The AI thief got through: ${p.name}`, detail: `${p.idea} What it did: ${p.steps.map((s) => `${JSON.stringify(s.step)} -> ${s.result}`).join("; ")}. ${p.summary}` });
  if (r.books?.mismatches.length) out.push({ title: "The shop's books do not match PayPal's", detail: r.books.mismatches.map((m) => `order ${m.order}: ${m.problem}`).join("; ") });
  return out;
}

/** Check, and while anything fails, hand the evidence back to the coding agent and check again. */
export async function proveAndHarden(run: Run, shopDir: string, maxFixes = 2, thief: ThiefOption = {}): Promise<Round[]> {
  const rounds: Round[] = [];
  const carry: ThiefPlan[] = [];
  for (let round = 0; round <= maxFixes; round++) {
    const r = await checkShop(run, shopDir, round, { thief: thief === false ? false : { ...thief, carry: [...carry] } });
    for (const p of r.thief?.plans ?? []) if (p.verdict === "robbed" && !carry.some((c) => c.name === p.name)) carry.push({ name: p.name, idea: p.idea, expect: p.expect, steps: p.steps.map((s) => s.step) });
    rounds.push(r);
    const f = failures(r);
    const env = environmentProblem(r);
    run.emit(round === 0 ? "attack" : "fix", "round.done", { round, failures: f.length, robbed: r.attacks.filter((a) => a.verdict === "robbed").length, environment: env, verdict: verdictOf(r) });
    if (env) break; // a sandbox or account problem: fixing the shop would not help
    if (f.length === 0 || round === maxFixes) break;
    commit(shopDir, round === 0 ? "Add PayPal, Venmo and Pay Later checkout" : `Harden checkout (round ${round + 1})`);
    await runCodingAgent({ run, phase: "fix", cwd: shopDir, prompt: fixPrompt(f), label: `fix-${round + 1}`, maxTurns: 80 });
    run.writeText(`fix-${round + 1}.patch`, diff(shopDir).patch);
  }
  return rounds;
}
