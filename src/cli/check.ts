// npx tsx src/cli/check.ts <shop-dir> [--attacks=id,id] [--skip-attacks] [--fix=N] [--method=paypal|venmo|paylater] [--offline] [--no-thief] [--thief-plans=file]
// Checks a shop that already takes PayPal: one real purchase, the ten robberies, then the AI thief's own robberies when a
// model key is set (and optional fix rounds, on a copy).
// --offline: PayPal is Heistproof's local stand-in; no PayPal keys and no PayPal network needed.
// --thief-plans: replay robberies an AI thief invented in an earlier run (round0-thief-plans.json) instead of asking a model.
import path from "node:path";
import { Run } from "../events.ts";
import { checkShop, proveAndHarden, verdictOf, verdictLine } from "../pipeline.ts";
import { heistproofCommit, sourceHash, prepareShop, headCommit, diffSince } from "../workspace.ts";
import { writeReport } from "../report.ts";
import { offlineFlag, preflight, stopIfMissing, main } from "./common.ts";

const args = process.argv.slice(2);
const shopDir = path.resolve(args.find((a) => !a.startsWith("--")) ?? ".");
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}`))?.split("=")[1];
const attacks = flag("attacks")?.split(",");
const fixes = Number(flag("fix") ?? 0);
const method = (flag("method") ?? "paypal") as "paypal" | "venmo" | "paylater";
const offline = offlineFlag(args);
const thief = args.includes("--no-thief") ? (false as const) : { plansFile: flag("thief-plans") ? path.resolve(flag("thief-plans")!) : undefined };
stopIfMissing(preflight({ paypal: !offline, model: fixes > 0, tunnel: !offline }));

const run = new Run();
run.onEvent((e) => {
  if (e.type.startsWith("agent.tool_result")) return;
  const detail = e.type === "attack.result" ? `${e.verdict} - ${e.summary}` : e.type === "agent.tool" ? `${e.name} ${String(e.input).slice(0, 120)}` : (e.verdict ?? e.summary ?? e.error ?? "");
  console.log(`[${e.t.slice(11, 19)}] ${e.phase} ${e.type} ${String(detail).replace(/\s+/g, " ").slice(0, 220)}`);
});

await main(run, async () => {
  run.emit("prepare", "run.start", { shop: shopDir, template: path.basename(shopDir), mode: "check", offline, attacks: attacks ?? "all", heistproofCommit: heistproofCommit(), sourceHash: sourceHash(), node: process.versions.node });
  // Fix rounds change code: they work on a copy, never in the folder you pointed at.
  const dir = fixes > 0 ? prepareShop(shopDir, run.id) : shopDir;
  const base = fixes > 0 ? headCommit(dir) : null;
  if (fixes > 0) run.emit("prepare", "shop.ready", { shop: dir, base });
  const rounds = fixes > 0 ? await proveAndHarden(run, dir, fixes, thief) : [await checkShop(run, dir, 0, { attacks, skipAttacks: args.includes("--skip-attacks"), method, thief })];
  const report = writeReport(run, { shopDir: dir, rounds, offline });
  if (base) run.writeText("final.patch", diffSince(dir, base));
  const last = rounds.at(-1)!;
  const robbed = last.attacks.filter((a) => a.verdict === "robbed").length;
  const verdict = verdictOf(last);
  const safe = verdict === "safe";
  run.emit("ship", "run.done", { safe, verdict, robbed, rounds: rounds.length, shop: dir });
  console.log(`\nRun ${run.id}: ${verdictLine(last)}${attacks ? `\n(only ${attacks.length} of the 10 robberies were asked for, so this check can never say safe)` : ""}\nreport: ${report}`);
  return safe ? 0 : verdict === "incomplete" ? 2 : 1;
});
