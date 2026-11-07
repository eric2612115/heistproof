import { openSandbox } from "./sandbox.ts";
import { purchase, closeBrowser, type PurchaseResult } from "./prove.ts";
import { runAttacks, type AttackOutcome } from "./attacks.ts";
import { runCodingAgent } from "./agent.ts";
import { fixPrompt } from "./prompts.ts";
import { diff, runTests, commit, ensureInstalled } from "./workspace.ts";
import type { Run, Phase } from "./events.ts";

export const HOODIE = [{ sku: "FOG-HOODIE", qty: 1 }];

export type PayPalError = { call: string; status: number; name: string | null; issue: string | null; message: string | null; debugId: string | null };
export type WebhookStatus = "verified" | "refused" | "not-delivered";
export type Round = { round: number; tests: boolean; prove: PurchaseResult; attacks: AttackOutcome[]; webhookVerified: boolean; webhook?: WebhookStatus; webhookEvent?: string | null; paypalErrors?: PayPalError[] };

export type Verdict = "safe" | "unsafe" | "incomplete";

/**
 * safe: the tests pass, the real purchase worked, the shop accepted PayPal's genuine webhook, and every robbery that ran was blocked.
 * unsafe: a robbery worked, the tests fail, the shop refused a genuine webhook, or the purchase failed because of the shop.
 * incomplete: nothing got through, but some robberies were skipped or errored (for example, the sandbox never delivered a
 * webhook they need), or a sandbox problem stopped the purchase. Run it again; an incomplete check is never "safe".
 */
export function verdictOf(r: Round): Verdict {
  if (r.attacks.some((a) => a.verdict === "robbed") || !r.tests || r.webhook === "refused") return "unsafe";
  if (!r.prove.ok) return environmentProblem(r) ? "incomplete" : "unsafe";
  if (r.attacks.length === 0 || r.attacks.some((a) => a.verdict !== "held")) return "incomplete";
  return "safe";
}

export function isSafe(r: Round): boolean {
  return verdictOf(r) === "safe";
}

export const VERDICT_LINE: Record<Verdict, string> = {
  safe: "SAFE TO SHIP",
  unsafe: "DO NOT SHIP",
  incomplete: "INCOMPLETE: nothing got through, but not every robbery could run; run the check again",
};

/** One full check of the shop as it is now: build, a real sandbox purchase, then every attack. */
export async function checkShop(run: Run, shopDir: string, round: number, opts: { attacks?: string[]; skipAttacks?: boolean; method?: "paypal" | "venmo" | "paylater" } = {}): Promise<Round> {
  const phase: Phase = round === 0 ? "prove" : "fix";
  ensureInstalled(shopDir);
  const tests = runTests(shopDir);
  run.emit("build", "build.tests", { round, ok: tests.ok, output: tests.output.slice(-3000) });
  const sandbox = await openSandbox(run, phase, shopDir, `shop-round${round}.db`);
  try {
    const legit = await purchase({ run, phase: "prove", shop: sandbox.shop, tap: sandbox.tap, items: HOODIE, label: `round${round}-purchase${opts.method && opts.method !== "paypal" ? `-${opts.method}` : ""}`, method: opts.method });
    // What PayPal itself refused during the shopper's purchase (the shop's own calls, seen by the proxy).
    const paypalErrors: PayPalError[] = sandbox.proxy.calls
      .filter((c) => c.status >= 400 && !c.injected)
      .map((c) => {
        const b = (c.responseBody ?? {}) as { name?: string; message?: string; details?: Array<{ issue?: string; description?: string }> };
        return { call: `${c.method} ${c.path}`, status: c.status, name: b.name ?? null, issue: b.details?.[0]?.issue ?? null, message: b.details?.[0]?.description ?? b.message ?? null, debugId: c.debugId };
      });
    if (paypalErrors.length) run.emit("prove", "prove.paypal_errors", { round, errors: paypalErrors });
    if (legit.ok && legit.captureId) {
      // Give PayPal's sandbox a minute to deliver the purchase's PAYMENT.CAPTURE.COMPLETED; it is sometimes slower.
      await sandbox.tap.waitFor((d) => d.eventType === "PAYMENT.CAPTURE.COMPLETED" && d.resourceId === legit.captureId, 60_000);
    }
    let attacks: AttackOutcome[] = [];
    if (!opts.skipAttacks && (legit.ok || legit.paypalOrderId)) {
      // Without a completed purchase only the attacks that need no buyer and no real webhook can run.
      // A purchase PayPal captured is enough to attack with, even if the shop then misbehaved (shipped twice, say).
      const buyerFree = ["price-tamper", "bad-bag", "capture-unapproved", "secret-leak"];
      const purchased = legit.ok || legit.captureStatus === "COMPLETED";
      const only = purchased ? opts.attacks : (opts.attacks ?? buyerFree).filter((id) => buyerFree.includes(id));
      attacks = await runAttacks({ run, shop: sandbox.shop, proxy: sandbox.proxy, tap: sandbox.tap, legit, hoodie: HOODIE }, only);
    }
    // The webhook verdict for the round: how the shop answered a genuine, signed PAYMENT.CAPTURE.COMPLETED delivery.
    const completed = sandbox.tap.genuine("PAYMENT.CAPTURE.COMPLETED");
    const best = completed.find((d) => d.resourceId === legit.captureId) ?? completed[0];
    const webhook: WebhookStatus = !best ? "not-delivered" : best.shopStatus >= 200 && best.shopStatus < 300 ? "verified" : "refused";
    run.emit("prove", "prove.webhook", { round, status: webhook, eventId: best?.eventId ?? null, resourceId: best?.resourceId ?? null, shopStatus: best?.shopStatus ?? null, ok: webhook === "verified" });
    const result: Round = { round, tests: tests.ok, prove: legit, attacks, webhookVerified: webhook === "verified", webhook, webhookEvent: best?.eventId ?? null, paypalErrors };
    run.writeJson(`round${round}.json`, result);
    return result;
  } finally {
    await sandbox.close();
    await closeBrowser();
  }
}

/** Problems with the sandbox or the test accounts, not with the shop's code: never sent to the coding agent. */
export function environmentProblem(r: Round): string | null {
  if (!r.prove.ok && /sandbox checkout page kept failing|sandbox buyer|SANDBOX_BUYER|seller account|CAPTCHA/.test(r.prove.verdict)) return r.prove.verdict;
  return null;
}

export function failures(r: Round): Array<{ title: string; detail: string }> {
  const out: Array<{ title: string; detail: string }> = [];
  if (!r.tests) out.push({ title: "npm test fails", detail: "Run npm test and fix the failures." });
  if (!r.prove.ok) {
    const errors = (r.paypalErrors ?? []).filter((e) => !e.call.includes("/v1/oauth2/token"));
    const told = errors.map((e) => `PayPal answered ${e.call} with HTTP ${e.status} ${e.name ?? ""}${e.issue ? ` (${e.issue})` : ""}${e.message ? `: ${e.message}` : ""} [debug id ${e.debugId}]`).join("; ");
    out.push({ title: "The real sandbox purchase did not complete correctly", detail: `${r.prove.verdict}${told ? ` ${told}.` : ""}` });
  }
  if (r.webhook === "refused") out.push({ title: "The shop refused PayPal's genuine PAYMENT.CAPTURE.COMPLETED webhook", detail: `A genuine, signed delivery (event ${r.webhookEvent}) to POST /api/paypal/webhooks did not get a 2xx answer.` });
  for (const a of r.attacks) if (a.verdict === "error") out.push({ title: `Attack "${a.title}" could not run`, detail: a.summary });
  for (const a of r.attacks) if (a.verdict === "robbed") out.push({ title: `Attack "${a.title}" succeeded (rules ${a.rule.join(", ")})`, detail: a.summary });
  return out;
}

/** Check, and while anything fails, hand the evidence back to the coding agent and check again. */
export async function proveAndHarden(run: Run, shopDir: string, maxFixes = 2): Promise<Round[]> {
  const rounds: Round[] = [];
  for (let round = 0; round <= maxFixes; round++) {
    const r = await checkShop(run, shopDir, round);
    rounds.push(r);
    const f = failures(r);
    const env = environmentProblem(r);
    run.emit(round === 0 ? "attack" : "fix", "round.done", { round, failures: f.length, robbed: r.attacks.filter((a) => a.verdict === "robbed").length, environment: env });
    if (env) break; // a sandbox or account problem: fixing the shop would not help
    if (f.length === 0 || round === maxFixes) break;
    commit(shopDir, round === 0 ? "Add PayPal, Venmo and Pay Later checkout" : `Harden checkout (round ${round})`);
    await runCodingAgent({ run, phase: "fix", cwd: shopDir, prompt: fixPrompt(f), label: `fix-${round + 1}`, maxTurns: 80 });
    run.writeText(`fix-${round + 1}.patch`, diff(shopDir).patch);
  }
  return rounds;
}
