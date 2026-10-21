// Run with: npm test   (Node's built-in test runner with type stripping)
// The reconciliation grid's merged cells: PayPal ids one per line, and one status column that still shows a disagreement.
import assert from "node:assert/strict";
import { test } from "node:test";
import { referenceParts, statusLines, statusView } from "./reconcile-view.ts";

test("reconcile view: a payout reference splits into its batch and item ids", () => {
  assert.deepEqual(referenceParts("payout", "EX97CDB82PMTJ · NJXD2M47S22Y"), [
    { label: "batch", id: "EX97CDB82PMTJ" },
    { label: "item", id: "NJXD2M47S22Y" },
  ]);
  // Before PayPal assigns the item id, reconcile.ts writes "item pending".
  assert.deepEqual(referenceParts("payout", "EX97CDB82PMTJ · item pending"), [
    { label: "batch", id: "EX97CDB82PMTJ" },
    { label: "item", id: "pending" },
  ]);
});

test("reconcile view: a store order reference keeps the order, authorization and capture ids apart", () => {
  assert.deepEqual(referenceParts("order", "13B935000A7653510 · auth 9FC02776GC2138743 · capture 0CG76536SM688053W"), [
    { label: "order", id: "13B935000A7653510" },
    { label: "auth", id: "9FC02776GC2138743" },
    { label: "capture", id: "0CG76536SM688053W" },
  ]);
  assert.deepEqual(referenceParts("order", "7K0802515N435435N"), [{ label: "order", id: "7K0802515N435435N" }]);
});

test("reconcile view: one status when the ledger and PayPal agree", () => {
  const v = statusView("UNCLAIMED", "UNCLAIMED");
  assert.equal(v.agree, true);
  assert.deepEqual(v.paypal, ["UNCLAIMED"]);
  const order = statusView("auth CAPTURED · capture COMPLETED", "auth CAPTURED · capture COMPLETED");
  assert.equal(order.agree, true);
  assert.deepEqual(order.paypal, ["auth CAPTURED", "capture COMPLETED"]);
});

test("reconcile view: both statuses when they differ, so a disagreement is never hidden", () => {
  const v = statusView("APPROVED", "COMPLETED · capture COMPLETED");
  assert.equal(v.agree, false);
  assert.deepEqual(v.ledger, ["APPROVED"]);
  assert.deepEqual(v.paypal, ["COMPLETED", "capture COMPLETED"]);
  // An unreachable PayPal is a disagreement too, not a match.
  assert.equal(statusView("UNCLAIMED", "unreachable").agree, false);
  assert.equal(statusView("UNCLAIMED", "not found").agree, false);
  assert.deepEqual(statusLines(""), ["—"]);
});
