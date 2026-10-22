// Run with: npm test   (Node's built-in test runner with type stripping)
import assert from "node:assert/strict";
import { test } from "node:test";
import { Breaker } from "./breaker.ts";

test("breaker: a failure skips the dependency for the retry window, then lets it be tried again", () => {
  const b = new Breaker(60_000);
  assert.equal(b.up(1_000), true);
  assert.equal(b.trip(1_000), true); // first failure opens it (log once)
  assert.equal(b.up(30_000), false); // still cooling down: use the fallback, don't wait on Redis
  assert.equal(b.trip(30_000), false); // a failure while open doesn't log again
  assert.equal(b.up(89_999), false); // the window restarts from the latest failure
  assert.equal(b.up(90_000), true); // tried again after a minute
});

test("breaker: reset closes it at once", () => {
  const b = new Breaker(60_000);
  b.trip(0);
  b.reset();
  assert.equal(b.up(1), true);
});
