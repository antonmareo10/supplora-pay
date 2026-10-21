// Run with: npm test   (Node's built-in test runner with type stripping)
// Verified webhooks, status polls and reconciliation all update the ledger through these functions.
// No network: PayPal's signature check is a separate API call made before any of this runs.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { AppState, PayoutBatchRecord, StoreOrder } from "./types.ts";
import {
  applyPayoutItem,
  applyWebhookEvent,
  eventResourceIds,
  isHandledEvent,
  itemToStatus,
  parseWebhookEvent,
  readWebhookHeaders,
  statusMovesForward,
  updatedByLabel,
  verificationBody,
} from "./webhook-events.ts";

const AT = "2026-10-21T12:00:00.000Z";

function state(): AppState {
  const batch: PayoutBatchRecord = {
    id: "BATCH1",
    senderBatchId: "pln_1-1",
    planId: "pln_1",
    createdAt: AT,
    status: "SUCCESS",
    totalCents: 15834,
    items: [{ docId: "doc-01", senderItemId: "doc-01", receiver: "cobros@huerta.example", amountCents: 15834, payoutItemId: "ITEM1", transactionStatus: "UNCLAIMED" }],
  };
  const order: StoreOrder = {
    id: "ORDER1AAAAAA",
    supplierId: "cleanpro",
    createdAt: AT,
    source: "agent",
    lines: [],
    netCents: 11980,
    vatCents: 2516,
    totalCents: 14496,
    intent: "AUTHORIZE",
    status: "COMPLETED",
    authorization: { id: "AUTH1AAAAAAA", status: "CREATED", amountCents: 14496, createdAt: AT },
  };
  return {
    version: 1,
    createdAt: AT,
    settings: { cashCapCents: 250000, restockLimitCents: 15000 },
    documents: [{ id: "doc-01", origin: "sample", fileName: "01.png", mimeType: "image/png", url: "/x", addedAt: AT, reviewStatus: "reviewed", payment: { status: "unclaimed", amountCents: 15834, batchId: "BATCH1", payoutItemId: "ITEM1" } }],
    plans: [
      {
        id: "pln_1",
        createdAt: AT,
        today: "2026-10-16",
        status: "completed",
        cashCapCents: 250000,
        payments: [{ docId: "doc-01", supplierId: "huerta-guadalhorce", supplierName: "Huerta", invoiceNumber: "HG-1", dueDate: null, invoiceCents: 16146, withheldCents: 312, discountCents: 0, amountCents: 15834, reason: "", status: "unclaimed", batchId: "BATCH1" }],
        deferred: [],
        totals: { payCents: 15834, discountCents: 0, withheldCents: 312, deferredCents: 0, headroomCents: 0 },
        summary: "",
        messageToOwner: "",
        agentLog: [],
      },
    ],
    batches: [batch],
    proposals: [],
    orders: [order],
    inventory: [],
    audit: [],
  };
}

const event = (type: string, resource: Record<string, unknown>, id = "WH-1A2B3C") => ({ id, event_type: type, resource });

test("webhook headers: all five transmission headers, a plain algorithm, a cert on paypal.com over https", () => {
  const ok: Record<string, string> = {
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
    "paypal-transmission-id": "69cd13f0-d67a-11e5-baa3-778b53f4ae55",
    "paypal-transmission-sig": "c2lnbmF0dXJl",
    "paypal-transmission-time": "2026-10-21T12:00:00Z",
  };
  const h = readWebhookHeaders((n) => ok[n] ?? null);
  assert.ok(!("error" in h));
  assert.match(String((readWebhookHeaders((n) => (n === "paypal-transmission-sig" ? null : ok[n] ?? null)) as { error: string }).error), /paypal-transmission-sig|transmissionSig/);
  for (const bad of ["http://api.sandbox.paypal.com/c", "https://paypal.com.evil.example/c", "https://evilpaypal.com/c", "not a url"]) {
    assert.ok("error" in readWebhookHeaders((n) => (n === "paypal-cert-url" ? bad : ok[n] ?? null)), bad);
  }
});

test("verify body: the event is embedded byte for byte, the rest is valid JSON", () => {
  const raw = '{"id":"WH-1","event_type":"PAYMENT.CAPTURE.COMPLETED","resource":{"amount":{"value":"141.10"}},"x":1.50}';
  const body = verificationBody({ authAlgo: "SHA256withRSA", certUrl: "https://api.paypal.com/c", transmissionId: "t", transmissionSig: "s", transmissionTime: "2026" }, "WEBHOOK1", raw);
  assert.ok(body.endsWith(`"webhook_event":${raw}}`)); // "1.50" survives: re-serialising would turn it into 1.5
  const parsed = JSON.parse(body);
  assert.equal(parsed.webhook_id, "WEBHOOK1");
  assert.equal(parsed.auth_algo, "SHA256withRSA");
  assert.equal(parsed.webhook_event.id, "WH-1");
});

test("events: parsing, handled types, and the ids used to find the owning session", () => {
  assert.equal(parseWebhookEvent("not json"), null);
  assert.equal(parseWebhookEvent('{"id":"WH-1","event_type":"X"}'), null); // no resource
  assert.equal(parseWebhookEvent('{"id":"bad id!","event_type":"PAYMENT.CAPTURE.COMPLETED","resource":{}}'), null);
  assert.ok(isHandledEvent("PAYMENT.PAYOUTS-ITEM.UNCLAIMED"));
  assert.ok(isHandledEvent("PAYMENT.CAPTURE.REFUNDED"));
  assert.ok(!isHandledEvent("CHECKOUT.ORDER.APPROVED"));
  const e = parseWebhookEvent(
    JSON.stringify(event("PAYMENT.CAPTURE.COMPLETED", { id: "CAP1AAAAAAA", status: "COMPLETED", supplementary_data: { related_ids: { order_id: "ORDER1AAAAAA", authorization_id: "AUTH1AAAAAAA" } } })),
  )!;
  assert.deepEqual(eventResourceIds(e).sort(), ["AUTH1AAAAAAA", "CAP1AAAAAAA", "ORDER1AAAAAA"]);
  const refund = parseWebhookEvent(
    JSON.stringify(event("PAYMENT.CAPTURE.REFUNDED", { id: "REF1AAAAAA", amount: { value: "3.87" }, links: [{ rel: "up", href: "https://api.sandbox.paypal.com/v2/payments/captures/CAP1AAAAAAA" }] })),
  )!;
  assert.ok(eventResourceIds(refund).includes("CAP1AAAAAAA"));
});

test("payout item webhook: UNCLAIMED → SUCCESS marks the invoice paid, by webhook", () => {
  const s = state();
  const r = applyWebhookEvent(
    s,
    event("PAYMENT.PAYOUTS-ITEM.SUCCEEDED", { payout_batch_id: "BATCH1", payout_item_id: "ITEM1", transaction_id: "TX1", transaction_status: "SUCCESS", payout_item: { sender_item_id: "doc-01" } }),
    AT,
  );
  assert.equal(r.changed, true);
  assert.equal(r.settled, true);
  assert.equal(s.batches[0].items[0].transactionStatus, "SUCCESS");
  assert.equal(s.documents[0].payment.status, "paid");
  assert.equal(s.documents[0].payment.updatedBy?.source, "webhook");
  assert.equal(s.documents[0].payment.updatedBy?.eventId, "WH-1A2B3C");
  assert.equal(s.plans[0].payments[0].status, "paid");
  assert.match(r.audit!.message, /verified PayPal webhook/);
  assert.equal(updatedByLabel(s.documents[0].payment.updatedBy), "webhook · PAYMENT.PAYOUTS-ITEM.SUCCEEDED");
  // The same status again changes nothing.
  const again = applyWebhookEvent(s, event("PAYMENT.PAYOUTS-ITEM.SUCCEEDED", { payout_batch_id: "BATCH1", payout_item_id: "ITEM1", transaction_status: "SUCCESS" }, "WH-2"), AT);
  assert.equal(again.changed, false);
});

test("payout item: a cancelled or returned payout reopens the invoice and the plan", () => {
  const s = state();
  const r = applyPayoutItem(s, s.batches[0], { payout_item_id: "ITEM1", transaction_status: "CANCELED", sender_item_id: "doc-01" }, { source: "reconcile", at: AT });
  assert.equal(r.settled, true);
  assert.equal(s.documents[0].payment.status, "returned");
  assert.match(s.documents[0].payment.error!, /returned to the restaurant/);
  assert.equal(s.plans[0].payments[0].status, "failed");
  assert.equal(s.plans[0].status, "partially_paid");
  assert.equal(s.batches[0].items[0].updatedBy?.source, "reconcile");
  assert.deepEqual(itemToStatus("UNCLAIMED"), { doc: "unclaimed", plan: "unclaimed" });
  assert.deepEqual(itemToStatus("PENDING"), { doc: "processing", plan: "processing" });
});

test("authorization and capture webhooks update the order, by webhook", () => {
  const s = state();
  const cap = applyWebhookEvent(
    s,
    event("PAYMENT.CAPTURE.COMPLETED", { id: "CAP1AAAAAAA", status: "COMPLETED", amount: { value: "141.09", currency_code: "EUR" }, final_capture: true, supplementary_data: { related_ids: { order_id: "ORDER1AAAAAA", authorization_id: "AUTH1AAAAAAA" } } }),
    AT,
  );
  assert.equal(cap.changed, true);
  const o = s.orders[0];
  assert.equal(o.captureId, "CAP1AAAAAAA");
  assert.equal(o.capturedCents, 14109);
  assert.equal(o.authorization!.status, "CAPTURED");
  assert.equal(o.releasedCents, 387);
  assert.equal(o.updatedBy?.source, "webhook");

  const refund = applyWebhookEvent(
    s,
    event("PAYMENT.CAPTURE.REFUNDED", { id: "REF1AAAAAA", status: "COMPLETED", amount: { value: "3.87" }, links: [{ rel: "up", href: "https://api.sandbox.paypal.com/v2/payments/captures/CAP1AAAAAAA" }] }, "WH-3"),
    AT,
  );
  assert.equal(refund.changed, true);
  assert.equal(o.refundedCents, 387);
  assert.equal(o.captureStatus, "PARTIALLY_REFUNDED");

  const s2 = state();
  const voided = applyWebhookEvent(s2, event("PAYMENT.AUTHORIZATION.VOIDED", { id: "AUTH1AAAAAAA", status: "VOIDED", amount: { value: "144.96" }, supplementary_data: { related_ids: { order_id: "ORDER1AAAAAA" } } }), AT);
  assert.equal(voided.changed, true);
  assert.equal(s2.orders[0].authorization!.status, "VOIDED");
  assert.equal(s2.orders[0].releasedCents, 14496);
  assert.equal(s2.orders[0].capturedCents, 0);
});

test("late or out-of-order webhooks never move a status backwards", () => {
  const s = state();
  // The payout was already returned; an UNCLAIMED event delivered late is recorded as seen, not applied.
  applyPayoutItem(s, s.batches[0], { payout_item_id: "ITEM1", transaction_status: "RETURNED", sender_item_id: "doc-01" }, { source: "reconcile", at: AT });
  const late = applyWebhookEvent(s, event("PAYMENT.PAYOUTS-ITEM.UNCLAIMED", { payout_batch_id: "BATCH1", payout_item_id: "ITEM1", transaction_status: "UNCLAIMED", payout_item: { sender_item_id: "doc-01" } }, "WH-OLD"), AT);
  assert.equal(late.changed, false);
  assert.match(late.note, /older than the ledger's RETURNED \(kept\)/);
  assert.equal(s.batches[0].items[0].transactionStatus, "RETURNED");
  assert.equal(s.batches[0].items[0].lastWebhook?.eventId, "WH-OLD");
  // An authorization's CREATED event arriving after its capture.
  const s2 = state();
  s2.orders[0].authorization!.status = "CAPTURED";
  const created = applyWebhookEvent(s2, event("PAYMENT.AUTHORIZATION.CREATED", { id: "AUTH1AAAAAAA", status: "CREATED", supplementary_data: { related_ids: { order_id: "ORDER1AAAAAA" } } }), AT);
  assert.equal(created.changed, false);
  assert.equal(s2.orders[0].authorization!.status, "CAPTURED");
  assert.equal(s2.orders[0].lastWebhook?.eventType, "PAYMENT.AUTHORIZATION.CREATED");
  assert.ok(statusMovesForward("capture", "COMPLETED", "PARTIALLY_REFUNDED"));
  assert.ok(!statusMovesForward("capture", "REFUNDED", "COMPLETED"));
  assert.ok(statusMovesForward("item", "UNCLAIMED", "SUCCESS"));
  assert.ok(!statusMovesForward("item", "SUCCESS", "UNCLAIMED"));
});

test("events about payments this ledger does not hold change nothing", () => {
  const s = state();
  const before = JSON.stringify(s);
  const r1 = applyWebhookEvent(s, event("PAYMENT.CAPTURE.COMPLETED", { id: "OTHERCAPTURE", status: "COMPLETED", supplementary_data: { related_ids: { order_id: "OTHERORDER1" } } }), AT);
  const r2 = applyWebhookEvent(s, event("PAYMENT.PAYOUTS-ITEM.SUCCEEDED", { payout_batch_id: "OTHERBATCH", payout_item_id: "X1234", transaction_status: "SUCCESS" }), AT);
  assert.equal(r1.changed || r2.changed, false);
  assert.equal(JSON.stringify(s), before);
});
