// Run with: npm test   (Node's built-in test runner with type stripping)
// Two create_checkout calls in the same assistant turn run concurrently. Serialized, the second
// sees the first one's total and the spending limit holds; unserialized, both slip past it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { serializer } from "./serialize.ts";

const LIMIT = 15_000; // €150.00 incl. VAT

/** A checkout like the agent's: read the running total, create the PayPal order (await), commit. */
function makeCheckout(run: <T>(fn: () => Promise<T>) => Promise<T>) {
  let spent = 0;
  const checkout = (cents: number) =>
    run(async () => {
      if (spent + cents > LIMIT) return { ok: false as const, cents };
      await new Promise((r) => setTimeout(r, 5)); // the PayPal round trip
      spent += cents;
      return { ok: true as const, cents };
    });
  return { checkout, spent: () => spent };
}

test("restock race: concurrent checkouts are serialized, so the spending limit holds", async () => {
  const s = makeCheckout(serializer());
  const results = await Promise.all([s.checkout(10_000), s.checkout(10_000)]);
  assert.deepEqual(
    results.map((r) => r.ok),
    [true, false],
  );
  assert.equal(s.spent(), 10_000);
});

test("restock race: without serializing, both carts would pass the limit check (the bug it prevents)", async () => {
  const s = makeCheckout((fn) => fn());
  const results = await Promise.all([s.checkout(10_000), s.checkout(10_000)]);
  assert.deepEqual(
    results.map((r) => r.ok),
    [true, true],
  );
  assert.equal(s.spent(), 20_000);
});

test("restock race: a failing checkout does not block the ones after it", async () => {
  const run = serializer();
  const first = run(async () => {
    throw new Error("PayPal 500");
  });
  const second = run(async () => "ok");
  await assert.rejects(first, /PayPal 500/);
  assert.equal(await second, "ok");
});
