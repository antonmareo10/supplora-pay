// Sandbox only: the one PayPal host this app will talk to. PAYPAL_BASE_URL may only name the
// sandbox API (api-m.sandbox.paypal.com, or the older api.sandbox.paypal.com) over HTTPS; anything
// else, including the live API and lookalike hosts, is refused before a request is made.
//
// Pure, unit-tested in paypal-base.test.ts. paypal.ts turns a refusal into a PayPalError.

export const PAYPAL_SANDBOX = "https://api-m.sandbox.paypal.com";

/** The normalised base URL to use, or null when the configured value is not the PayPal sandbox. */
export function sandboxBaseUrl(configured?: string | null): string | null {
  const base = (configured?.trim() || PAYPAL_SANDBOX).replace(/\/+$/, "");
  return /^https:\/\/api(-m)?\.sandbox\.paypal\.com$/.test(base) ? base : null;
}
