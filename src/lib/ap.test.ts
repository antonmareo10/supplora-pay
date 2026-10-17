// Run with: npm test   (Node's built-in test runner with type stripping)
import assert from "node:assert/strict";
import { test } from "node:test";
import { withholdableCents } from "./ap.ts";
import type { DocumentRecord } from "./types.ts";

// withholdableCents backs both effective() and the decision route's guard: a partial payment may
// only withhold line-level overcharges, never a whole "hold this" invoice. These lock that in so a
// held duplicate/unknown-supplier/changed-details invoice can't be overridden to pay_partial and
// silently paid in full.
const doc = (invoiceCents: number, findings: { kind: string; withholdCents: number }[]): DocumentRecord =>
  ({ review: { invoiceCents, findings } }) as unknown as DocumentRecord;

test("withholdableCents: hold-only findings withhold nothing", () => {
  assert.equal(withholdableCents(doc(27471, [{ kind: "duplicate", withholdCents: 0 }])), 0);
  assert.equal(withholdableCents(doc(50000, [{ kind: "unknown_supplier", withholdCents: 0 }])), 0);
  assert.equal(withholdableCents(doc(50000, [{ kind: "payment_details_changed", withholdCents: 0 }])), 0);
});

test("withholdableCents: a line overcharge is withheld", () => {
  assert.equal(withholdableCents(doc(60000, [{ kind: "price_increase", withholdCents: 2926 }])), 2926);
  assert.equal(
    withholdableCents(doc(90000, [{ kind: "quantity_mismatch", withholdCents: 4070 }, { kind: "arithmetic", withholdCents: 312 }])),
    4382,
  );
});

test("withholdableCents: hold-only findings are ignored even when overcharges exist", () => {
  // A changed-payment-details flag (hold-kind) alongside a real price rise withholds only the rise.
  assert.equal(
    withholdableCents(doc(60000, [{ kind: "payment_details_changed", withholdCents: 0 }, { kind: "price_increase", withholdCents: 2926 }])),
    2926,
  );
});

test("withholdableCents: never exceeds the invoice total", () => {
  assert.equal(withholdableCents(doc(1000, [{ kind: "price_increase", withholdCents: 5000 }])), 1000);
});

test("withholdableCents: no review ⇒ 0", () => {
  assert.equal(withholdableCents({} as DocumentRecord), 0);
});
