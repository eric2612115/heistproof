// The AI thief's plans are judged, never trusted: only known moves, only this shop's paths, small bodies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePlans, fill, answerable, MAX_PLANS } from "../src/thief.ts";
import { firstJson } from "../src/llm.ts";

test("only this shop's paths, known moves and allowed headers survive", () => {
  const { plans, dropped } = validatePlans({
    plans: [
      {
        name: "mixed",
        steps: [
          { do: "request", method: "POST", path: "/api/checkout/paypal", body: { lines: [] } },
          { do: "request", method: "GET", path: "https://attacker.example/steal" },
          { do: "request", method: "GET", path: "//attacker.example/x" },
          { do: "request", method: "POST", path: "/api/x", headers: { cookie: "sid=1" } },
          { do: "request", method: "POST", path: "/api/x", headers: { "x-csrf-token": "t" }, times: 2, together: true },
          { do: "shell", command: "rm -rf /" },
          { do: "wait", ms: 60_000 },
          { do: "webhook", event: "PAYMENT.CAPTURE.COMPLETED", edit: { "resource.custom_id": "KC-1" }, signed: true },
        ],
      },
      { name: "empty", steps: [] },
    ],
  });
  assert.equal(plans.length, 1);
  assert.deepEqual(plans[0].steps.map((s) => s.do), ["request", "request", "webhook"]);
  assert.ok(dropped.some((d) => /path must be on this shop/.test(d)));
  assert.ok(dropped.some((d) => /only content-type and x- headers/.test(d)));
  assert.ok(dropped.some((d) => /unknown move/.test(d)));
  assert.ok(dropped.some((d) => /wait 0 to 5000/.test(d)));
  assert.ok(dropped.some((d) => /empty: not a plan/.test(d)));
});

test("no more than the plan limit, and nothing from a non-answer", () => {
  const many = { plans: Array.from({ length: MAX_PLANS + 3 }, (_, i) => ({ name: `p${i}`, steps: [{ do: "wait", ms: 1 }] })) };
  assert.equal(validatePlans(many).plans.length, MAX_PLANS);
  assert.equal(validatePlans(null).plans.length, 0);
  assert.equal(validatePlans({ plans: "no" }).plans.length, 0);
});

test("placeholders take saved values, keeping their type when they stand alone", () => {
  const saved = { legit: { paypalOrderId: "5O190127TN364715T", bagTotal: "49.00" }, a: { status: 201, body: { ref: "KC-1", n: 2 } } };
  assert.deepEqual(fill({ ref: "{{a.body.ref}}", n: "{{a.body.n}}", path: "/api/checkout/paypal/{{legit.paypalOrderId}}/capture", missing: "{{b.x}}" }, saved), {
    ref: "KC-1",
    n: 2,
    path: "/api/checkout/paypal/5O190127TN364715T/capture",
    missing: "{{b.x}}",
  });
});

test("the plans are read out of whatever the model wraps them in", () => {
  assert.deepEqual(firstJson('Here you go:\n```json\n{"plans":[{"name":"a"}]}\n```\nGood luck.'), { plans: [{ name: "a" }] });
  assert.deepEqual(firstJson('prefix {"plans":[{"name":"b {"}]} suffix'), { plans: [{ name: "b {" }] });
  assert.equal(firstJson("no json at all"), null);
});

test("a plan answers only for orders it made or touched, not for late PayPal events on earlier orders", () => {
  const before = new Set(["FOG-OLD1", "FOG-OLD2", "FOG-OLD3"]);
  const records = new Map([
    ["FOG-OLD1", JSON.stringify({ id: "FOG-OLD1", paypal_order_id: "5O190127TN364715T" })],
    ["FOG-OLD2", JSON.stringify({ id: "FOG-OLD2", paypal_order_id: "8XK21653MD4471209" })],
    ["FOG-OLD3", JSON.stringify({ id: "FOG-OLD3", paypal_order_id: "2YM67552EP9188811" })],
    ["FOG-NEW1", JSON.stringify({ id: "FOG-NEW1", paypal_order_id: "60702657SC4247212" })],
  ]);
  const changed = [
    { order: "FOG-NEW1", problem: "shipped without a completed capture" }, // the plan's own purchase
    { order: "FOG-OLD1", problem: "marked paid without a completed capture" }, // the plan resent an event naming its PayPal order
    { order: "FOG-OLD2", problem: "marked paid without a completed capture" }, // the plan sent a request naming the shop order
    { order: "FOG-OLD3", problem: "shipped without a completed capture" }, // a late event the plan never touched
  ];
  const trail = JSON.stringify({ path: "/api/orders/FOG-OLD2/ship" }) + " " + JSON.stringify({ resource: { id: "5O190127TN364715T" } });
  assert.deepEqual(answerable(changed, before, records, trail).map((m) => m.order), ["FOG-NEW1", "FOG-OLD1", "FOG-OLD2"]);
  assert.deepEqual(answerable(changed, before, records, ""), [changed[0]], "with an empty trail only the order it made counts");
});

test("a books problem is sorted by kind, so a plan that only repeats a known problem is not a new way in", async () => {
  const { mismatchKind } = await import("../src/thief.ts");
  assert.equal(mismatchKind("3 parcels for 1 completed capture(s)"), mismatchKind("4 parcels for 1 completed capture(s)"));
  assert.equal(mismatchKind("paid by capture 1AB, which already pays for order KC-1"), "one payment paying for two orders");
  assert.equal(mismatchKind("shipped with 1 parcel(s), but PayPal holds no completed capture for it"), "paid or shipped without a completed capture");
  assert.equal(mismatchKind("PayPal captured $0.01 for an order of $49.00"), "less captured than the order costs");
  assert.notEqual(mismatchKind("3 parcels for 1 completed capture(s)"), mismatchKind("PayPal captured $0.01 for an order of $49.00"));
});

test("an edit or a tamper that reaches a prototype is refused, so a plan cannot break Heistproof itself", () => {
  const plan = (step: Record<string, unknown>) => ({ plans: [{ name: "p", idea: "i", expect: "e", steps: [step] }] });
  for (const key of ["__proto__.payments", "resource.constructor.prototype.x", "prototype"]) {
    const { plans, dropped } = validatePlans(plan({ do: "webhook", event: "PAYMENT.CAPTURE.COMPLETED", edit: { [key]: 1 } }));
    assert.equal(plans.length, 0, key);
    assert.ok(dropped.some((d) => /prototype/.test(d)), `${key}: ${dropped.join("; ")}`);
  }
  const tamper = validatePlans(plan({ do: "buy", tamper: JSON.parse('{"__proto__": {"polluted": true}}') }));
  assert.equal(tamper.plans.length, 0);
  assert.equal(({} as any).polluted, undefined, "nothing was polluted");
});
