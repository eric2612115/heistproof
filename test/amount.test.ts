// The purchase's amount check: PayPal must charge the bag's goods exactly; shipping, handling or tax may come on top.
import { test } from "node:test";
import assert from "node:assert/strict";
import { amountCheck } from "../src/prove.ts";

const order = (amount: Record<string, unknown>) => ({ purchase_units: [{ amount: { currency_code: "USD", ...amount } }] });

test("the goods must cost exactly the bag total", () => {
  assert.equal(amountCheck(order({ value: "49.00" }), "49.00").ok, true);
  assert.equal(amountCheck(order({ value: "4900.00" }), "49.00").ok, false, "cents sent as dollars");
  assert.equal(amountCheck(order({ value: "0.01" }), "49.00").ok, false, "a penny");
  assert.equal(amountCheck({ purchase_units: [{ amount: { currency_code: "JPY", value: "49" } }] }, "49.00").ok, false, "another currency");
});

test("a shop that adds shipping or tax on top of the goods is not stopped", () => {
  const r = amountCheck(order({ value: "69.00", breakdown: { item_total: { currency_code: "USD", value: "64.00" }, shipping: { currency_code: "USD", value: "5.00" } } }), "64.00");
  assert.equal(r.ok, true);
  assert.deepEqual(r.extras, [{ kind: "shipping", value: "5.00" }]);
  assert.equal(amountCheck(order({ value: "70.12", breakdown: { item_total: { value: "64.00" }, shipping: { value: "5.00" }, tax_total: { value: "1.12" } } }), "64.00").ok, true);
});

test("a sale the bag already shows, named in PayPal's breakdown as a discount, is not stopped", () => {
  const r = amountCheck(order({ value: "57.60", breakdown: { item_total: { value: "64.00" }, discount: { value: "6.40" } } }), "57.60");
  assert.equal(r.ok, true);
  assert.deepEqual(r.extras, [{ kind: "discount", value: "-6.40" }]);
});

test("a breakdown that does not add up, or a discount, is stopped", () => {
  assert.equal(amountCheck(order({ value: "10.00", breakdown: { item_total: { value: "64.00" }, shipping: { value: "5.00" } } }), "64.00").ok, false, "parts that do not add up");
  assert.equal(amountCheck(order({ value: "34.00", breakdown: { item_total: { value: "64.00" }, discount: { value: "30.00" } } }), "64.00").ok, false, "a discount the bag never showed");
  assert.equal(amountCheck(order({ value: "69.00", breakdown: { item_total: { value: "69.00" } } }), "64.00").ok, false, "goods dearer than the bag");
});
