// npx tsx src/cli/migrate.ts [shop-template] [--baseline]
// Copies a sample shop, runs the coding agent on it and records everything in .heistproof/runs/<id>/.
import { Run } from "../events.ts";
import { runCodingAgent } from "../agent.ts";
import { prepareShop, diff, runTests } from "../workspace.ts";
import { MIGRATION_PROMPT, BASELINE_PROMPT } from "../prompts.ts";

const args = process.argv.slice(2);
const template = args.find((a) => !a.startsWith("--")) ?? "fogline-express";
const baseline = args.includes("--baseline");

const run = new Run();
run.onEvent((e) => {
  const brief = e.type === "agent.tool" ? `${e.name} ${String(e.input).slice(0, 140)}` : e.type === "agent.text" ? String(e.text).slice(0, 160) : "";
  console.log(`[${e.t.slice(11, 19)}] ${e.phase} ${e.type} ${brief}`.replace(/\s+/g, " "));
});

run.emit("prepare", "run.start", { template, mode: baseline ? "baseline" : "heistproof" });
const shop = prepareShop(template, run.id);
run.emit("prepare", "shop.ready", { shop });

const result = await runCodingAgent({ run, phase: "migrate", cwd: shop, prompt: baseline ? BASELINE_PROMPT : MIGRATION_PROMPT, label: baseline ? "baseline" : "migrate", withContext: !baseline });
const d = diff(shop);
run.writeText("migrate.patch", d.patch);
const tests = runTests(shop);
run.writeText("tests.txt", tests.output);
run.emit("build", "build.result", { testsOk: tests.ok, diffStat: d.stat, skillsLoaded: result.skillsLoaded, turns: result.turns, durationMs: result.durationMs });
console.log(`\nRun ${run.id}\nshop: ${shop}\ntests: ${tests.ok ? "pass" : "FAIL"}\nskills: ${result.skillsLoaded.join(", ")}\n${d.stat}`);
