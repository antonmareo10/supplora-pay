// Run with: npm test   (Node's built-in test runner with type stripping)
// Before the owner's approval authorizes anything, the PayPal order is read back through the
// PayPal Agent Toolkit (get_order) and must match the checkout exactly.
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkOrderMatches } from "./order-checks.ts";
import type { ToolkitResult } from "./paypal-facts.ts";

const ORDER = { id: "2TM3647911023980M", totalCents: 14_496 };
const got = (data: Record<string, unknown>, ok = true): ToolkitResult => ({ ok, data, text: JSON.stringify(data), durationMs: 120 });
const paypalOrder = (over: { id?: string; status?: string; value?: string; currency?: string } = {}) => ({
  id: over.id ?? ORDER.id,
  status: over.status ?? "CREATED",
  intent: "AUTHORIZE",
  purchase_units: [{ amount: { currency_code: over.currency ?? "EUR", value: over.value ?? "144.96" } }],
});

test("order check: PayPal's order matches the checkout (CREATED, EUR, same total)", () => {
  const r = checkOrderMatches(ORDER, got(paypalOrder()));
  assert.equal(r.ok, true);
  assert.match(r.reason, /CREATED on PayPal for €144\.96/);
  assert.equal(checkOrderMatches(ORDER, got(paypalOrder({ status: "APPROVED" }))).ok, true);
});

test("order check: a different amount, currency or order id on PayPal is refused", () => {
  assert.equal(checkOrderMatches(ORDER, got(paypalOrder({ value: "1449.60" }))).ok, false);
  assert.equal(checkOrderMatches(ORDER, got(paypalOrder({ value: "144.95" }))).ok, false);
  assert.equal(checkOrderMatches(ORDER, got(paypalOrder({ currency: "USD" }))).ok, false);
  assert.equal(checkOrderMatches(ORDER, got(paypalOrder({ id: "9XY00000000000000" }))).ok, false);
  assert.equal(checkOrderMatches(ORDER, got({ id: ORDER.id, status: "CREATED" })).ok, false, "no amount at all");
});

test("order check: an order already completed, voided or not readable is refused", () => {
  for (const status of ["COMPLETED", "VOIDED", "PAYER_ACTION_REQUIRED", ""]) {
    assert.equal(checkOrderMatches(ORDER, got(paypalOrder({ status }))).ok, false, status);
  }
  const failed = checkOrderMatches(ORDER, { ...got({}, false), error: "RESOURCE_NOT_FOUND" });
  assert.equal(failed.ok, false);
  assert.match(failed.reason, /get_order failed: RESOURCE_NOT_FOUND/);
});
