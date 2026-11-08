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
const calls = (dir: string, file: string) => JSON.parse(fs.readFileSync(path.join(RUNS, dir, file), "utf8")) as Array<{ path: string; status: number; debugId: string | null }>;
const refusedCapture = (list: Array<{ path: string; status: number }>) => list.some((c) => c.status === 415 && /\/capture$/.test(c.path));
const nothingFromTheThief = (r: Round) => Boolean(r.thief?.ran && r.thief.plans.length > 0 && r.thief.plans.every((p) => p.verdict !== "robbed"));

test("the full run: PayPal refused the agent's first capture, the agent fixed it, and every robbery was blocked", () => {
  const all = rounds("2026-11-08-full-run");
  assert.equal(verdictOf(all[0]), "unsafe", "round 1 failed");
  assert.ok(refusedCapture(calls("2026-11-08-full-run", "round0-paypal-calls.json")), "PayPal answered 415 at capture");
  const last = all.at(-1)!;
  assert.equal(last.attacks.length, 10);
  assert.deepEqual(robbed(last), []);
  assert.ok(nothingFromTheThief(last), "nothing the AI thief tried got through");
  assert.equal(last.books?.matched, true);
  assert.deepEqual(last.books?.mismatches, []);
  assert.equal(verdictOf(last), "safe");
});

test("the 415 is not chance: every earlier full run hit the same refusal at capture", () => {
  assert.ok(refusedCapture(calls(path.join("archive", "2026-11-07-full-run"), "prove-paypal-calls.json")), "2026-11-07");
  for (const id of ["2026-11-08-full-run-earlier", "2026-11-08-full-run-third", "2026-11-08-full-run-fourth", "2026-11-08-full-run-fifth"]) assert.ok(refusedCapture(calls(path.join("archive", id), "round0-paypal-calls.json")), id);
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
  // On a shop that already leaks, the thief gets no credit for repeating a known problem.
  assert.ok(r.thief?.plans.every((p) => p.verdict !== "robbed"), "no new way in from the thief");
  assert.equal(verdictOf(r), "unsafe");
});

test("the naive checkout: PayPal would have charged $4,900, and the hoodie shipped for one cent", () => {
  const r = lastRound("2026-11-08-naive-penny-heist");
  assert.match(r.prove.verdict, /\$4900/);
  assert.equal(results(r)["price-tamper"], "robbed");
  assert.equal(verdictOf(r), "unsafe");
});

test("Copper Kettle, built differently, and the agent's checkout rechecked: all ten ran and were blocked", () => {
  for (const id of ["2026-11-08-copper-kettle", "2026-11-08-agent-checkout-recheck"]) {
    const r = lastRound(id);
    assert.equal(r.attacks.length, 10, id);
    assert.ok(r.attacks.every((a) => a.verdict === "held"), `${id}: every robbery ran and was blocked`);
    assert.ok(nothingFromTheThief(r), `${id}: nothing from the thief`);
    assert.equal(verdictOf(r), "safe", id);
  }
});

test("a check whose webhook robberies could not run is incomplete, never safe (an earlier recording)", () => {
  const r = JSON.parse(fs.readFileSync(path.join(RUNS, "archive", "2026-11-08-copper-kettle-incomplete", "rounds.json"), "utf8")).at(-1) as Round;
  assert.deepEqual(robbed(r), []);
  assert.ok(r.attacks.some((a) => a.verdict === "skipped"), "a robbery could not run");
  assert.equal(verdictOf(r), "incomplete");
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
  assert.ok(nothingFromTheThief(last));
  assert.equal(verdictOf(last), "safe");
});

test("live in PayPal's sandbox, the AI thief found the mistake none of the ten can see, and the books caught it", () => {
  const r = lastRound("2026-11-08-thief-binding");
  assert.equal(r.attacks.length, 10);
  assert.ok(r.attacks.every((a) => a.verdict === "held"), "all ten scripted robberies pass this shop");
  assert.equal(r.thief?.ran, true);
  assert.equal(r.thief?.source, "model", "the plans were invented live, not replayed");
  const got = r.thief?.plans.filter((p) => p.verdict === "robbed") ?? [];
  assert.ok(got.some((p) => p.mismatches.some((m) => /already pays for order/.test(m.problem))), "one payment pays for two orders");
  assert.equal(verdictOf(r), "unsafe");
  // The first live run found it too; there the books caught it, before plans waited for PayPal's late events.
  const first = JSON.parse(fs.readFileSync(path.join(RUNS, "archive", "2026-11-08-thief-binding-first", "rounds.json"), "utf8")).at(-1) as Round;
  assert.ok(first.books?.mismatches.some((m) => /already pays for order/.test(m.problem)));
});
