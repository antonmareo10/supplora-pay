// Verified PayPal webhooks (server only). POST /api/paypal/webhook hands every delivery here.
//
//  1. Off unless PAYPAL_WEBHOOK_ID is set (the id PayPal gave the webhook when it was registered,
//     see scripts/register-webhook.mjs): the endpoint answers 503 and changes nothing.
//  2. Event types Supplora Pay does not use are acknowledged and ignored.
//  3. The signature is verified by PayPal itself (POST /v1/notifications/verify-webhook-signature)
//     with the raw body; a forged or altered event is refused (401) before anything is read from it.
//  4. Each event id is processed once (PayPal retries and may deliver twice).
//  5. The event's PayPal ids (payout batch, order, authorization, capture) find the session that
//     owns the payment; its ledger takes the new status, marked "updated by webhook", with an
//     audit entry. Unknown resources are acknowledged and ignored.
// Webhooks only ever update statuses already known to PayPal; they never move money.

import { paypalConfigured, PayPalError, verifyWebhookSignature } from "./paypal";
import { recheckAll } from "./review";
import { demoMode, runWithStateKey } from "./session";
import { auditEntry, claimWebhookEvent, releaseWebhookEvent, sessionForPayPalResources, stateExists, updateState } from "./state";
import { applyWebhookEvent, eventResourceIds, isHandledEvent, parseWebhookEvent, readWebhookHeaders } from "./webhook-events";

export const MAX_WEBHOOK_BYTES = 256_000;

export function webhookId(): string | null {
  const v = process.env.PAYPAL_WEBHOOK_ID?.trim();
  return v && /^[A-Za-z0-9]{6,50}$/.test(v) ? v : null;
}

/** A coarse per-process cap on verification calls, so a flood of junk cannot hammer PayPal's API. */
const VERIFY_PER_MINUTE = 300;
const verifyLog = ((globalThis as typeof globalThis & { __supploraVerifyLog?: number[] }).__supploraVerifyLog ??= []);
function takeVerifySlot(now = Date.now()): boolean {
  while (verifyLog.length && now - verifyLog[0] > 60_000) verifyLog.shift();
  if (verifyLog.length >= VERIFY_PER_MINUTE) return false;
  verifyLog.push(now);
  return true;
}

export interface WebhookOutcome {
  status: number;
  body: Record<string, unknown>;
}

export async function handlePayPalWebhook(raw: string, headers: { get(name: string): string | null }): Promise<WebhookOutcome> {
  const id = webhookId();
  if (!id) {
    return { status: 503, body: { error: "PayPal webhooks are not enabled on this server: set PAYPAL_WEBHOOK_ID (see docs/DEPLOY.md, “PayPal webhooks”)." } };
  }
  if (!paypalConfigured()) return { status: 503, body: { error: "PayPal is not configured on this server." } };
  if (raw.length > MAX_WEBHOOK_BYTES) return { status: 413, body: { error: "Webhook body too large." } };
  const event = parseWebhookEvent(raw);
  if (!event) return { status: 400, body: { error: "Not a PayPal webhook event." } };
  if (!isHandledEvent(event.event_type)) return { status: 200, body: { ok: true, ignored: `${event.event_type} is not used by Supplora Pay` } };
  const h = readWebhookHeaders((n) => headers.get(n));
  if ("error" in h) return { status: 400, body: { error: h.error } };
  if (!takeVerifySlot()) return { status: 429, body: { error: "Too many webhook deliveries; PayPal will retry." } };

  // Verification calls are audited in a housekeeping session in the public demo (they belong to no visitor).
  const verifyKey = demoMode() ? "demo:webhooks" : "default";
  let verified: boolean;
  const verifyStarted = Date.now();
  try {
    verified = await runWithStateKey(verifyKey, () => verifyWebhookSignature(h, id, raw, `${event.event_type} ${event.id}`));
  } catch (err) {
    // PayPal unreachable or erroring: answer 5xx so PayPal retries the delivery later.
    return { status: 502, body: { error: `Could not verify the webhook with PayPal: ${err instanceof PayPalError ? err.message : "error"}` } };
  }
  if (!verified) return { status: 401, body: { error: "Webhook signature verification failed (PayPal answered FAILURE)." } };
  const verifyMs = Date.now() - verifyStarted;

  if (!(await claimWebhookEvent(event.id))) return { status: 200, body: { ok: true, duplicate: true } };
  try {
    const key = demoMode() ? await sessionForPayPalResources(eventResourceIds(event)) : "default";
    if (!key || !(await stateExists(key))) {
      return { status: 200, body: { ok: true, ignored: "No ledger on this server holds this payment." } };
    }
    const note = await runWithStateKey(key, () =>
      updateState((s) => {
        const at = new Date().toISOString();
        const applied = applyWebhookEvent(s, event, at);
        s.audit.push(
          auditEntry({
            actor: "paypal",
            message: applied.note,
            api: {
              method: "POST",
              endpoint: "/v1/notifications/verify-webhook-signature",
              status: 200,
              ok: true,
              durationMs: verifyMs,
              resourceId: `SUCCESS · ${event.event_type} · ${event.id}`,
            },
          }),
        );
        if (applied.audit) s.audit.push(auditEntry(applied.audit));
        if (applied.settled) recheckAll(s);
        return applied.note;
      }),
    );
    return { status: 200, body: { ok: true, note } };
  } catch (err) {
    await releaseWebhookEvent(event.id);
    console.error("[webhooks] could not apply", event.event_type, event.id, err instanceof Error ? err.message : err);
    return { status: 500, body: { error: "Could not apply the event; PayPal will retry." } };
  }
}
