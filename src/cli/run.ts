// npx tsx src/cli/run.ts [shop-template] [--fix=2] [--baseline] [--existing]
// --existing: the shop already takes PayPal; skip the migration and go straight to buy, rob and fix.
// The whole job: copy the card-only shop, let the coding agent add PayPal, prove it with a real sandbox
// purchase, attack it, hand failures back to the agent, and write the pull request with the evidence.
import fs from "node:fs";
import path from "node:path";
import { Run } from "../events.ts";
import { runCodingAgent } from "../agent.ts";
import { prepareShop, diff, commit } from "../workspace.ts";
import { MIGRATION_PROMPT, BASELINE_PROMPT } from "../prompts.ts";
import { proveAndHarden, isSafe } from "../pipeline.ts";
import { renderReport } from "../report.ts";
import { chooseEngine } from "../engine.ts";

const args = process.argv.slice(2);
const template = args.find((a) => !a.startsWith("--")) ?? "fogline-express";
const baseline = args.includes("--baseline");
const existing = args.includes("--existing");
const fixes = Number(args.find((a) => a.startsWith("--fix="))?.split("=")[1] ?? (baseline ? 0 : 2));

const run = new Run();
run.onEvent((e) => {
  if (e.type === "agent.tool_result") return;
  const detail = e.type === "attack.result" ? `${e.verdict} - ${e.summary}` : e.type === "agent.tool" ? `${e.name} ${String(e.input).slice(0, 120)}` : e.type === "agent.text" ? e.text : e.verdict ?? "";
  console.log(`[${e.t.slice(11, 19)}] ${e.phase} ${e.type} ${String(detail).replace(/\s+/g, " ").slice(0, 200)}`);
});

const choice = chooseEngine();
run.emit("prepare", "run.start", { template, mode: baseline ? "baseline" : existing ? "existing" : "heistproof", provider: choice.spec.id, model: choice.model ?? choice.spec.model });
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
const safe = isSafe(last);

const report = renderReport({ shopDir, rounds, title: baseline ? "Baseline (no Heistproof context) evidence report" : "Heistproof evidence report", agent: { provider: choice.spec.label, model: agent.model, skills: [...new Set(agent.skillsLoaded)] } });
run.writeText("REPORT.md", report);
run.writeJson("rounds.json", rounds);
fs.writeFileSync(path.join(shopDir, "HEISTPROOF-REPORT.md"), report);
commit(shopDir, safe ? "Add PayPal, Venmo and Pay Later checkout (Heistproof: all attacks held)" : "Add PayPal checkout (Heistproof: NOT safe to ship, see report)");
run.writeText("final.patch", diff(shopDir).patch);
run.emit("ship", "run.done", { safe, robbed, rounds: rounds.length, shop: shopDir, branchReady: safe });
console.log(`\nRun ${run.id}: ${safe ? "SAFE TO SHIP" : "DO NOT SHIP"}\nshop: ${shopDir}\nreport: ${run.file("REPORT.md")}`);
