// Run with: npm test   (Node's built-in test runner with type stripping)
// SECURITY.md names, for every threat, the tests that prove its mitigation. This test keeps the page
// honest: rename or delete one of those tests and the build fails.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const doc = readFileSync(new URL("../../SECURITY.md", import.meta.url), "utf8");
const threats = doc.split(/^## /m).slice(1).filter((s) => /^T\d+\./.test(s));
const proofs = [...doc.matchAll(/`([a-z-]+\.test\.ts)` "([^"]+)"/g)].map((m) => ({ file: m[1], title: m[2] }));

test("threat model: every threat lists at least one test that proves its mitigation", () => {
  assert.ok(threats.length >= 14, `expected at least 14 threats, found ${threats.length}`);
  for (const t of threats) {
    const name = t.split("\n")[0];
    assert.match(t, /`[a-z-]+\.test\.ts` "/, `${name} has no proof`);
  }
});

test("threat model: every test named in SECURITY.md exists, word for word", () => {
  assert.ok(proofs.length >= 40, `expected at least 40 proofs, found ${proofs.length}`);
  const missing = proofs.filter((p) => {
    const source = readFileSync(new URL(`./${p.file}`, import.meta.url), "utf8");
    return !source.includes(`test("${p.title}"`);
  });
  assert.deepEqual(missing, []);
});
