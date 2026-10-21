// Run with: npm test   (Node's built-in test runner with type stripping)
// The public demo's payout housekeeping, with PayPal and the registry mocked: no network calls.
import assert from "node:assert/strict";
import { test } from "node:test";
import { REGISTRY_MAX_AGE_MS, sweepDemoPayouts, type DemoPayoutEntry, type SweepDeps } from "./demo-sweep.ts";
import type { PayoutBatchResponse } from "./paypal.ts";

const MIN = 60_000;
const NOW = 1_800_000_000_000;

class HttpLikeError extends Error {
  status: number;
  constructor(status: number) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

function batch(id: string, status: string, items: [string, string, string][]): PayoutBatchResponse {
  return {
    batch_header: { payout_batch_id: id, batch_status: status },
    items: items.map(([itemId, txStatus, value]) => ({
      payout_item_id: itemId,
      transaction_status: txStatus,
      payout_item: { sender_item_id: itemId, receiver: "x@example.example", amount: { value, currency: "EUR" } },
    })),
  };
}

/** A fake registry + PayPal. `cancelFails` maps item id → HTTP status the cancel answers with. */
function fakes(entries: DemoPayoutEntry[], batches: Record<string, PayoutBatchResponse | number>, cancelFails: Record<string, number> = {}) {
  const registry = new Map(entries.map((e) => [e.batchId, e]));
  const calls = { get: [] as string[], cancel: [] as string[] };
  const deps: SweepDeps = {
    list: async () => [...registry.values()],
    forget: async (id) => void registry.delete(id),
    getBatch: async (e) => {
      calls.get.push(e.batchId);
      const b = batches[e.batchId];
      if (typeof b === "number") throw new HttpLikeError(b);
      return b;
    },
    cancelItem: async (itemId) => {
      calls.cancel.push(itemId);
      if (cancelFails[itemId]) throw new HttpLikeError(cancelFails[itemId]);
    },
    now: () => NOW,
  };
  return { deps, registry, calls };
}

const entry = (batchId: string, ageMs: number, key = "demo:a"): DemoPayoutEntry => ({ batchId, key, at: NOW - ageMs, cents: 100 });

test("sweep: cancels UNCLAIMED items of batches older than the threshold and forgets them", async () => {
  const { deps, registry, calls } = fakes(
    [entry("OLD1", 25 * MIN), entry("NEW1", 5 * MIN)],
    { OLD1: batch("OLD1", "SUCCESS", [["I1", "UNCLAIMED", "560.34"], ["I2", "UNCLAIMED", "1134.34"]]) },
  );
  const r = await sweepDemoPayouts(deps, { minAgeMs: 20 * MIN });
  assert.deepEqual(calls.get, ["OLD1"]); // the 5-minute-old batch is left alone
  assert.equal(r.listed, 2);
  assert.equal(r.due, 1);
  assert.deepEqual(calls.cancel, ["I1", "I2"]);
  assert.equal(r.cancelled, 2);
  assert.equal(r.cents, 56034 + 113434);
  assert.deepEqual([...registry.keys()], ["NEW1"]);
});

test("sweep: a batch whose items are still moving stays registered for the next sweep", async () => {
  const { deps, registry, calls } = fakes([entry("B1", 30 * MIN), entry("B2", 30 * MIN)], {
    B1: batch("B1", "PROCESSING", [["I1", "PENDING", "10.00"]]),
    B2: batch("B2", "SUCCESS", [["I2", "UNCLAIMED", "5.00"], ["I3", "ONHOLD", "5.00"]]),
  });
  const r = await sweepDemoPayouts(deps, { minAgeMs: 20 * MIN });
  assert.deepEqual(calls.cancel, ["I2"]);
  assert.equal(r.forgotten, 0);
  assert.deepEqual([...registry.keys()].sort(), ["B1", "B2"]);
});

test("sweep: claimed or returned items need nothing; the batch is forgotten", async () => {
  const { deps, registry, calls } = fakes([entry("B1", 30 * MIN)], {
    B1: batch("B1", "SUCCESS", [["I1", "SUCCESS", "10.00"], ["I2", "RETURNED", "5.00"], ["I3", "FAILED", "5.00"]]),
  });
  await sweepDemoPayouts(deps, { minAgeMs: 20 * MIN });
  assert.deepEqual(calls.cancel, []);
  assert.equal(registry.size, 0);
});

test("sweep: an already-cancelled item (4xx) is done; a PayPal 5xx keeps the batch for a retry", async () => {
  const { deps, registry } = fakes(
    [entry("B1", 30 * MIN), entry("B2", 30 * MIN)],
    { B1: batch("B1", "SUCCESS", [["I1", "UNCLAIMED", "1.00"]]), B2: batch("B2", "SUCCESS", [["I2", "UNCLAIMED", "1.00"]]) },
    { I1: 400, I2: 500 },
  );
  const r = await sweepDemoPayouts(deps, { minAgeMs: 20 * MIN });
  assert.equal(r.cancelled, 0);
  assert.equal(r.errors, 1);
  assert.equal(r.rejected, 1); // counted, so the housekeeping log shows it instead of passing in silence
  assert.deepEqual([...registry.keys()], ["B2"]);
});

test("sweep: a batch PayPal cannot find is forgotten; a network error keeps it", async () => {
  const { deps, registry } = fakes([entry("GONE", 30 * MIN), entry("FLAKY", 30 * MIN)], { GONE: 404, FLAKY: 0 });
  const r = await sweepDemoPayouts(deps, { minAgeMs: 20 * MIN });
  assert.equal(r.errors, 1);
  assert.deepEqual([...registry.keys()], ["FLAKY"]);
});

test("sweep: Reset demo sweeps only that session's batches, whatever their age", async () => {
  const { deps, calls } = fakes([entry("MINE", 1 * MIN, "demo:me"), entry("THEIRS", 1 * MIN, "demo:other")], {
    MINE: batch("MINE", "SUCCESS", [["I1", "UNCLAIMED", "2.00"]]),
    THEIRS: batch("THEIRS", "SUCCESS", [["I2", "UNCLAIMED", "2.00"]]),
  });
  await sweepDemoPayouts(deps, { minAgeMs: 0, only: (e) => e.key === "demo:me" });
  assert.deepEqual(calls.cancel, ["I1"]);
});

test("sweep: bounded per run (oldest first) and drops entries PayPal has long since returned", async () => {
  const entries = [entry("ANCIENT", REGISTRY_MAX_AGE_MS + MIN), ...Array.from({ length: 5 }, (_, i) => entry(`B${i}`, (60 - i) * MIN))];
  const batches = Object.fromEntries(entries.map((e) => [e.batchId, batch(e.batchId, "PROCESSING", [])]));
  const { deps, registry, calls } = fakes(entries, batches);
  await sweepDemoPayouts(deps, { minAgeMs: 20 * MIN, maxBatches: 3 });
  assert.equal(registry.has("ANCIENT"), false);
  assert.deepEqual(calls.get, ["B0", "B1"]); // ANCIENT took one of the three slots without a PayPal call
});
