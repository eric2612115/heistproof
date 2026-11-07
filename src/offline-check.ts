import { goOffline } from "./config.ts";
import { Run } from "./events.ts";
import { checkShop, verdictOf, type Round, type Verdict } from "./pipeline.ts";
import { writeReport } from "./report.ts";
import { heistproofCommit, sourceHash } from "./workspace.ts";

/**
 * One check of a shop against Heistproof's offline PayPal stand-in: a real purchase in a real browser, then the
 * robberies, recorded as a run like any other (with offline: true). No PayPal account, no keys, no network.
 */
export async function checkOffline(shopDir: string, opts: { attacks?: string[]; label?: string } = {}): Promise<{ run: Run; round: Round; verdict: Verdict }> {
  goOffline();
  const run = new Run();
  run.emit("prepare", "run.start", { shop: shopDir, template: opts.label ?? shopDir.split("/").pop(), mode: "check", offline: true, attacks: opts.attacks ?? "all", heistproofCommit: heistproofCommit(), sourceHash: sourceHash(), node: process.versions.node });
  const round = await checkShop(run, shopDir, 0, { attacks: opts.attacks });
  writeReport(run, { shopDir, rounds: [round], offline: true });
  const verdict = verdictOf(round);
  run.emit("ship", "run.done", { safe: verdict === "safe", verdict, robbed: round.attacks.filter((a) => a.verdict === "robbed").length, rounds: 1, shop: shopDir });
  return { run, round, verdict };
}
