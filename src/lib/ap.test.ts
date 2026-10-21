// Run with: npm test   (Node's built-in test runner with type stripping)
import assert from "node:assert/strict";
import { test } from "node:test";
import { isPaidOrSent, ledgerStats, withholdableCents } from "./ap.ts";
import type { AppState, DocumentRecord } from "./types.ts";

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

// ledgerStats must not present UNCLAIMED payouts as settled: PayPal holds that money until the
// supplier claims it, so the ledger reports it as sent and awaiting the claim.
const reviewed = (id: string, invoiceCents: number, recommendation: string, findings: { kind: string; withholdCents: number }[], payment: Record<string, unknown>) =>
  ({ id, review: { invoiceCents, recommendation, findings, discount: null }, payment }) as unknown as DocumentRecord;

test("ledgerStats: sent payouts split into claimed and awaiting claim", () => {
  const state = {
    documents: [
      reviewed("a", 56034, "pay_full", [], { status: "unclaimed", amountCents: 56034 }),
      reviewed("b", 36966, "pay_full", [], { status: "paid", amountCents: 36966 }),
      reviewed("c", 115749, "pay_full", [], { status: "unclaimed", amountCents: 113434, discountCents: 2315 }),
      reviewed("d", 69355, "pay_partial", [{ kind: "quantity_mismatch", withholdCents: 4070 }], { status: "unpaid" }),
      reviewed("e", 27471, "hold", [{ kind: "duplicate", withholdCents: 0 }], { status: "unpaid" }),
    ],
    orders: [],
  } as unknown as AppState;
  const s = ledgerStats(state, "2026-10-16");
  assert.equal(s.sentCount, 3);
  assert.equal(s.sentCents, 56034 + 36966 + 113434);
  assert.equal(s.awaitingClaimCount, 2);
  assert.equal(s.awaitingClaimCents, 56034 + 113434);
  assert.equal(s.discountsCapturedCents, 2315);
  // Withheld overcharges and held duplicates are reported as kept back, separately from discounts.
  assert.equal(s.overchargesCaughtCents, 4070);
  assert.equal(s.duplicatesBlockedCents, 27471);
  assert.equal(s.openPayableCents, 69355 - 4070);
});

test("isPaidOrSent: an unclaimed payout still blocks paying the invoice again", () => {
  for (const status of ["scheduled", "processing", "unclaimed", "paid"]) assert.equal(isPaidOrSent({ payment: { status } } as DocumentRecord), true, status);
  for (const status of ["unpaid", "failed", "returned"]) assert.equal(isPaidOrSent({ payment: { status } } as DocumentRecord), false, status);
});
