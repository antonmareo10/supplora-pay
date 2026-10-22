// PayPal REST client (server only). Sandbox only: this MVP refuses live endpoints.
//  - OAuth2 client-credentials token cached until shortly before expiry
//  - PayPal-Request-Id idempotency keys on every write
//  - every call (method, endpoint, status, resource id, debug id) goes to the audit log;
//    request bodies, tokens and credentials never do.

import { toDecimalString } from "./money";
import { sandboxBaseUrl } from "./paypal-base";
import { currentClientIp, currentStateKey, demoMode } from "./session";
import { audit, readState, updateState } from "./state";
import type { AuditEntry, CartLine } from "./types";
import { verificationBody, type WebhookHeaders } from "./webhook-events";
import { WriteLimiter } from "./write-limits";


export class PayPalError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issue?: string,
    readonly debugId?: string,
  ) {
    super(message);
    this.name = "PayPalError";
  }
}

export function paypalConfigured(): boolean {
  return !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

function baseUrl(): string {
  const base = sandboxBaseUrl(process.env.PAYPAL_BASE_URL);
  if (!base) throw new PayPalError("Supplora Pay is a sandbox demo: PAYPAL_BASE_URL must point to api-m.sandbox.paypal.com.", 500);
  return base;
}

type TokenCache = { token?: string; expiresAt?: number; pending?: Promise<string> };
const g = globalThis as typeof globalThis & { __supploraPaypalToken?: TokenCache };
const tokenCache: TokenCache = (g.__supploraPaypalToken ??= {});

async function accessToken(force = false): Promise<string> {
  if (!force && tokenCache.token && tokenCache.expiresAt && Date.now() < tokenCache.expiresAt) return tokenCache.token;
  if (tokenCache.pending) return tokenCache.pending;
  if (!paypalConfigured()) throw new PayPalError("PayPal is not configured: set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.", 500);
  tokenCache.pending = (async () => {
    const started = Date.now();
    const basic = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
    const res = await fetch(`${baseUrl()}/v1/oauth2/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
    await audit({
      actor: "paypal",
      message: res.ok ? `OAuth token issued (cached for ${Math.round((json.expires_in ?? 0) / 3600)} h)` : "OAuth token request failed",
      api: {
        method: "POST",
        endpoint: "/v1/oauth2/token",
        status: res.status,
        ok: res.ok,
        durationMs: Date.now() - started,
        debugId: res.headers.get("paypal-debug-id") ?? undefined,
        error: res.ok ? undefined : json.error_description,
      },
    });
    if (!res.ok || !json.access_token) {
      throw new PayPalError(`PayPal authentication failed (${res.status}). Check the sandbox client id and secret.`, res.status);
    }
    tokenCache.token = json.access_token;
    // Refresh five minutes early.
    tokenCache.expiresAt = Date.now() + Math.max(60, (json.expires_in ?? 300) - 300) * 1000;
    return json.access_token;
  })().finally(() => {
    tokenCache.pending = undefined;
  });
  return tokenCache.pending;
}

/** OAuth token for the official PayPal Agent Toolkit (sandbox only, same cache as the REST client). */
export function sandboxAccessToken(): Promise<string> {
  baseUrl();
  return accessToken();
}

// Public demo (DEMO_MODE): cap PayPal writes per visitor session, per client IP and in total, so an
// open URL cannot be used to hammer the sandbox app (see write-limits.ts).
const writeLimiter = ((globalThis as typeof globalThis & { __supploraWriteLimiter?: WriteLimiter }).__supploraWriteLimiter ??= new WriteLimiter());

async function demoWriteGuard(): Promise<void> {
  if (!demoMode()) return;
  const [key, ip] = await Promise.all([currentStateKey(), currentClientIp()]);
  const decision = writeLimiter.take(key, ip);
  if (!decision.ok) {
    const who = decision.scope === "session" ? "for this session" : decision.scope === "ip" ? "for your network" : "for everyone";
    throw new PayPalError(`The public demo's PayPal sandbox limit ${who} is reached for this hour. Try again later, or run the app with your own sandbox app.`, 429);
  }
}

interface PayPalErrorBody {
  name?: string;
  message?: string;
  debug_id?: string;
  details?: { issue?: string; description?: string; field?: string }[];
}

async function request<T>(opts: {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  requestId?: string;
  label: string;
  ref?: AuditEntry["ref"];
  amountCents?: number;
  resourceId?: (json: T) => string | undefined;
  /** Demo housekeeping calls are not counted against the visitor's write limit. */
  housekeeping?: boolean;
  /** A body that must reach PayPal byte for byte (webhook verification embeds the raw event). */
  rawBody?: string;
}): Promise<T> {
  const doFetch = async (token: string) =>
    fetch(`${baseUrl()}${opts.path}`, {
      method: opts.method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        Prefer: "return=representation",
        ...(opts.requestId ? { "PayPal-Request-Id": opts.requestId } : {}),
      },
      body: opts.rawBody ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
      signal: AbortSignal.timeout(30_000),
    });

  if (opts.method === "POST" && !opts.housekeeping) await demoWriteGuard();
  const started = Date.now();
  let res: Response;
  try {
    res = await doFetch(await accessToken());
    if (res.status === 401) res = await doFetch(await accessToken(true));
  } catch (err) {
    const message = err instanceof PayPalError ? err.message : `Could not reach PayPal (${err instanceof Error ? err.message : "network error"})`;
    await audit({
      actor: "paypal",
      message: `${opts.label} — failed`,
      api: { method: opts.method, endpoint: opts.path, status: 0, ok: false, durationMs: Date.now() - started, requestId: opts.requestId, error: message },
      ref: opts.ref,
    });
    throw err instanceof PayPalError ? err : new PayPalError(message, 0);
  }
  const text = await res.text();
  let json: T & PayPalErrorBody;
  try {
    json = (text ? JSON.parse(text) : {}) as T & PayPalErrorBody;
  } catch {
    json = { message: `Unexpected non-JSON response (HTTP ${res.status})` } as T & PayPalErrorBody;
  }
  const debugId = res.headers.get("paypal-debug-id") ?? json.debug_id ?? undefined;
  const issue = json.details?.[0]?.issue ?? json.name;
  const errorText = res.ok
    ? undefined
    : [json.name, json.details?.[0]?.description ?? json.message].filter(Boolean).join(": ") || `HTTP ${res.status}`;
  await audit({
    actor: "paypal",
    message: res.ok ? opts.label : `${opts.label} — rejected`,
    api: {
      method: opts.method,
      endpoint: opts.path,
      status: res.status,
      ok: res.ok,
      durationMs: Date.now() - started,
      resourceId: res.ok ? opts.resourceId?.(json) : undefined,
      requestId: opts.requestId,
      debugId,
      error: errorText,
    },
    ref: opts.ref,
    amountCents: opts.amountCents,
  });
  if (!res.ok) throw new PayPalError(errorText ?? "PayPal request failed", res.status, issue, debugId);
  return json;
}

// ---------------------------------------------------------------------------
// Payouts

export interface PayoutItemInput {
  receiver: string;
  amountCents: number;
  note: string;
  senderItemId: string;
}

export interface PayoutBatchResponse {
  batch_header: {
    payout_batch_id: string;
    batch_status: string;
    time_completed?: string;
    amount?: { value: string; currency: string };
    fees?: { value: string; currency: string };
  };
  items?: {
    payout_item_id: string;
    transaction_id?: string;
    transaction_status: string;
    payout_item: { sender_item_id: string; receiver: string; amount: { value: string; currency: string } };
    payout_item_fee?: { value: string; currency: string };
    errors?: { name?: string; message?: string };
  }[];
}

export async function createPayoutBatch(input: {
  senderBatchId: string;
  items: PayoutItemInput[];
  subject: string;
  message: string;
  ref: AuditEntry["ref"];
}): Promise<PayoutBatchResponse> {
  const total = input.items.reduce((s, i) => s + i.amountCents, 0);
  return request<PayoutBatchResponse>({
    method: "POST",
    path: "/v1/payments/payouts",
    requestId: input.senderBatchId,
    label: `Payout batch created: ${input.items.length} supplier payment${input.items.length === 1 ? "" : "s"}`,
    ref: input.ref,
    amountCents: total,
    resourceId: (j) => j.batch_header?.payout_batch_id,
    body: {
      sender_batch_header: {
        sender_batch_id: input.senderBatchId,
        email_subject: input.subject,
        email_message: input.message,
      },
      items: input.items.map((i) => ({
        recipient_type: "EMAIL",
        receiver: i.receiver,
        amount: { value: toDecimalString(i.amountCents), currency: "EUR" },
        note: i.note.slice(0, 4000),
        sender_item_id: i.senderItemId,
      })),
    },
  });
}

/**
 * Cancel an UNCLAIMED payout item: PayPal returns the funds to the sender at once (instead of
 * after 30 days). Used only by the public demo's housekeeping, never by an agent. `attempt` (one
 * per sweep) makes the call idempotent within a sweep while a later sweep can try again.
 */
export async function cancelUnclaimedPayoutItem(itemId: string, amountCents: number, attempt: string): Promise<{ transaction_status?: string }> {
  if (!/^[A-Z0-9]{6,40}$/.test(itemId)) throw new PayPalError("Invalid payout item id", 400);
  return request<{ transaction_status?: string }>({
    method: "POST",
    path: `/v1/payments/payouts-item/${itemId}/cancel`,
    requestId: `cancel-${itemId}-${attempt}`,
    label: "Demo housekeeping: unclaimed sandbox payout returned to the demo account",
    amountCents,
    housekeeping: true,
    resourceId: (j) => `${itemId} · ${j.transaction_status ?? ""}`,
  });
}

export async function getPayoutBatch(batchId: string, ref: AuditEntry["ref"]): Promise<PayoutBatchResponse> {
  if (!/^[A-Z0-9]{6,40}$/.test(batchId)) throw new PayPalError("Invalid payout batch id", 400);
  return request<PayoutBatchResponse>({
    method: "GET",
    path: `/v1/payments/payouts/${batchId}`,
    label: "Payout batch status checked",
    ref,
    resourceId: (j) => `${j.batch_header?.payout_batch_id} · ${j.batch_header?.batch_status}`,
  });
}

// ---------------------------------------------------------------------------
// Card on file (PayPal Vault): the restaurant's company card is stored by PayPal,
// the app only keeps the vault token. In the sandbox we vault a public test card.

const SANDBOX_TEST_CARD = {
  number: "4012000077777777",
  expiry: "2029-12",
  security_code: "123",
};

export async function ensureCardOnFile(): Promise<{ vaultId: string; label: string }> {
  const existing = (await readState()).cardOnFile;
  if (existing) return { vaultId: existing.vaultId, label: `${existing.brand} •••• ${existing.last4}` };
  const card = {
    ...SANDBOX_TEST_CARD,
    name: "El Faro Hosteleria SL",
    billing_address: { address_line_1: "Calle Pozos Dulces 14", admin_area_2: "Malaga", postal_code: "29008", country_code: "ES" },
  };
  const key = crypto.randomUUID();
  const setup = await request<{ id: string; status: string }>({
    method: "POST",
    path: "/v3/vault/setup-tokens",
    requestId: `setup-${key}`,
    label: "Card on file: vault setup token created",
    resourceId: (j) => `${j.id} · ${j.status}`,
    body: { payment_source: { card } },
  });
  const token = await request<{ id: string; payment_source?: { card?: { brand?: string; last_digits?: string } } }>({
    method: "POST",
    path: "/v3/vault/payment-tokens",
    requestId: `ptoken-${key}`,
    label: "Card on file: vault payment token created",
    resourceId: (j) => j.id,
    body: { payment_source: { token: { id: setup.id, type: "SETUP_TOKEN" } } },
  });
  const brand = token.payment_source?.card?.brand ?? "VISA";
  const last4 = token.payment_source?.card?.last_digits ?? SANDBOX_TEST_CARD.number.slice(-4);
  await updateState((s) => {
    s.cardOnFile = { vaultId: token.id, brand, last4, createdAt: new Date().toISOString() };
  });
  return { vaultId: token.id, label: `${brand} •••• ${last4}` };
}

// ---------------------------------------------------------------------------
// Orders v2

export interface OrderResponse {
  id: string;
  status: string;
  purchase_units?: {
    payments?: {
      captures?: { id: string; status: string; amount?: { value: string } }[];
      authorizations?: AuthorizationResponse[];
    };
  }[];
}

export interface AuthorizationResponse {
  id: string;
  status: string;
  amount?: { value: string; currency_code?: string };
  expiration_time?: string;
}

export interface CaptureResponse {
  id: string;
  status: string;
  amount?: { value: string; currency_code?: string };
  final_capture?: boolean;
}

export function cartTotals(lines: CartLine[]) {
  const netCents = lines.reduce((s, l) => s + l.netCents, 0);
  const vatCents = lines.reduce((s, l) => s + l.vatCents, 0);
  return { netCents, vatCents, totalCents: netCents + vatCents };
}

export async function createOrder(input: {
  localId: string;
  storeName: string;
  lines: CartLine[];
  ref: AuditEntry["ref"];
  source: "agent" | "owner";
  /** AUTHORIZE: hold now, capture what the delivery note confirms. CAPTURE: take the money at approval. */
  intent: "CAPTURE" | "AUTHORIZE";
}): Promise<OrderResponse> {
  const t = cartTotals(input.lines);
  const eur = (cents: number) => ({ currency_code: "EUR", value: toDecimalString(cents) });
  return request<OrderResponse>({
    method: "POST",
    path: "/v2/checkout/orders",
    requestId: `order-${input.localId}`,
    label: `${input.source === "agent" ? "Agent" : "Owner"} checkout created at ${input.storeName}${input.intent === "AUTHORIZE" ? " (intent AUTHORIZE: pay for what arrives)" : ""}`,
    ref: input.ref,
    amountCents: t.totalCents,
    resourceId: (j) => `${j.id} · ${j.status}`,
    body: {
      intent: input.intent,
      purchase_units: [
        {
          reference_id: input.localId,
          description: `Restock order for Taberna El Faro from ${input.storeName}`.slice(0, 127),
          custom_id: input.localId,
          invoice_id: input.localId,
          amount: { ...eur(t.totalCents), breakdown: { item_total: eur(t.netCents), tax_total: eur(t.vatCents) } },
          items: input.lines.map((l) => ({
            name: l.name.slice(0, 127),
            sku: l.sku,
            quantity: String(l.qty),
            unit_amount: eur(l.unitPriceCents),
            tax: eur(l.unitVatCents),
            category: "PHYSICAL_GOODS",
          })),
        },
      ],
    },
  });
}

/** `attempt` makes each owner approval a new idempotent request (a retry after a decline must not replay it). */
export async function confirmWithCardOnFile(orderId: string, vaultId: string, ref: AuditEntry["ref"], attempt: string): Promise<OrderResponse> {
  return request<OrderResponse>({
    method: "POST",
    path: `/v2/checkout/orders/${encodeURIComponent(orderId)}/confirm-payment-source`,
    requestId: `confirm-${orderId}-${attempt}`,
    label: "Order approved with the card on file (vault token)",
    ref,
    resourceId: (j) => `${j.id} · ${j.status}`,
    body: { payment_source: { card: { vault_id: vaultId } } },
  });
}

export async function captureOrder(orderId: string, ref: AuditEntry["ref"], attempt: string, amountCents?: number): Promise<OrderResponse> {
  return request<OrderResponse>({
    method: "POST",
    path: `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
    requestId: `capture-${orderId}-${attempt}`,
    label: "Order captured",
    ref,
    amountCents,
    resourceId: (j) => {
      const c = j.purchase_units?.[0]?.payments?.captures?.[0];
      return c ? `${j.id} · capture ${c.id} ${c.status}` : `${j.id} · ${j.status}`;
    },
    body: {},
  });
}

export function firstCapture(order: OrderResponse) {
  return order.purchase_units?.[0]?.payments?.captures?.[0];
}

export function firstAuthorization(order: OrderResponse) {
  return order.purchase_units?.[0]?.payments?.authorizations?.[0];
}

// ---------------------------------------------------------------------------
// Authorize now, capture what arrives (Orders v2 + Payments v2)

/** Places the hold on the card for an approved AUTHORIZE-intent order. Owner approval only. */
export async function authorizeOrder(orderId: string, ref: AuditEntry["ref"], attempt: string, amountCents: number): Promise<OrderResponse> {
  return request<OrderResponse>({
    method: "POST",
    path: `/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`,
    requestId: `authorize-${orderId}-${attempt}`,
    label: "Order authorized on the card on file (nothing captured until the delivery note)",
    ref,
    amountCents,
    resourceId: (j) => {
      const a = firstAuthorization(j);
      return a ? `${j.id} · authorization ${a.id} ${a.status}` : `${j.id} · ${j.status}`;
    },
    body: {},
  });
}

const AUTH_ID = /^[A-Z0-9]{10,30}$/;

/**
 * Captures what the delivery note confirmed and closes the authorization (final_capture: PayPal
 * releases the rest). The request id is derived from the authorization, so a retry or a double
 * click can never capture twice; PayPal also refuses a second capture once the final one exists.
 */
export async function captureAuthorization(input: { authorizationId: string; amountCents: number; invoiceId: string; note: string; ref: AuditEntry["ref"] }): Promise<CaptureResponse> {
  if (!AUTH_ID.test(input.authorizationId)) throw new PayPalError("Invalid authorization id", 400);
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new PayPalError("Capture amount must be positive", 400);
  return request<CaptureResponse>({
    method: "POST",
    path: `/v2/payments/authorizations/${input.authorizationId}/capture`,
    requestId: `settle-${input.authorizationId}`,
    label: "Captured what the delivery note confirmed (final capture: the rest of the authorization is released)",
    ref: input.ref,
    amountCents: input.amountCents,
    resourceId: (j) => `${input.authorizationId} → capture ${j.id} ${j.status}`,
    body: {
      amount: { currency_code: "EUR", value: toDecimalString(input.amountCents) },
      final_capture: true,
      invoice_id: input.invoiceId.slice(0, 127),
      note_to_payer: input.note.slice(0, 255),
    },
  });
}

/** Nothing arrived: release the whole hold. */
export async function voidAuthorization(authorizationId: string, ref: AuditEntry["ref"], amountCents: number): Promise<AuthorizationResponse> {
  if (!AUTH_ID.test(authorizationId)) throw new PayPalError("Invalid authorization id", 400);
  const res = await request<Partial<AuthorizationResponse>>({
    method: "POST",
    path: `/v2/payments/authorizations/${authorizationId}/void`,
    requestId: `void-${authorizationId}`,
    label: "Authorization voided: nothing arrived, the whole hold is released",
    ref,
    amountCents,
    resourceId: (j) => `${authorizationId} · ${j.status ?? "VOIDED"}`,
  });
  // PayPal answers 204 (empty) or the authorization (Prefer: return=representation).
  return { id: res.id ?? authorizationId, status: res.status ?? "VOIDED", amount: res.amount, expiration_time: res.expiration_time };
}

export async function getAuthorization(authorizationId: string, ref: AuditEntry["ref"]): Promise<AuthorizationResponse> {
  if (!AUTH_ID.test(authorizationId)) throw new PayPalError("Invalid authorization id", 400);
  return request<AuthorizationResponse>({
    method: "GET",
    path: `/v2/payments/authorizations/${authorizationId}`,
    label: "Authorization status checked",
    ref,
    resourceId: (j) => `${j.id} · ${j.status}`,
  });
}

// ---------------------------------------------------------------------------
// Webhooks: PayPal verifies its own signature (postback). The raw event is embedded byte for byte
// (see verificationBody), because re-serialising the parsed JSON can change it.

export async function verifyWebhookSignature(h: WebhookHeaders, webhookId: string, rawEvent: string, eventLabel: string): Promise<boolean> {
  const res = await request<{ verification_status?: string }>({
    method: "POST",
    path: "/v1/notifications/verify-webhook-signature",
    label: `Webhook signature check: ${eventLabel}`,
    housekeeping: true,
    rawBody: verificationBody(h, webhookId, rawEvent),
    resourceId: (j) => j.verification_status,
  });
  return res.verification_status === "SUCCESS";
}
