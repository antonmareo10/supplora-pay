// Run with: npm test   (Node's built-in test runner with type stripping)
// The app only ever talks to the PayPal sandbox: live and lookalike hosts are refused.
import assert from "node:assert/strict";
import { test } from "node:test";
import { PAYPAL_SANDBOX, sandboxBaseUrl } from "./paypal-base.ts";

test("sandbox only: the default and the two sandbox hosts are accepted", () => {
  assert.equal(sandboxBaseUrl(undefined), PAYPAL_SANDBOX);
  assert.equal(sandboxBaseUrl(""), PAYPAL_SANDBOX);
  assert.equal(sandboxBaseUrl("https://api-m.sandbox.paypal.com/"), "https://api-m.sandbox.paypal.com");
  assert.equal(sandboxBaseUrl("https://api.sandbox.paypal.com"), "https://api.sandbox.paypal.com");
});

test("sandbox only: the live API, plain http and lookalike hosts are refused", () => {
  for (const bad of [
    "https://api-m.paypal.com",
    "https://api.paypal.com",
    "http://api-m.sandbox.paypal.com",
    "https://api-m.sandbox.paypal.com.evil.example",
    "https://evil.example/api-m.sandbox.paypal.com",
    "https://api-m.sandbox.paypal.com@evil.example",
    "https://api-m.sandbox.paypal.com/v1",
  ]) {
    assert.equal(sandboxBaseUrl(bad), null, `accepted ${bad}`);
  }
});
