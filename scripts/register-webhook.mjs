// Registers Supplora Pay's webhook endpoint with PayPal (sandbox) and prints the webhook id, which
// the server needs as PAYPAL_WEBHOOK_ID to verify every event's signature.
//
//   node scripts/register-webhook.mjs https://your-app.example/api/paypal/webhook
//   node scripts/register-webhook.mjs --delete <webhook id>      (remove it again)
//
// Reads PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET and PAYPAL_BASE_URL (default: the sandbox) from the
// environment. If a webhook for the same URL already exists it is reused (and its event types
// updated). Prints only the webhook id on stdout; never prints credentials or tokens.

const EVENT_TYPES = [
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
  "PAYMENT.PAYOUTS-ITEM.UNCLAIMED",
  "PAYMENT.PAYOUTS-ITEM.RETURNED",
  "PAYMENT.PAYOUTS-ITEM.FAILED",
  "PAYMENT.PAYOUTS-ITEM.BLOCKED",
  "PAYMENT.PAYOUTS-ITEM.CANCELED",
  "PAYMENT.PAYOUTS-ITEM.DENIED",
  "PAYMENT.PAYOUTS-ITEM.HELD",
  "PAYMENT.PAYOUTS-ITEM.REFUNDED",
  "PAYMENT.AUTHORIZATION.CREATED",
  "PAYMENT.AUTHORIZATION.VOIDED",
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.PENDING",
  "PAYMENT.CAPTURE.DENIED",
  "PAYMENT.CAPTURE.DECLINED",
  "PAYMENT.CAPTURE.REFUNDED",
  "PAYMENT.CAPTURE.REVERSED",
];

function fail(message) {
  console.error(`register-webhook: ${message}`);
  process.exit(1);
}

const base = (process.env.PAYPAL_BASE_URL || "https://api-m.sandbox.paypal.com").replace(/\/+$/, "");
if (!/^https:\/\/api(-m)?\.sandbox\.paypal\.com$/.test(base)) fail("PAYPAL_BASE_URL must be the PayPal sandbox (Supplora Pay is a sandbox demo).");
if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) fail("set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in the environment.");

const args = process.argv.slice(2);
const deleting = args[0] === "--delete";
const target = deleting ? args[1] : args[0];
if (!target) fail("usage: node scripts/register-webhook.mjs <https URL of /api/paypal/webhook> | --delete <webhook id>");
if (deleting && !/^[A-Za-z0-9]{6,50}$/.test(target)) fail("that does not look like a webhook id.");
if (!deleting) {
  let url;
  try {
    url = new URL(target);
  } catch {
    fail("the webhook URL is not a valid URL.");
  }
  if (url.protocol !== "https:") fail("PayPal only delivers webhooks to https URLs.");
  if (!url.pathname.endsWith("/api/paypal/webhook")) console.error("register-webhook: note: Supplora Pay's endpoint is /api/paypal/webhook.");
}

async function token() {
  const basic = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) fail(`PayPal authentication failed (HTTP ${res.status}). Check the sandbox client id and secret.`);
  return json.access_token;
}

async function call(bearer, method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json", Accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const detail = json.details?.[0]?.description ?? json.message ?? "";
    fail(`${method} ${path} → HTTP ${res.status} ${json.name ?? ""} ${detail} (debug id ${res.headers.get("paypal-debug-id") ?? json.debug_id ?? "n/a"})`.trim());
  }
  return json;
}

const bearer = await token();
if (deleting) {
  await call(bearer, "DELETE", `/v1/notifications/webhooks/${target}`);
  console.error("register-webhook: deleted.");
  console.log(target);
  process.exit(0);
}

const existing = (await call(bearer, "GET", "/v1/notifications/webhooks")).webhooks ?? [];
const same = existing.find((w) => w.url === target);
if (same) {
  const have = new Set((same.event_types ?? []).map((e) => e.name));
  if (!EVENT_TYPES.every((e) => have.has(e))) {
    await call(bearer, "PATCH", `/v1/notifications/webhooks/${same.id}`, [
      { op: "replace", path: "/event_types", value: EVENT_TYPES.map((name) => ({ name })) },
    ]);
    console.error("register-webhook: a webhook for this URL already existed; its event types were updated.");
  } else {
    console.error("register-webhook: a webhook for this URL already exists; reusing it.");
  }
  console.log(same.id);
} else {
  const created = await call(bearer, "POST", "/v1/notifications/webhooks", { url: target, event_types: EVENT_TYPES.map((name) => ({ name })) });
  console.error(`register-webhook: created (${EVENT_TYPES.length} event types). Set PAYPAL_WEBHOOK_ID to the id below on the server.`);
  console.log(created.id);
}
