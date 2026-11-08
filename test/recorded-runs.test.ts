// The recorded runs in runs/ are the project's evidence. These tests re-derive each run's verdict from its own
// rounds.json with the code that decides verdicts, and check the reports against the events they were written from.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { verdictOf, type Round } from "../src/pipeline.ts";

const RUNS = path.join(import.meta.dirname, "..", "runs");
const rounds = (id: string): Round[] => JSON.parse(fs.readFileSync(path.join(RUNS, id, "rounds.json"), "utf8")) as Round[];
const lastRound = (id: string): Round => rounds(id).at(-1)!;
const results = (r: Round) => Object.fromEntries(r.attacks.map((a) => [a.id, a.verdict]));
const robbed = (r: Round) => r.attacks.filter((a) => a.verdict === "robbed").map((a) => a.id).sort();
const calls = (id: string, round: number) => JSON.parse(fs.readFileSync(path.join(RUNS, id, `round${round}-paypal-calls.json`), "utf8")) as Array<{ path: string; status: number; debugId: string | null }>;

test("the full run: PayPal refused the agent's first capture, the agent fixed it, and every robbery was blocked", () => {
  const all = rounds("2026-11-08-full-run");
  assert.equal(verdictOf(all[0]), "unsafe", "round 1 failed");
  assert.ok(calls("2026-11-08-full-run", 0).some((c) => c.status === 415 && /\/capture$/.test(c.path)), "PayPal answered 415 at capture");
  const last = all.at(-1)!;
  assert.equal(last.attacks.length, 10);
  assert.deepEqual(robbed(last), []);
  assert.ok(last.thief?.ran && last.thief.plans.length > 0 && last.thief.plans.every((p) => p.verdict !== "robbed"), "nothing the AI thief tried got through");
  assert.deepEqual(last.books?.mismatches, []);
  assert.equal(verdictOf(last), "safe");
});

test("the 415 is not chance: an earlier full run hit the same refusal at capture", () => {
  const archived = path.join(RUNS, "archive", "2026-11-07-full-run", "prove-paypal-calls.json");
  const earlier = JSON.parse(fs.readFileSync(archived, "utf8")) as Array<{ path: string; status: number }>;
  assert.ok(earlier.some((c) => c.status === 415 && /\/capture$/.test(c.path)));
});

test("the same model without any PayPal skills wrote a checkout that was safe at the first try", () => {
  const all = rounds("2026-11-08-ai-alone");
  assert.equal(all.length, 1);
  assert.equal(verdictOf(all[0]), "safe");
});

test("the hand-written afternoon checkout is robbed 8 ways out of 10, and its books do not match PayPal's", () => {
  const r = lastRound("2026-11-08-afternoon-robbed");
  assert.deepEqual(robbed(r), ["approved-not-captured", "capture-unapproved", "declined-capture", "double-capture", "forged-webhook", "out-of-order", "price-tamper", "webhook-replay"]);
  const v = results(r);
  assert.equal(v["bad-bag"], "held");
  assert.equal(v["secret-leak"], "held");
  assert.ok((r.books?.mismatches.length ?? 0) > 0);
  assert.equal(verdictOf(r), "unsafe");
});

test("the naive checkout: PayPal would have charged $4,900, and the hoodie shipped for one cent", () => {
  const r = lastRound("2026-11-08-naive-penny-heist");
  assert.match(r.prove.verdict, /\$4900/);
  assert.equal(results(r)["price-tamper"], "robbed");
  assert.equal(verdictOf(r), "unsafe");
});

test("a check whose webhook robberies could not run is incomplete, never safe", () => {
  for (const id of ["2026-11-08-copper-kettle", "2026-11-08-agent-checkout-recheck"]) {
    const r = lastRound(id);
    assert.deepEqual(robbed(r), [], `${id}: nothing got through`);
    assert.ok(r.attacks.some((a) => a.verdict === "skipped"), `${id}: a robbery could not run`);
    assert.equal(verdictOf(r), "incomplete", id);
  }
});

test("every agent run's report names the skills its events show", () => {
  for (const id of ["2026-11-08-full-run"]) {
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

test("the agent fixed a hand-written checkout in one round: a $4,900 charge and two robberies, then everything blocked", () => {
  const all = rounds("2026-11-08-naive-hardened");
  assert.match(all[0].prove.verdict, /\$4900/);
  assert.ok(robbed(all[0]).length >= 1);
  assert.equal(verdictOf(all[0]), "unsafe");
  const last = all.at(-1)!;
  assert.equal(last.attacks.length, 10);
  assert.deepEqual(robbed(last), []);
  assert.equal(verdictOf(last), "safe");
});

