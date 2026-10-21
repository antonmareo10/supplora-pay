// PayPal status updates applied to the ledger: shared by the payout status poll, the verified
// webhook endpoint (/api/paypal/webhook) and the ledger reconciliation, so all three change the
// ledger the same way and record which of them did it (StatusUpdate.source).
//
// Also the pieces of webhook handling that need no network: reading PayPal's transmission headers,
// building the verify-webhook-signature body, and finding which payment an event is about.
// Signature verification itself is a PayPal API call (paypal.ts) made before anything here runs.
//
// Pure (no Node or Next APIs) so it can be unit-tested with Node's test runner.

import { fmt, fromDecimalString } from "./money.ts";
import type { AppState, AuditEntry, PaymentStatus, PayoutBatchRecord, PlannedPayment, StatusUpdate, StoreOrder } from "./types.ts";

// ---------------------------------------------------------------------------
// Payout items

const PAID_ITEM = ["SUCCESS"];
const SENT_ITEM = ["UNCLAIMED"];
const FAILED_ITEM = ["FAILED", "RETURNED", "BLOCKED", "REFUNDED", "REVERSED", "DENIED", "CANCELED"];

export function itemToStatus(s: string): { doc: PaymentStatus; plan: PlannedPayment["status"] } {
  if (PAID_ITEM.includes(s)) return { doc: "paid", plan: "paid" };
  if (SENT_ITEM.includes(s)) return { doc: "unclaimed", plan: "unclaimed" };
  if (FAILED_ITEM.includes(s)) return { doc: "failed", plan: "failed" };
  return { doc: "processing", plan: "processing" };
}

const ITEM_FAILURE_TEXT: Record<string, string> = {
  RETURNED: "PayPal returned the payout: the supplier did not claim it within 30 days",
  CANCELED: "the unclaimed payout was cancelled and the money returned to the restaurant's PayPal balance",
};

export interface PayoutItemUpdate {
  payout_item_id: string;
  transaction_id?: string;
  transaction_status: string;
  sender_item_id?: string;
  errors?: { name?: string; message?: string };
}

export interface Applied {
  changed: boolean;
  /** A payout reached a final state: the caller re-runs the cross-document checks. */
  settled: boolean;
  audit?: Omit<AuditEntry, "id" | "at">;
}

/** Applies one payout item's PayPal status to the batch, its invoice and its plan line. */
export function applyPayoutItem(s: AppState, batch: PayoutBatchRecord, it: PayoutItemUpdate, by: StatusUpdate): Applied {
  const item = batch.items.find((i) => (it.sender_item_id && i.senderItemId === it.sender_item_id) || (i.payoutItemId && i.payoutItemId === it.payout_item_id));
  if (!item) return { changed: false, settled: false };
  const before = item.transactionStatus;
  item.payoutItemId = it.payout_item_id;
  item.transactionId = it.transaction_id ?? item.transactionId;
  item.transactionStatus = it.transaction_status;
  item.errorName = it.errors?.name;
  if (before === it.transaction_status) return { changed: false, settled: false };
  item.updatedBy = by;
  const plan = s.plans.find((p) => p.id === batch.planId);
  const mapped = itemToStatus(it.transaction_status);
  const failure = ITEM_FAILURE_TEXT[it.transaction_status] ?? it.errors?.message ?? it.transaction_status;
  const doc = s.documents.find((d) => d.id === item.docId);
  if (doc) {
    doc.payment = {
      ...doc.payment,
      status: mapped.doc,
      payoutItemId: it.payout_item_id,
      transactionId: it.transaction_id ?? doc.payment.transactionId,
      at: by.at,
      error: mapped.doc === "failed" ? failure : undefined,
      updatedBy: by,
    };
    // A failed, returned or cancelled payout leaves the invoice unpaid, so it can be paid again.
    if (mapped.doc === "failed") doc.payment = { status: "failed", error: failure, updatedBy: by };
  }
  const p = plan?.payments.find((x) => x.docId === item.docId);
  if (p) {
    p.status = mapped.plan;
    p.payoutItemId = it.payout_item_id;
    if (mapped.plan === "failed") p.error = failure;
  }
  // A late failure reopens the plan so the owner can retry that invoice.
  if (plan) plan.status = plan.payments.some((x) => x.status === "proposed" || x.status === "failed") ? "partially_paid" : "completed";
  if (mapped.doc === "processing") return { changed: true, settled: false };
  const supplier = p?.supplierName ?? item.receiver;
  const detail =
    it.transaction_status === "UNCLAIMED"
      ? " — sent; the receiver has no PayPal account yet, so PayPal holds the funds until they claim them (returned after 30 days)"
      : it.transaction_status === "SUCCESS"
        ? " — delivered to the supplier's PayPal account"
        : ` — ${failure}`;
  return {
    changed: true,
    settled: true,
    audit: {
      actor: "system",
      message: `Payout to ${supplier} ${fmt(item.amountCents)}: ${it.transaction_status}${detail}${SOURCE_SUFFIX[by.source]}.`,
      ref: { batchId: batch.id, docId: item.docId, planId: batch.planId },
      amountCents: item.amountCents,
    },
  };
}

const SOURCE_SUFFIX: Record<StatusUpdate["source"], string> = {
  app: "",
  poll: "",
  webhook: " (reported by a verified PayPal webhook)",
  reconcile: " (found by reconciliation with PayPal)",
};

// ---------------------------------------------------------------------------
// Authorizations and captures (purchasing-agent orders)

function cents(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  try {
    return fromDecimalString(value);
  } catch {
    return undefined;
  }
}

/** PayPal reports a new authorization status (webhook or reconciliation). */
export function applyAuthorizationStatus(o: StoreOrder, auth: { id: string; status: string; amountCents?: number }, by: StatusUpdate): boolean {
  if (!o.authorization) {
    if (auth.amountCents == null) return false;
    o.authorization = { id: auth.id, status: auth.status, amountCents: auth.amountCents, createdAt: by.at };
  } else if (o.authorization.id !== auth.id || o.authorization.status === auth.status) {
    return false;
  } else {
    o.authorization.status = auth.status;
  }
  if (auth.status === "VOIDED" && !o.captureId) {
    o.capturedCents = 0;
    o.releasedCents = o.authorization.amountCents;
  }
  o.updatedBy = by;
  return true;
}

/** PayPal reports a capture (webhook or reconciliation). */
export function applyCaptureStatus(o: StoreOrder, cap: { id: string; status: string; amountCents?: number; finalCapture?: boolean }, by: StatusUpdate): boolean {
  if (o.captureId && o.captureId !== cap.id) return false;
  const changed = o.captureId !== cap.id || o.captureStatus !== cap.status || (cap.amountCents != null && o.capturedCents == null);
  if (!changed) return false;
  o.captureId = cap.id;
  o.captureStatus = cap.status;
  if (o.intent === "AUTHORIZE") {
    if (o.capturedCents == null && cap.amountCents != null) o.capturedCents = cap.amountCents;
    if (o.authorization && cap.finalCapture && ["COMPLETED", "PENDING"].includes(cap.status)) {
      o.authorization.status = "CAPTURED";
      o.releasedCents = o.authorization.amountCents - (o.capturedCents ?? 0);
    }
  }
  o.updatedBy = by;
  return true;
}

/** A refund on a captured order (PAYMENT.CAPTURE.REFUNDED carries the refund, linked "up" to its capture). */
export function applyRefund(o: StoreOrder, refundCents: number, by: StatusUpdate): boolean {
  const captured = o.intent === "AUTHORIZE" ? (o.capturedCents ?? 0) : o.totalCents;
  o.refundedCents = Math.min(captured, (o.refundedCents ?? 0) + refundCents);
  o.captureStatus = o.refundedCents >= captured ? "REFUNDED" : "PARTIALLY_REFUNDED";
  o.updatedBy = by;
  return true;
}

// ---------------------------------------------------------------------------
// Webhook plumbing

export interface WebhookHeaders {
  authAlgo: string;
  certUrl: string;
  transmissionId: string;
  transmissionSig: string;
  transmissionTime: string;
}

/**
 * PayPal's transmission headers, checked before any call to PayPal: all present, a plain algorithm
 * name, and a certificate URL on paypal.com over HTTPS (PayPal's own guidance).
 */
export function readWebhookHeaders(get: (name: string) => string | null): WebhookHeaders | { error: string } {
  const h = {
    authAlgo: get("paypal-auth-algo")?.trim() ?? "",
    certUrl: get("paypal-cert-url")?.trim() ?? "",
    transmissionId: get("paypal-transmission-id")?.trim() ?? "",
    transmissionSig: get("paypal-transmission-sig")?.trim() ?? "",
    transmissionTime: get("paypal-transmission-time")?.trim() ?? "",
  };
  const missing = Object.entries(h)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) return { error: `Missing PayPal transmission headers: ${missing.join(", ")}` };
  if (!/^[A-Za-z0-9]{3,100}$/.test(h.authAlgo)) return { error: "Invalid PAYPAL-AUTH-ALGO" };
  let host = "";
  try {
    const u = new URL(h.certUrl);
    if (u.protocol !== "https:") return { error: "PAYPAL-CERT-URL must be HTTPS" };
    host = u.hostname;
  } catch {
    return { error: "Invalid PAYPAL-CERT-URL" };
  }
  if (!(host === "paypal.com" || host.endsWith(".paypal.com"))) return { error: "PAYPAL-CERT-URL is not on paypal.com" };
  if (h.transmissionId.length > 50 || h.transmissionSig.length > 1000 || h.transmissionTime.length > 100) return { error: "Oversized PayPal transmission header" };
  return h;
}

/** The verify-webhook-signature request body, with the event embedded exactly as received. */
export function verificationBody(h: WebhookHeaders, webhookId: string, rawEvent: string): string {
  const head = JSON.stringify({
    auth_algo: h.authAlgo,
    cert_url: h.certUrl,
    transmission_id: h.transmissionId,
    transmission_sig: h.transmissionSig,
    transmission_time: h.transmissionTime,
    webhook_id: webhookId,
  });
  return `${head.slice(0, -1)},"webhook_event":${rawEvent.trim()}}`;
}

export interface PayPalWebhookEvent {
  id: string;
  event_type: string;
  create_time?: string;
  resource: Record<string, unknown>;
}

export function parseWebhookEvent(raw: string): PayPalWebhookEvent | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const e = v as Record<string, unknown>;
  if (typeof e.id !== "string" || !/^[A-Za-z0-9-]{4,100}$/.test(e.id)) return null;
  if (typeof e.event_type !== "string" || !/^[A-Z0-9._-]{3,100}$/.test(e.event_type)) return null;
  if (!e.resource || typeof e.resource !== "object" || Array.isArray(e.resource)) return null;
  return { id: e.id, event_type: e.event_type, create_time: typeof e.create_time === "string" ? e.create_time : undefined, resource: e.resource as Record<string, unknown> };
}

export const HANDLED_EVENT_PREFIXES = ["PAYMENT.PAYOUTS-ITEM.", "PAYMENT.AUTHORIZATION.", "PAYMENT.CAPTURE."] as const;

export function isHandledEvent(type: string): boolean {
  return HANDLED_EVENT_PREFIXES.some((p) => type.startsWith(p));
}

const str = (v: unknown) => (typeof v === "string" && /^[A-Za-z0-9-]{4,60}$/.test(v) ? v : undefined);

function relatedIds(r: Record<string, unknown>): { orderId?: string; authorizationId?: string } {
  const rel = ((r.supplementary_data as Record<string, unknown> | undefined)?.related_ids ?? {}) as Record<string, unknown>;
  return { orderId: str(rel.order_id), authorizationId: str(rel.authorization_id) };
}

/** A refund's capture, from its HATEOAS "up" link (…/v2/payments/captures/{id}). */
function upCaptureId(r: Record<string, unknown>): string | undefined {
  const links = Array.isArray(r.links) ? (r.links as { rel?: string; href?: string }[]) : [];
  const href = links.find((l) => l.rel === "up" && typeof l.href === "string" && l.href.includes("/captures/"))?.href;
  return href ? str(href.split("/captures/")[1]?.split(/[/?#]/)[0]) : undefined;
}

/** Every PayPal id in the event that could tell us whose payment it is (the session lookup keys). */
export function eventResourceIds(e: PayPalWebhookEvent): string[] {
  const r = e.resource;
  const ids = [str(r.payout_batch_id), str(r.payout_item_id), str(r.id), relatedIds(r).orderId, relatedIds(r).authorizationId, upCaptureId(r)];
  return [...new Set(ids.filter((x): x is string => !!x))];
}

/**
 * Applies a verified webhook event to one session's state. Returns what changed (for the audit
 * log); events about payments this state does not hold change nothing.
 */
export function applyWebhookEvent(s: AppState, e: PayPalWebhookEvent, at: string): Applied & { note: string } {
  const by: StatusUpdate = { source: "webhook", at, eventId: e.id, eventType: e.event_type };
  const r = e.resource;
  const verified = `Verified PayPal webhook ${e.event_type} (${e.id})`;

  if (e.event_type.startsWith("PAYMENT.PAYOUTS-ITEM.")) {
    const batchId = str(r.payout_batch_id);
    const batch = s.batches.find((b) => b.id === batchId);
    const payoutItemId = str(r.payout_item_id);
    const status = typeof r.transaction_status === "string" ? r.transaction_status : e.event_type.split(".").pop()!;
    if (!batch || !payoutItemId) return { changed: false, settled: false, note: `${verified}: no matching payout batch in this ledger` };
    const item = r.payout_item as { sender_item_id?: unknown } | undefined;
    const errors = r.errors as { name?: string; message?: string } | undefined;
    const applied = applyPayoutItem(
      s,
      batch,
      { payout_item_id: payoutItemId, transaction_id: str(r.transaction_id), transaction_status: status, sender_item_id: typeof item?.sender_item_id === "string" ? item.sender_item_id : undefined, errors },
      by,
    );
    return { ...applied, note: applied.changed ? `${verified}: payout item ${payoutItemId} is ${status}` : `${verified}: payout item ${payoutItemId} already ${status}` };
  }

  const { orderId, authorizationId } = relatedIds(r);
  const id = str(r.id);
  const findOrder = (...ids: (string | undefined)[]) =>
    s.orders.find((o) => ids.some((x) => x && (o.id === x || o.authorization?.id === x || o.captureId === x)));

  if (e.event_type.startsWith("PAYMENT.AUTHORIZATION.")) {
    const order = findOrder(id, orderId);
    const status = typeof r.status === "string" ? r.status : "";
    if (!order || !id || !status) return { changed: false, settled: false, note: `${verified}: no matching order in this ledger` };
    const amount = cents((r.amount as { value?: unknown } | undefined)?.value);
    const changed = applyAuthorizationStatus(order, { id, status, amountCents: amount }, by);
    return {
      changed,
      settled: false,
      note: `${verified}: authorization ${id} is ${status}`,
      audit: changed
        ? { actor: "system", message: `Order ${order.id}: authorization ${id} is ${status}${SOURCE_SUFFIX.webhook}.`, ref: { orderId: order.id }, amountCents: order.authorization?.amountCents }
        : undefined,
    };
  }

  if (e.event_type === "PAYMENT.CAPTURE.REFUNDED" || e.event_type === "PAYMENT.CAPTURE.REVERSED") {
    const captureId = upCaptureId(r);
    const order = findOrder(captureId, orderId);
    const amount = cents((r.amount as { value?: unknown } | undefined)?.value);
    if (!order || amount == null) return { changed: false, settled: false, note: `${verified}: no matching capture in this ledger` };
    applyRefund(order, amount, by);
    return {
      changed: true,
      settled: false,
      note: `${verified}: ${fmt(amount)} refunded on capture ${captureId ?? order.captureId}`,
      audit: { actor: "system", message: `Order ${order.id}: ${fmt(amount)} refunded on PayPal${SOURCE_SUFFIX.webhook}.`, ref: { orderId: order.id }, amountCents: amount },
    };
  }

  if (e.event_type.startsWith("PAYMENT.CAPTURE.")) {
    const order = findOrder(id, authorizationId, orderId);
    const status = typeof r.status === "string" ? r.status : "";
    if (!order || !id || !status) return { changed: false, settled: false, note: `${verified}: no matching order in this ledger` };
    const amount = cents((r.amount as { value?: unknown } | undefined)?.value);
    const changed = applyCaptureStatus(order, { id, status, amountCents: amount, finalCapture: r.final_capture === true }, by);
    return {
      changed,
      settled: false,
      note: `${verified}: capture ${id} is ${status}`,
      audit: changed ? { actor: "system", message: `Order ${order.id}: capture ${id} is ${status}${SOURCE_SUFFIX.webhook}.`, ref: { orderId: order.id }, amountCents: amount } : undefined,
    };
  }

  return { changed: false, settled: false, note: `${verified}: event type not used by Supplora Pay` };
}

/** Short label for where a status came from, for the ledger. */
export function updatedByLabel(u: StatusUpdate | undefined): string | null {
  if (!u) return null;
  if (u.source === "webhook") return `webhook${u.eventType ? ` · ${u.eventType}` : ""}`;
  if (u.source === "reconcile") return "reconciliation";
  if (u.source === "poll") return "status poll";
  return "app";
}
