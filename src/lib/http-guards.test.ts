// Run with: npm test   (Node's built-in test runner with type stripping)
// Request guards on every write route: cross-site requests, oversized or malformed bodies, amounts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { assertSameOrigin, eurosToCents, HttpError, readJson } from "./http-guards.ts";

const post = (headers: Record<string, string>, body = "{}") =>
  new Request("https://supplora-pay.vercel.app/api/plans/p1/approve", { method: "POST", headers, body });
const status = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return err instanceof HttpError ? err.status : -1;
  }
  return 0;
};

test("same origin: a page on another site cannot drive a payment (403)", () => {
  assert.equal(status(() => assertSameOrigin(post({ origin: "https://evil.example", host: "supplora-pay.vercel.app" }))), 403);
  // A lookalike host that merely starts with ours is still another origin.
  assert.equal(status(() => assertSameOrigin(post({ origin: "https://supplora-pay.vercel.app.evil.example", host: "supplora-pay.vercel.app" }))), 403);
  assert.equal(status(() => assertSameOrigin(post({ origin: "not a url", host: "supplora-pay.vercel.app" }))), 403);
});

test("same origin: the app's own pages and origin-less clients (curl, old browsers) pass", () => {
  assert.equal(status(() => assertSameOrigin(post({ origin: "https://supplora-pay.vercel.app", host: "supplora-pay.vercel.app" }))), 0);
  assert.equal(
    status(() => assertSameOrigin(post({ origin: "https://supplora-pay.vercel.app", "x-forwarded-host": "supplora-pay.vercel.app", host: "internal:3000" }))),
    0,
  );
  assert.equal(status(() => assertSameOrigin(post({ host: "supplora-pay.vercel.app" }))), 0);
});

test("bodies: oversized (413), not JSON or not an object (400), empty is {}", async () => {
  await assert.rejects(readJson(post({}, JSON.stringify({ note: "x".repeat(40_000) }))), (e: HttpError) => e.status === 413);
  await assert.rejects(readJson(post({}, "{not json")), (e: HttpError) => e.status === 400);
  await assert.rejects(readJson(post({}, "[1,2,3]")), (e: HttpError) => e.status === 400);
  await assert.rejects(readJson(post({}, "null")), (e: HttpError) => e.status === 400);
  assert.deepEqual(await readJson(post({}, "")), {});
  assert.deepEqual(await readJson(post({}, '{"cashCapEur":2500}')), { cashCapEur: 2500 });
});

test("amounts: euros become integer cents within bounds; junk and out-of-range values are refused", () => {
  assert.equal(eurosToCents(2500, { min: 1, max: 100_000 }), 250_000);
  assert.equal(eurosToCents("149,99", { min: 1, max: 100_000 }), 14_999);
  assert.equal(eurosToCents("0.1", { min: 0, max: 10 }), 10);
  for (const bad of ["", "abc", NaN, Infinity, null, undefined, {}, "1e400"]) {
    assert.equal(status(() => eurosToCents(bad, { min: 1, max: 100_000 })), 400, `accepted ${String(bad)}`);
  }
  assert.equal(status(() => eurosToCents(0.5, { min: 1, max: 100_000 })), 400);
  assert.equal(status(() => eurosToCents(100_000.01, { min: 1, max: 100_000 })), 400);
  assert.equal(status(() => eurosToCents(-150, { min: 1, max: 100_000 })), 400);
});
