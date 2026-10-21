// Executes owner-approved payments as a PayPal Payouts batch and keeps statuses in
// sync. This is the only code path that sends supplier money, and it only runs from
// the owner's Approve action.

import { RESTAURANT, supplierById } from "@/data/seed";
import { effective, isPaidOrSent } from "./ap";
import { businessToday } from "./dates";
import { fmt, fromDecimalString, pctOf } from "./money";
import { sweepDemoPayouts, type SweepDeps, type SweepOptions, type SweepResult } from "./demo-sweep";
import { cancelUnclaimedPayoutItem, createPayoutBatch, getPayoutBatch, paypalConfigured, PayPalError, type PayoutBatchResponse } from "./paypal";
import { recheckAll } from "./review";
import { currentStateKey, demoMode, runWithStateKey } from "./session";
import { auditEntry, forgetDemoPayout, indexPayPalResources, listDemoPayouts, readState, registerDemoPayout, updateState } from "./state";
import type { AppState, PayoutBatchRecord, PlannedPayment, StatusUpdate } from "./types";
import { applyPayoutItem } from "./webhook-events";

export class PaymentError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const MAX_ITEMS_PER_BATCH = 50;

function receiverFor(supplierId: string): string {
  const override = process.env.PAYPAL_PAYOUT_RECEIVER_OVERRIDE?.trim();
  if (override && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(override)) return override;
  const s = supplierById(supplierId);
  if (!s) throw new PaymentError(`Unknown supplier ${supplierId}`, 400);
  return s.paypalEmail;
}

function noteFor(p: PlannedPayment): string {
  const parts = [`Payment of invoice ${p.invoiceNumber} from ${RESTAURANT.name}.`];
  if (p.withheldCents) parts.push(`${fmt(p.withheldCents)} withheld pending a credit note (details sent by email).`);
  if (p.discountCents) parts.push(`Early-payment discount of ${fmt(p.discountCents)} applied per your terms.`);
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Public-demo housekeeping (DEMO_MODE only). Demo payouts go to placeholder receivers, so they end
// UNCLAIMED and PayPal would hold the money for 30 days: a few judges clicking through would drain
// the sandbox account. Every batch is registered when it is created (state.ts, in memory or Redis)
// and a sweep (demo-sweep.ts) cancels the UNCLAIMED items of batches older than STALE_MS, which
// returns the money at once. Sweeps are triggered opportunistically and never block a request:
// after the health check, after page renders, after an approval and after Reset demo (that
// session's batches, whatever their age). If a payout is refused for insufficient funds, other
// sessions' unclaimed payouts are returned first and the payout is retried once.

const STALE_MS = 20 * 60 * 1000;
const SWEEP_EVERY_MS = 60 * 1000;
const HOUSEKEEPING_KEY = "demo:housekeeping";
type SweepState = { chain: Promise<unknown>; lastStale: number };
const sweepState = ((globalThis as typeof globalThis & { __supploraSweep?: SweepState }).__supploraSweep ??= { chain: Promise.resolve(), lastStale: 0 });

/** Runs one sweep, serialised with any other sweep in this process. Its PayPal calls are audited in a housekeeping session. */
function runDemoSweep(opts: SweepOptions): Promise<SweepResult> {
  const attempt = Date.now().toString(36);
  const deps: SweepDeps = {
    list: listDemoPayouts,
    forget: forgetDemoPayout,
    getBatch: (e) => getPayoutBatch(e.batchId, { batchId: e.batchId }),
    cancelItem: async (itemId, cents) => void (await cancelUnclaimedPayoutItem(itemId, cents, attempt)),
    now: Date.now,
  };
  const run = sweepState.chain.then(() => runWithStateKey(HOUSEKEEPING_KEY, () => sweepDemoPayouts(deps, opts)));
  sweepState.chain = run.catch(() => undefined);
  return run;
}

/**
 * Demo only: return unclaimed payouts older than STALE_MS, at most once a minute per process. Never
 * throws; call it inside next/server `after()` so it never delays a response.
 */
export async function sweepStaleDemoPayouts(): Promise<void> {
  if (!demoMode() || !paypalConfigured() || Date.now() - sweepState.lastStale < SWEEP_EVERY_MS) return;
  sweepState.lastStale = Date.now();
  try {
    await runDemoSweep({ minAgeMs: STALE_MS });
  } catch (err) {
    console.error("[demo housekeeping] sweep failed:", err instanceof Error ? err.message : err);
  }
}

/**
 * Demo only: return one session's unclaimed sandbox payouts sent before `before`, whatever their age
 * (Reset demo keeps the session cookie, so later payouts of the fresh run are left alone). Never throws.
 */
export async function returnSessionDemoPayouts(key: string, before: number): Promise<void> {
  if (!demoMode() || !paypalConfigured()) return;
  try {
    await runDemoSweep({ minAgeMs: 0, only: (e) => e.key === key && e.at <= before });
  } catch (err) {
    console.error("[demo housekeeping] reset sweep failed:", err instanceof Error ? err.message : err);
  }
}

export async function approvePayments(planId: string, docIds: string[]): Promise<PayoutBatchRecord> {
  const unique = [...new Set(docIds)];
  if (!unique.length) throw new PaymentError("Select at least one payment to approve.", 400);
  if (unique.length > MAX_ITEMS_PER_BATCH) throw new PaymentError("Too many payments in one batch.", 400);
  const today = businessToday();

  // 1. Validate against the current state and lock the selected payments.
  const locked = await updateState((s) => {
    const plan = s.plans.find((p) => p.id === planId);
    if (!plan) throw new PaymentError("Payment plan not found.", 404);
    if (plan.status !== "awaiting_approval" && plan.status !== "partially_paid") {
      throw new PaymentError(`This plan is ${plan.status.replace("_", " ")} and can't be approved.`, 409);
    }
    const selected: PlannedPayment[] = [];
    for (const docId of unique) {
      const p = plan.payments.find((x) => x.docId === docId);
      if (!p) throw new PaymentError(`Invoice ${docId} is not part of this plan.`, 400);
      if (p.status !== "proposed" && p.status !== "failed") throw new PaymentError(`${p.invoiceNumber} is already ${p.status}.`, 409);
      const doc = s.documents.find((d) => d.id === docId);
      if (!doc || !doc.review) throw new PaymentError(`Invoice ${p.invoiceNumber} no longer exists.`, 409);
      if (isPaidOrSent(doc)) throw new PaymentError(`${p.invoiceNumber} has already been sent to PayPal.`, 409);
      const e = effective(doc)!;
      if (e.action === "hold") throw new PaymentError(`${p.invoiceNumber} is on hold. Release it before paying.`, 409);
      const disc = doc.review.discount;
      const discountCents = p.discountCents && disc && disc.deadline >= today ? pctOf(e.payableCents, disc.percent) : 0;
      if (p.discountCents && !discountCents) throw new PaymentError(`The early-payment discount on ${p.invoiceNumber} has expired. Re-run the plan.`, 409);
      if (e.payableCents - discountCents !== p.amountCents) {
        throw new PaymentError(`${p.invoiceNumber} changed since the plan was made (now ${fmt(e.payableCents - discountCents)}). Re-run the plan.`, 409);
      }
      selected.push(p);
    }
    const alreadySent = plan.payments.filter((p) => ["sending", "processing", "paid", "unclaimed"].includes(p.status)).reduce((a, p) => a + p.amountCents, 0);
    const total = selected.reduce((a, p) => a + p.amountCents, 0);
    if (alreadySent + total > plan.cashCapCents) throw new PaymentError(`This would exceed the ${fmt(plan.cashCapCents)} cash cap.`, 409);
    for (const p of selected) {
      p.status = "sending";
      p.error = undefined;
      const doc = s.documents.find((d) => d.id === p.docId)!;
      doc.payment = { status: "scheduled", amountCents: p.amountCents, discountCents: p.discountCents, planId };
    }
    const seq = s.batches.filter((b) => b.planId === planId).length + 1;
    s.audit.push(
      auditEntry({
        actor: "owner",
        message: `${RESTAURANT.ownerFirstName} approved ${selected.length} payment${selected.length === 1 ? "" : "s"} (${fmt(total)}): ${selected.map((p) => p.supplierName).join(", ")}.`,
        ref: { planId },
        amountCents: total,
      }),
    );
    return { selected, senderBatchId: `${planId}-${seq}`, total };
  });

  // 2. Send the batch to PayPal (outside the state lock).
  const send = (senderBatchId: string) =>
    createPayoutBatch({
      senderBatchId,
      subject: `Payment from ${RESTAURANT.name}`,
      message: `${RESTAURANT.name} has sent you a payment for your invoice. Thank you!`,
      ref: { planId },
      items: locked.selected.map((p) => ({
        receiver: receiverFor(p.supplierId),
        amountCents: p.amountCents,
        note: noteFor(p),
        senderItemId: p.docId,
      })),
    });
  let response: PayoutBatchResponse;
  const demo = demoMode();
  const key = demo ? await currentStateKey() : "";
  try {
    try {
      response = await send(locked.senderBatchId);
    } catch (err) {
      // Demo only: the shared sandbox account ran dry; return other sessions' unclaimed payouts, retry once.
      if (!(demo && err instanceof PayPalError && /INSUFFICIENT_FUNDS/.test(`${err.issue} ${err.message}`))) throw err;
      const back = await runDemoSweep({ minAgeMs: 0, only: (e) => e.key !== key }).catch(() => null);
      if (!back?.cancelled) throw err;
      locked.senderBatchId = `${locked.senderBatchId}-r`;
      response = await send(locked.senderBatchId);
    }
  } catch (err) {
    const message = err instanceof PayPalError ? err.message : err instanceof Error ? err.message : "PayPal error";
    await updateState((s) => {
      const plan = s.plans.find((p) => p.id === planId)!;
      for (const sel of locked.selected) {
        const p = plan.payments.find((x) => x.docId === sel.docId)!;
        p.status = "failed";
        p.error = message;
        const doc = s.documents.find((d) => d.id === sel.docId);
        if (doc) doc.payment = { status: "unpaid", error: message };
      }
    });
    const hint = demo && /INSUFFICIENT_FUNDS/.test(message) ? " The public demo's sandbox account is out of test funds right now; try again in a few minutes." : "";
    throw new PaymentError(`PayPal rejected the payout batch: ${message}${hint}`, 502);
  }

  // 3. Record the batch (and, in the public demo, register it for housekeeping right away, so its
  // money comes back even if the visitor closes the tab before the batch is ever polled).
  const batchId = response.batch_header.payout_batch_id;
  await indexPayPalResources([batchId]);
  if (demo) {
    await registerDemoPayout({ batchId, key, at: Date.now(), cents: locked.total }).catch((err) =>
      console.error("[demo housekeeping] could not register payout batch", batchId, err instanceof Error ? err.message : err),
    );
  }
  return updateState((s) => {
    const plan = s.plans.find((p) => p.id === planId)!;
    const record: PayoutBatchRecord = {
      id: batchId,
      senderBatchId: locked.senderBatchId,
      planId,
      createdAt: new Date().toISOString(),
      status: response.batch_header.batch_status,
      totalCents: locked.total,
      items: locked.selected.map((p) => ({
        docId: p.docId,
        senderItemId: p.docId,
        receiver: receiverFor(p.supplierId),
        amountCents: p.amountCents,
        transactionStatus: "PENDING",
      })),
    };
    s.batches.push(record);
    for (const sel of locked.selected) {
      const p = plan.payments.find((x) => x.docId === sel.docId)!;
      p.status = "processing";
      p.batchId = batchId;
      const doc = s.documents.find((d) => d.id === sel.docId)!;
      doc.payment = { ...doc.payment, status: "processing", batchId, at: new Date().toISOString() };
    }
    plan.status = plan.payments.some((p) => p.status === "proposed" || p.status === "failed") ? "partially_paid" : "completed";
    return record;
  });
}

const TERMINAL_BATCH = ["SUCCESS", "DENIED", "CANCELED", "FAILED"];

const inflight = new Map<string, Promise<PayoutBatchRecord>>();

export function batchIsFinal(b: PayoutBatchRecord): boolean {
  return TERMINAL_BATCH.includes(b.status) && b.items.every((i) => !["PENDING", "ONHOLD", "NEW"].includes(i.transactionStatus));
}

export async function syncBatch(batchId: string): Promise<PayoutBatchRecord> {
  const current = (await readState()).batches.find((b) => b.id === batchId);
  if (!current) throw new PaymentError("Payout batch not found.", 404);
  if (batchIsFinal(current)) return current;
  const running = inflight.get(batchId);
  if (running) return running;
  const job = (async () => {
    const res = await getPayoutBatch(batchId, { planId: current.planId, batchId });
    return updateState((s) => applyBatch(s, batchId, res, { source: "poll", at: new Date().toISOString() }));
  })().finally(() => inflight.delete(batchId));
  inflight.set(batchId, job);
  return job;
}

/**
 * Applies a payout batch as PayPal reports it (status poll or reconciliation) to the ledger: the
 * batch header, then each item through the same code the verified webhooks use.
 */
export function applyBatch(s: AppState, batchId: string, res: PayoutBatchResponse, by: StatusUpdate): PayoutBatchRecord {
  const batch = s.batches.find((b) => b.id === batchId)!;
  batch.status = res.batch_header.batch_status;
  batch.lastPolledAt = new Date().toISOString();
  if (res.batch_header.fees?.value) batch.feesCents = fromDecimalString(res.batch_header.fees.value);
  if (res.batch_header.time_completed) batch.completedAt = res.batch_header.time_completed;
  let settledSomething = false;
  for (const it of res.items ?? []) {
    const applied = applyPayoutItem(
      s,
      batch,
      { payout_item_id: it.payout_item_id, transaction_id: it.transaction_id, transaction_status: it.transaction_status, sender_item_id: it.payout_item.sender_item_id, errors: it.errors },
      by,
    );
    if (applied.audit) s.audit.push(auditEntry(applied.audit));
    settledSomething ||= applied.settled;
  }
  if (settledSomething) recheckAll(s);
  return batch;
}

export async function latestBatches(): Promise<PayoutBatchRecord[]> {
  return (await readState()).batches.slice().reverse();
}
