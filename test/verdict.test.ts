import { test } from "node:test";
import assert from "node:assert/strict";
import { verdictOf, ALL_ATTACKS, environmentProblem, type Round } from "../src/pipeline.ts";

const held = (id: string) => ({ id, title: id, what: id, rule: [1], verdict: "held" as const, summary: "", evidence: {} });
const base = (over: Partial<Round> = {}): Round =>
  ({
    round: 0,
    tests: true,
    prove: { ok: true, verdict: "Paid $49.00", captureId: "X", environment: null },
    attacks: ALL_ATTACKS.map(held),
    webhook: "accepted",
    ...over,
  }) as unknown as Round;

test("there are ten robberies, each named once", () => {
  assert.equal(ALL_ATTACKS.length, 10);
  assert.equal(new Set(ALL_ATTACKS).size, 10);
});

test("safe only when the purchase worked and all ten robberies ran and were blocked", () => {
  assert.equal(verdictOf(base()), "safe");
});

test("one robbery that worked makes it unsafe, whichever it is", () => {
  for (const id of ALL_ATTACKS) {
    const attacks = ALL_ATTACKS.map((x) => (x === id ? { ...held(x), verdict: "robbed" as const } : held(x)));
    assert.equal(verdictOf(base({ attacks })), "unsafe", id);
  }
});

test("a missing, skipped or errored robbery is never safe: the check is incomplete", () => {
  for (const id of ALL_ATTACKS) {
    assert.equal(verdictOf(base({ attacks: ALL_ATTACKS.filter((x) => x !== id).map(held) })), "incomplete", `missing ${id}`);
    for (const v of ["skipped", "error"] as const) {
      const attacks = ALL_ATTACKS.map((x) => (x === id ? { ...held(x), verdict: v } : held(x)));
      assert.equal(verdictOf(base({ attacks })), "incomplete", `${v} ${id}`);
    }
  }
});

test("asking for a subset of robberies can never be safe, however many of them held", () => {
  for (let n = 0; n < ALL_ATTACKS.length; n++) assert.equal(verdictOf(base({ attacks: ALL_ATTACKS.slice(0, n).map(held) })), "incomplete", `${n} of 10`);
  // The same robbery reported twice does not stand in for a missing one.
  assert.equal(verdictOf(base({ attacks: [...ALL_ATTACKS.slice(1), ALL_ATTACKS[1]].map(held) })), "incomplete");
});

test("failing tests or a refused genuine webhook are unsafe", () => {
  assert.equal(verdictOf(base({ tests: false })), "unsafe");
  assert.equal(verdictOf(base({ webhook: "refused" })), "unsafe");
});

test("a purchase the shop broke is unsafe; a sandbox or account problem is incomplete", () => {
  assert.equal(verdictOf(base({ prove: { ok: false, verdict: "Capture APPROVED; shop order FOG-1 is pending with 0 labels.", environment: null } as Round["prove"] })), "unsafe");
  for (const environment of ["sandbox-down", "captcha", "buyer-login", "seller-account"]) {
    const r = base({ prove: { ok: false, verdict: "anything", environment } as Round["prove"] });
    assert.equal(verdictOf(r), "incomplete", environment);
    assert.ok(environmentProblem(r));
  }
});

test("the reason is structured: a shop failure whose wording mentions the sandbox is still the shop's", () => {
  const r = base({ prove: { ok: false, verdict: "The shop said: PayPal's sandbox checkout page kept failing", environment: null } as Round["prove"] });
  assert.equal(environmentProblem(r), null);
  assert.equal(verdictOf(r), "unsafe");
});

test("runs recorded before the reason was structured still read the old wording", () => {
  const legacy = base({ prove: { ok: false, verdict: "PayPal's sandbox checkout page kept failing" } as Round["prove"] });
  assert.equal(verdictOf(legacy), "incomplete");
});

test("books that do not match PayPal's records make it unsafe, even with every robbery blocked", () => {
  assert.equal(verdictOf(base({ books: { matched: true, orders: 3, paid: 2, mismatches: [] } })), "safe");
  assert.equal(verdictOf(base({ books: { matched: true, orders: 3, paid: 2, mismatches: [{ order: "FOG-1", problem: "2 parcels for 1 completed capture(s)" }] } })), "unsafe");
  assert.equal(verdictOf(base({ books: { matched: false, orders: 3, paid: 2, mismatches: [] } })), "safe", "books that cannot be matched do not decide");
});
