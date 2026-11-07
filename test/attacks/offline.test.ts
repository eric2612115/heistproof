// The ten robberies, run for real against three checkouts in a real browser, with PayPal's offline stand-in:
// no PayPal account, no keys, no network. The results must match what the sandbox recordings in runs/ show.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { checkOffline } from "../../src/offline-check.ts";

const ROOT = path.join(import.meta.dirname, "..", "..");
const results = (attacks: Array<{ id: string; verdict: string }>) => Object.fromEntries(attacks.map((a) => [a.id, a.verdict]));
const robbedIds = (attacks: Array<{ id: string; verdict: string }>) => attacks.filter((a) => a.verdict === "robbed").map((a) => a.id).sort();

test("the checkout Heistproof's agent wrote blocks all ten robberies and is safe to ship", { timeout: 240_000 }, async () => {
  const { round, verdict } = await checkOffline(path.join(ROOT, "examples", "fogline-after"));
  assert.equal(round.prove.ok, true, round.prove.verdict);
  assert.equal(round.attacks.length, 10);
  assert.deepEqual(robbedIds(round.attacks), []);
  for (const a of round.attacks) assert.equal(a.verdict, "held", `${a.id}: ${a.summary}`);
  assert.deepEqual(round.attacks.find((a) => a.id === "approved-not-captured")?.untested ?? [], [], "offline, PayPal's approved webhook always arrives, so both halves are tested");
  assert.equal(round.books?.matched, true);
  assert.deepEqual(round.books?.mismatches, [], "every paid order is backed by a completed capture, none shipped twice");
  assert.ok((round.books?.paid ?? 0) >= 2, "the purchase and the double-captured order were checked");
  assert.equal(verdict, "safe");
});

test("the hand-written afternoon checkout is robbed the same eight ways as in the sandbox", { timeout: 240_000 }, async () => {
  const { round, verdict } = await checkOffline(path.join(ROOT, "shops", "fogline-afternoon"));
  assert.deepEqual(robbedIds(round.attacks), ["approved-not-captured", "capture-unapproved", "declined-capture", "double-capture", "forged-webhook", "out-of-order", "price-tamper", "webhook-replay"]);
  const v = results(round.attacks);
  assert.equal(v["bad-bag"], "held");
  assert.equal(v["secret-leak"], "held");
  assert.ok((round.books?.mismatches.length ?? 0) > 0, "its books do not match PayPal's: orders paid without a capture, parcels without payments");
  assert.equal(verdict, "unsafe");
});

test("the naive checkout is robbed for one cent, and its own purchase asks PayPal for $4,900", { timeout: 240_000 }, async () => {
  const { round, verdict } = await checkOffline(path.join(ROOT, "shops", "fogline-naive"));
  assert.match(round.prove.verdict, /PayPal would charge \$4900 for a \$49\.00 bag/);
  const tamper = round.attacks.find((a) => a.id === "price-tamper")!;
  assert.equal(tamper.verdict, "robbed");
  assert.match(tamper.summary, /captured USD 0\.01/);
  assert.equal(verdict, "unsafe");
});
