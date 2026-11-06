import { openSandbox } from "./sandbox.ts";
import { purchase, closeBrowser, type PurchaseResult } from "./prove.ts";
import { runAttacks, type AttackOutcome } from "./attacks.ts";
import { runCodingAgent } from "./agent.ts";
import { fixPrompt } from "./prompts.ts";
import { diff, runTests, commit, ensureInstalled } from "./workspace.ts";
import type { Run, Phase } from "./events.ts";

export const HOODIE = [{ sku: "FOG-HOODIE", qty: 1 }];

export type Round = { round: number; tests: boolean; prove: PurchaseResult; attacks: AttackOutcome[]; webhookVerified: boolean };

/** One full check of the shop as it is now: build, a real sandbox purchase, then every attack. */
export async function checkShop(run: Run, shopDir: string, round: number, opts: { attacks?: string[]; skipAttacks?: boolean } = {}): Promise<Round> {
  const phase: Phase = round === 0 ? "prove" : "fix";
  ensureInstalled(shopDir);
  const tests = runTests(shopDir);
  run.emit("build", "build.tests", { round, ok: tests.ok, output: tests.output.slice(-3000) });
  const sandbox = await openSandbox(run, phase, shopDir, `shop-round${round}.db`);
  try {
    const legit = await purchase({ run, phase: "prove", shop: sandbox.shop, tap: sandbox.tap, items: HOODIE, label: `round${round}-purchase` });
    let webhookVerified = false;
    if (legit.ok && legit.captureId) {
      const delivery = await sandbox.tap.waitFor((d) => d.eventType === "PAYMENT.CAPTURE.COMPLETED" && d.resourceId === legit.captureId, 120_000);
      webhookVerified = Boolean(delivery && delivery.shopStatus >= 200 && delivery.shopStatus < 300);
      run.emit("prove", "prove.webhook", { round, eventId: delivery?.eventId ?? null, shopStatus: delivery?.shopStatus ?? null, ok: webhookVerified });
    }
    let attacks: AttackOutcome[] = [];
    if (!opts.skipAttacks && (legit.ok || legit.paypalOrderId)) {
      // Without a completed purchase only the attacks that need no buyer and no real webhook can run.
      const buyerFree = ["price-tamper", "bad-bag", "capture-unapproved", "secret-leak"];
      const only = legit.ok ? opts.attacks : (opts.attacks ?? buyerFree).filter((id) => buyerFree.includes(id));
      attacks = await runAttacks({ run, shop: sandbox.shop, proxy: sandbox.proxy, tap: sandbox.tap, legit, hoodie: HOODIE }, only);
    }
    const result: Round = { round, tests: tests.ok, prove: legit, attacks, webhookVerified };
    run.writeJson(`round${round}.json`, result);
    return result;
  } finally {
    await sandbox.close();
    await closeBrowser();
  }
}

export function failures(r: Round): Array<{ title: string; detail: string }> {
  const out: Array<{ title: string; detail: string }> = [];
  if (!r.tests) out.push({ title: "npm test fails", detail: "Run npm test and fix the failures." });
  if (!r.prove.ok) out.push({ title: "The real sandbox purchase did not complete correctly", detail: r.prove.verdict });
  if (r.prove.ok && !r.webhookVerified) out.push({ title: "PayPal's PAYMENT.CAPTURE.COMPLETED webhook was not accepted", detail: "A genuine, signed delivery to POST /api/paypal/webhooks did not get a 2xx answer." });
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
    run.emit(round === 0 ? "attack" : "fix", "round.done", { round, failures: f.length, robbed: r.attacks.filter((a) => a.verdict === "robbed").length });
    if (f.length === 0 || round === maxFixes) break;
    commit(shopDir, round === 0 ? "Add PayPal, Venmo and Pay Later checkout" : `Harden checkout (round ${round})`);
    await runCodingAgent({ run, phase: "fix", cwd: shopDir, prompt: fixPrompt(f), label: `fix-${round + 1}`, maxTurns: 80 });
    run.writeText(`fix-${round + 1}.patch`, diff(shopDir).patch);
  }
  return rounds;
}
