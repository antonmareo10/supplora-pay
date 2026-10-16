// Executes owner-approved payments as a PayPal Payouts batch and keeps statuses in
// sync. This is the only code path that sends supplier money, and it only runs from
// the owner's Approve action.

import { RESTAURANT, supplierById } from "@/data/seed";
import { effective, isSettled } from "./ap";
import { businessToday } from "./dates";
import { fmt, fromDecimalString, pctOf } from "./money";
import { createPayoutBatch, getPayoutBatch, PayPalError, type PayoutBatchResponse } from "./paypal";
import { recheckAll } from "./review";
import { auditEntry, readState, updateState } from "./state";
import type { AppState, PaymentStatus, PayoutBatchRecord, PlannedPayment } from "./types";

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
      if (isSettled(doc)) throw new PaymentError(`${p.invoiceNumber} has already been paid.`, 409);
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
  let response: PayoutBatchResponse;
  try {
    response = await createPayoutBatch({
      senderBatchId: locked.senderBatchId,
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
    throw new PaymentError(`PayPal rejected the payout batch: ${message}`, 502);
  }

  // 3. Record the batch.
  const batchId = response.batch_header.payout_batch_id;
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
const PAID_ITEM = ["SUCCESS"];
const SENT_ITEM = ["UNCLAIMED"];
const FAILED_ITEM = ["FAILED", "RETURNED", "BLOCKED", "REFUNDED", "REVERSED", "DENIED"];

function itemToStatus(s: string): { doc: PaymentStatus; plan: PlannedPayment["status"] } {
  if (PAID_ITEM.includes(s)) return { doc: "paid", plan: "paid" };
  if (SENT_ITEM.includes(s)) return { doc: "unclaimed", plan: "unclaimed" };
  if (FAILED_ITEM.includes(s)) return { doc: "failed", plan: "failed" };
  return { doc: "processing", plan: "processing" };
}

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
    return updateState((s) => applyBatch(s, batchId, res));
  })().finally(() => inflight.delete(batchId));
  inflight.set(batchId, job);
  return job;
}

function applyBatch(s: AppState, batchId: string, res: PayoutBatchResponse): PayoutBatchRecord {
  const batch = s.batches.find((b) => b.id === batchId)!;
  const plan = s.plans.find((p) => p.id === batch.planId);
  batch.status = res.batch_header.batch_status;
  batch.lastPolledAt = new Date().toISOString();
  if (res.batch_header.fees?.value) batch.feesCents = fromDecimalString(res.batch_header.fees.value);
  if (res.batch_header.time_completed) batch.completedAt = res.batch_header.time_completed;
  let settledSomething = false;
  for (const it of res.items ?? []) {
    const item = batch.items.find((i) => i.senderItemId === it.payout_item.sender_item_id);
    if (!item) continue;
    const before = item.transactionStatus;
    item.payoutItemId = it.payout_item_id;
    item.transactionId = it.transaction_id ?? item.transactionId;
    item.transactionStatus = it.transaction_status;
    item.errorName = it.errors?.name;
    if (before === it.transaction_status) continue;
    const mapped = itemToStatus(it.transaction_status);
    const doc = s.documents.find((d) => d.id === item.docId);
    if (doc) {
      doc.payment = {
        ...doc.payment,
        status: mapped.doc,
        payoutItemId: it.payout_item_id,
        transactionId: it.transaction_id,
        at: new Date().toISOString(),
        error: mapped.doc === "failed" ? it.errors?.message ?? it.transaction_status : undefined,
      };
      if (mapped.doc === "failed") doc.payment = { status: "failed", error: doc.payment.error };
    }
    const p = plan?.payments.find((x) => x.docId === item.docId);
    if (p) {
      p.status = mapped.plan;
      p.payoutItemId = it.payout_item_id;
    }
    if (mapped.doc !== "processing") {
      settledSomething = true;
      const supplier = p?.supplierName ?? item.receiver;
      const detail =
        it.transaction_status === "UNCLAIMED"
          ? " — sent; the receiver has no PayPal account yet, so PayPal holds the funds until they claim them (returned after 30 days)"
          : it.transaction_status === "SUCCESS"
            ? " — delivered to the supplier's PayPal account"
            : ` — ${it.errors?.message ?? "not delivered"}`;
      s.audit.push(
        auditEntry({
          actor: "system",
          message: `Payout to ${supplier} ${fmt(item.amountCents)}: ${it.transaction_status}${detail}.`,
          ref: { batchId, docId: item.docId, planId: batch.planId },
          amountCents: item.amountCents,
        }),
      );
    }
  }
  if (settledSomething) recheckAll(s);
  return batch;
}

export async function latestBatches(): Promise<PayoutBatchRecord[]> {
  return (await readState()).batches.slice().reverse();
}
