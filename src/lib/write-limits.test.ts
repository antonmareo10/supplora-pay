// Run with: npm test   (Node's built-in test runner with type stripping)
import assert from "node:assert/strict";
import { test } from "node:test";
import { UNKNOWN_IP, WriteLimiter } from "./write-limits.ts";

const limits = { perSession: 3, perIp: 5, total: 8, windowMs: 60_000 };

test("write caps: per session", () => {
  const l = new WriteLimiter(limits);
  for (let i = 0; i < 3; i++) assert.deepEqual(l.take("s1", "1.1.1.1", 1000 + i), { ok: true });
  assert.deepEqual(l.take("s1", "1.1.1.1", 1010), { ok: false, scope: "session" });
  // Another session from another address is unaffected.
  assert.deepEqual(l.take("s2", "2.2.2.2", 1011), { ok: true });
});

test("write caps: per IP across new sessions (cookies cleared)", () => {
  const l = new WriteLimiter(limits);
  let n = 0;
  for (let s = 0; s < 3; s++) {
    for (let i = 0; i < 3 && n < 5; i++, n++) assert.deepEqual(l.take(`s${s}`, "9.9.9.9", 1000 + n), { ok: true });
  }
  assert.deepEqual(l.take("fresh-session", "9.9.9.9", 2000), { ok: false, scope: "ip" });
  assert.deepEqual(l.take("other", "8.8.8.8", 2001), { ok: true });
});

test("write caps: unknown IP is only bound by the session and total caps", () => {
  const l = new WriteLimiter(limits);
  for (let s = 0; s < 3; s++) for (let i = 0; i < 2; i++) assert.equal(l.take(`s${s}`, UNKNOWN_IP, 1000 + s * 10 + i).ok, true);
});

test("write caps: total cap and the sliding window", () => {
  const l = new WriteLimiter(limits);
  for (let i = 0; i < 8; i++) assert.equal(l.take(`s${i}`, `10.0.0.${i}`, 1000 + i).ok, true);
  assert.deepEqual(l.take("late", "10.0.1.1", 1100), { ok: false, scope: "total" });
  // A refused write is not counted, and writes older than the window drop out.
  assert.deepEqual(l.take("late", "10.0.1.1", 1000 + 60_000 + 1), { ok: true });
});
