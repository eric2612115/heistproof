// The AI thief's plans are judged, never trusted: only known moves, only this shop's paths, small bodies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePlans, fill, MAX_PLANS } from "../src/thief.ts";
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
