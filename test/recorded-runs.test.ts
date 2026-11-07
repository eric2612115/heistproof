// The recorded runs in runs/ are the project's evidence. These tests re-derive each run's verdict from its own
// rounds.json with the code that decides verdicts, and check the reports against the events they were written from.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { verdictOf, type Round } from "../src/pipeline.ts";

const RUNS = path.join(import.meta.dirname, "..", "runs");
const lastRound = (id: string): Round => (JSON.parse(fs.readFileSync(path.join(RUNS, id, "rounds.json"), "utf8")) as Round[]).at(-1)!;
const results = (r: Round) => Object.fromEntries(r.attacks.map((a) => [a.id, a.verdict]));

test("the full run: the agent's checkout blocks all 10 robberies and is safe to ship", () => {
  const r = lastRound("2026-11-07-full-run");
  assert.equal(r.attacks.length, 10);
  assert.ok(r.attacks.every((a) => a.verdict === "held"));
  assert.equal(verdictOf(r), "safe");
});

test("the hand-written afternoon checkout is robbed 8 ways out of 10", () => {
  const r = lastRound("2026-11-07-afternoon-robbed");
  const v = results(r);
  const robbed = Object.keys(v).filter((k) => v[k] === "robbed").sort();
  assert.deepEqual(robbed, ["approved-not-captured", "capture-unapproved", "declined-capture", "double-capture", "forged-webhook", "out-of-order", "price-tamper", "webhook-replay"]);
  assert.equal(v["bad-bag"], "held");
  assert.equal(v["secret-leak"], "held");
  assert.equal(verdictOf(r), "unsafe");
});

test("the naive checkout is robbed for one cent", () => {
  const r = lastRound("2026-11-07-naive-penny-heist");
  assert.equal(results(r)["price-tamper"], "robbed");
  assert.equal(verdictOf(r), "unsafe");
});

test("the hardened naive checkout ends with every robbery blocked", () => {
  const r = lastRound("2026-11-07-naive-hardened");
  assert.equal(r.attacks.length, 10);
  assert.equal(verdictOf(r), "safe");
});

test("every agent run's report names the skills its events show", () => {
  for (const id of ["2026-11-07-full-run", "2026-11-07-naive-hardened"]) {
    const skills = new Set<string>();
    for (const line of fs.readFileSync(path.join(RUNS, id, "events.jsonl"), "utf8").split("\n").filter(Boolean)) {
      const e = JSON.parse(line);
      if (e.type === "agent.tool" && e.name === "Skill") skills.add(JSON.parse(e.input).skill);
    }
    const report = fs.readFileSync(path.join(RUNS, id, "REPORT.md"), "utf8");
    assert.ok(skills.size > 0, `${id} has skill events`);
    for (const s of skills) assert.ok(report.includes(s), `${id} report names ${s}`);
  }
});
