import { test } from "node:test";
import assert from "node:assert/strict";
import { verdictOf, type Round } from "../src/pipeline.ts";

const held = (id: string) => ({ id, title: id, rule: [1], verdict: "held" as const, summary: "" });
const base = (over: Partial<Round> = {}): Round =>
  ({
    round: 0,
    tests: true,
    prove: { ok: true, verdict: "Paid $49.00", captureId: "X" },
    attacks: ["price-tamper", "bad-bag"].map(held),
    webhookVerified: true,
    webhook: "verified",
    ...over,
  }) as unknown as Round;

test("safe only when the purchase worked and every robbery was blocked", () => {
  assert.equal(verdictOf(base()), "safe");
});

test("one robbery that worked makes it unsafe", () => {
  assert.equal(verdictOf(base({ attacks: [held("price-tamper"), { ...held("bad-bag"), verdict: "robbed" }] as Round["attacks"] })), "unsafe");
});

test("a skipped robbery is never safe: the check is incomplete", () => {
  assert.equal(verdictOf(base({ attacks: [held("price-tamper"), { ...held("out-of-order"), verdict: "skipped" }] as Round["attacks"] })), "incomplete");
});

test("no robberies at all is incomplete, not safe", () => {
  assert.equal(verdictOf(base({ attacks: [] })), "incomplete");
});

test("failing tests or a refused genuine webhook are unsafe", () => {
  assert.equal(verdictOf(base({ tests: false })), "unsafe");
  assert.equal(verdictOf(base({ webhook: "refused" })), "unsafe");
});

test("a purchase the shop broke is unsafe; a sandbox outage is incomplete", () => {
  assert.equal(verdictOf(base({ prove: { ok: false, verdict: "Capture APPROVED; shop order FOG-1 is pending with 0 labels." } as Round["prove"] })), "unsafe");
  assert.equal(verdictOf(base({ prove: { ok: false, verdict: "PayPal's sandbox checkout page kept failing" } as Round["prove"] })), "incomplete");
});
