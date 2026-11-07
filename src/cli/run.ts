// npx tsx src/cli/run.ts [shop-template] [--fix=2] [--baseline] [--existing]
// --existing: the shop already takes PayPal; skip the migration and go straight to buy, rob and fix.
// The whole job: copy the card-only shop, let the coding agent add PayPal, prove it with a real sandbox
// purchase, attack it, hand failures back to the agent, and write the pull request with the evidence.
import fs from "node:fs";
import path from "node:path";
import { Run } from "../events.ts";
import { runCodingAgent } from "../agent.ts";
import { prepareShop, diff, commit, switchBranch, openPullRequest, heistproofCommit } from "../workspace.ts";
import { MIGRATION_PROMPT, BASELINE_PROMPT } from "../prompts.ts";
import { proveAndHarden, verdictOf, VERDICT_LINE } from "../pipeline.ts";
import { renderReport } from "../report.ts";
import { chooseEngine } from "../engine.ts";

const args = process.argv.slice(2);
const template = args.find((a) => !a.startsWith("--")) ?? "fogline-express";
const baseline = args.includes("--baseline");
const existing = args.includes("--existing");
const fixes = Number(args.find((a) => a.startsWith("--fix="))?.split("=")[1] ?? (baseline ? 0 : 2));

const run = new Run();
// Every skill the coding agent loaded, in the migration and in every fix round.
const skills: string[] = [];
run.onEvent((e) => {
  if (e.type === "agent.tool" && e.name === "Skill") {
    try {
      const s = JSON.parse(String(e.input)).skill;
      if (s && !skills.includes(s)) skills.push(s);
    } catch {}
  }
});
run.onEvent((e) => {
  if (e.type === "agent.tool_result") return;
  const detail = e.type === "attack.result" ? `${e.verdict} - ${e.summary}` : e.type === "agent.tool" ? `${e.name} ${String(e.input).slice(0, 120)}` : e.type === "agent.text" ? e.text : e.verdict ?? "";
  console.log(`[${e.t.slice(11, 19)}] ${e.phase} ${e.type} ${String(detail).replace(/\s+/g, " ").slice(0, 200)}`);
});

const choice = chooseEngine();
run.emit("prepare", "run.start", { template, mode: baseline ? "baseline" : existing ? "existing" : "heistproof", provider: choice.spec.id, model: choice.model ?? choice.spec.model, heistproofCommit: heistproofCommit(), node: process.versions.node });
const shopDir = prepareShop(template, run.id);
run.emit("prepare", "shop.ready", { shop: shopDir });

const agent = existing
  ? { skillsLoaded: [] as string[], turns: 0, durationMs: 0, model: choice.model ?? choice.spec.model }
  : await runCodingAgent({ run, phase: "migrate", cwd: shopDir, prompt: baseline ? BASELINE_PROMPT : MIGRATION_PROMPT, label: baseline ? "baseline" : "migrate", withContext: !baseline });
if (!existing) {
  run.writeText("migrate.patch", diff(shopDir).patch);
  run.emit("build", "migrate.done", { skillsLoaded: agent.skillsLoaded, turns: agent.turns, durationMs: agent.durationMs });
}

const rounds = await proveAndHarden(run, shopDir, fixes);
const last = rounds.at(-1)!;
const robbed = last.attacks.filter((a) => a.verdict === "robbed").length;
const verdict = verdictOf(last);
const safe = verdict === "safe";

const report = renderReport({ shopDir, rounds, title: baseline ? "Baseline (no Heistproof context) evidence report" : "Heistproof evidence report", agent: { provider: choice.spec.label, model: agent.model, skills } });
run.writeText("REPORT.md", report);
run.writeJson("rounds.json", rounds);
fs.writeFileSync(path.join(shopDir, "HEISTPROOF-REPORT.md"), report);
const title = safe ? "Add PayPal, Venmo and Pay Later checkout (Heistproof: every robbery blocked)" : verdict === "incomplete" ? "Add PayPal checkout (Heistproof: check incomplete, see report)" : "Add PayPal checkout (Heistproof: NOT safe to ship, see report)";
const branch = "heistproof/paypal-checkout";
switchBranch(shopDir, branch);
commit(shopDir, title);
const shipped = { branch, pr: openPullRequest(shopDir, branch, title, path.join(shopDir, "HEISTPROOF-REPORT.md")) };
run.writeText("final.patch", diff(shopDir).patch);
run.emit("ship", "run.done", { safe, verdict, robbed, rounds: rounds.length, shop: shopDir, branch: shipped.branch, pr: shipped.pr });
console.log(`\nRun ${run.id}: ${VERDICT_LINE[verdict]}\nshop: ${shopDir}\nbranch: ${shipped.branch}${shipped.pr ? `\npull request: ${shipped.pr}` : ""}\nreport: ${run.file("REPORT.md")}`);
process.exitCode = safe ? 0 : verdict === "incomplete" ? 2 : 1;
