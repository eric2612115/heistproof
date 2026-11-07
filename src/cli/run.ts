// npx tsx src/cli/run.ts [shop-template] [--fix=2] [--baseline] [--existing] [--offline]
// --existing: the shop already takes PayPal; skip the migration and go straight to buy, rob and fix.
// --baseline: the same agent without APIMatic's plugin or Heistproof's skills, to measure what they are worth.
// --offline: PayPal is Heistproof's local stand-in (a model key is still needed for the agent).
// --no-thief: skip the AI thief (by default it invents robberies of its own after the ten, in every round).
// The whole job: copy the card-only shop, let the coding agent add PayPal, prove it with a real purchase, attack it,
// hand failures back to the agent, and ship a branch (with a pull request only when every robbery is blocked).
import fs from "node:fs";
import path from "node:path";
import { Run } from "../events.ts";
import { runCodingAgent } from "../agent.ts";
import { prepareShop, diff, commit, switchBranch, openPullRequest, heistproofCommit, sourceHash, headCommit, diffSince } from "../workspace.ts";
import { MIGRATION_PROMPT, BASELINE_PROMPT } from "../prompts.ts";
import { proveAndHarden, verdictOf, VERDICT_LINE } from "../pipeline.ts";
import { renderReport } from "../report.ts";
import { chooseEngine } from "../engine.ts";
import { offlineFlag, preflight, stopIfMissing, main } from "./common.ts";

const args = process.argv.slice(2);
const template = args.find((a) => !a.startsWith("--")) ?? "fogline-express";
const baseline = args.includes("--baseline");
const existing = args.includes("--existing");
const offline = offlineFlag(args);
const fixes = Number(args.find((a) => a.startsWith("--fix="))?.split("=")[1] ?? (baseline ? 0 : 2));
stopIfMissing(preflight({ paypal: !offline, model: !existing || fixes > 0, tunnel: !offline }));

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
  const detail = e.type === "attack.result" ? `${e.verdict} - ${e.summary}` : e.type === "agent.tool" ? `${e.name} ${String(e.input).slice(0, 120)}` : e.type === "agent.text" ? e.text : (e.verdict ?? e.error ?? "");
  console.log(`[${e.t.slice(11, 19)}] ${e.phase} ${e.type} ${String(detail).replace(/\s+/g, " ").slice(0, 200)}`);
});

await main(run, async () => {
  const choice = existing && fixes === 0 ? null : chooseEngine();
  run.emit("prepare", "run.start", { template, mode: baseline ? "baseline" : existing ? "existing" : "heistproof", offline, provider: choice?.spec.id ?? null, model: choice ? (choice.model ?? choice.spec.model) : null, heistproofCommit: heistproofCommit(), sourceHash: sourceHash(), node: process.versions.node });
  const shopDir = prepareShop(template, run.id);
  const base = headCommit(shopDir);
  run.emit("prepare", "shop.ready", { shop: shopDir, base });

  const agent = existing
    ? { skillsLoaded: [] as string[], turns: 0, durationMs: 0, model: choice ? (choice.model ?? choice.spec.model) : "none" }
    : await runCodingAgent({ run, phase: "migrate", cwd: shopDir, prompt: baseline ? BASELINE_PROMPT : MIGRATION_PROMPT, label: baseline ? "baseline" : "migrate", withContext: !baseline });
  if (!existing) {
    run.writeText("migrate.patch", diff(shopDir).patch);
    run.emit("build", "migrate.done", { skillsLoaded: agent.skillsLoaded, turns: agent.turns, durationMs: agent.durationMs });
  }

  const rounds = await proveAndHarden(run, shopDir, fixes, args.includes("--no-thief") ? false : {});
  const last = rounds.at(-1)!;
  const robbed = last.attacks.filter((a) => a.verdict === "robbed").length;
  const verdict = verdictOf(last);
  const safe = verdict === "safe";

  const report = renderReport({ shopDir, rounds, offline, title: baseline ? "Baseline (no PayPal skills) evidence report" : "Heistproof evidence report", agent: choice ? { provider: choice.spec.label, model: agent.model, skills } : undefined });
  run.writeText("REPORT.md", report);
  run.writeJson("rounds.json", rounds);
  fs.writeFileSync(path.join(shopDir, "HEISTPROOF-REPORT.md"), report);
  const title = safe ? "Add PayPal, Venmo and Pay Later checkout (Heistproof: every robbery blocked)" : verdict === "incomplete" ? "Add PayPal checkout (Heistproof: check incomplete, see report)" : "Add PayPal checkout (Heistproof: NOT safe to ship, see report)";
  const branch = "heistproof/paypal-checkout";
  switchBranch(shopDir, branch);
  commit(shopDir, title);
  // The verdict gates the pull request: it is opened only when every robbery was blocked. Otherwise the branch and
  // the report stay for a person to read.
  const pr = safe ? openPullRequest(shopDir, branch, title, path.join(shopDir, "HEISTPROOF-REPORT.md")) : null;
  run.writeText("final.patch", diffSince(shopDir, base));
  run.emit("ship", "run.done", { safe, verdict, robbed, rounds: rounds.length, shop: shopDir, branch, pr, prNote: safe ? null : "No pull request: one is opened only when every robbery is blocked." });
  console.log(`\nRun ${run.id}: ${VERDICT_LINE[verdict]}\nshop: ${shopDir}\nbranch: ${branch}${pr ? `\npull request: ${pr}` : safe ? "" : "\nno pull request (opened only when every robbery is blocked)"}\nreport: ${run.file("REPORT.md")}`);
  return safe ? 0 : verdict === "incomplete" ? 2 : 1;
});
