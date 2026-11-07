// npx tsx src/cli/check.ts <shop-dir> [--attacks=id,id] [--skip-attacks] [--fix=N] [--method=paypal|venmo|paylater]
// Runs a migrated shop against the PayPal sandbox: one real purchase, then the attacks (and optional fix rounds).
import path from "node:path";
import { Run } from "../events.ts";
import { checkShop, proveAndHarden, verdictOf, VERDICT_LINE } from "../pipeline.ts";
import { heistproofCommit } from "../workspace.ts";
import { writeReport } from "../report.ts";

const args = process.argv.slice(2);
const shopDir = path.resolve(args.find((a) => !a.startsWith("--")) ?? ".");
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}`))?.split("=")[1];
const attacks = flag("attacks")?.split(",");
const fixes = Number(flag("fix") ?? 0);
const method = (flag("method") ?? "paypal") as "paypal" | "venmo" | "paylater";

const run = new Run();
run.onEvent((e) => {
  if (e.type.startsWith("agent.tool_result")) return;
  const detail = e.type === "attack.result" ? `${e.verdict} - ${e.summary}` : e.type === "agent.tool" ? `${e.name} ${String(e.input).slice(0, 120)}` : e.verdict ?? e.summary ?? "";
  console.log(`[${e.t.slice(11, 19)}] ${e.phase} ${e.type} ${String(detail).replace(/\s+/g, " ").slice(0, 220)}`);
});
run.emit("prepare", "run.start", { shop: shopDir, template: path.basename(shopDir), mode: "check", heistproofCommit: heistproofCommit(), node: process.versions.node });
const rounds = fixes > 0 ? await proveAndHarden(run, shopDir, fixes) : [await checkShop(run, shopDir, 0, { attacks, skipAttacks: args.includes("--skip-attacks"), method })];
const report = writeReport(run, { shopDir, rounds });
const last = rounds.at(-1)!;
const robbed = last.attacks.filter((a) => a.verdict === "robbed").length;
const verdict = verdictOf(last);
const safe = verdict === "safe";
run.emit("ship", "run.done", { safe, verdict, robbed, rounds: rounds.length, shop: shopDir });
console.log(`\nRun ${run.id}: ${VERDICT_LINE[verdict]}\nreport: ${report}`);
process.exitCode = safe ? 0 : verdict === "incomplete" ? 2 : 1;
