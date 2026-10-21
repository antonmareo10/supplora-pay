// Ledger reconciliation: compares what Supplora recorded with what PayPal says.
//
//  - every store order       → get_order through the official PayPal Agent Toolkit (MCP): status,
//                              authorization (restock orders are AUTHORIZE intent) and captures
//  - every payout batch      → GET /v1/payments/payouts/{id} over REST (the toolkit has no Payouts tool)
//  - the account's own list  → list_transactions through the toolkit, to confirm each capture and
//                              payout item appears in the PayPal account's transaction history
// PayPal is the source of truth for *statuses*: when PayPal is ahead (a payout claimed or returned,
// an authorization voided, a capture refunded) the ledger takes PayPal's status and records that the
// reconciliation updated it. *Amounts* are never changed here: a different amount is reported as a
// mismatch for the owner, never "fixed".

import { supplierById } from "@/data/seed";
import { fmt, fromDecimalString } from "./money";
import { applyBatch } from "./payments";
import { getPayoutBatch, PayPalError, type PayoutBatchResponse } from "./paypal";
import { orderFacts, withToolkit } from "./paypal-toolkit";
import { auditEntry, readState, updateState } from "./state";
import type { Reconciliation, ReconRow, StatusUpdate } from "./types";
import { applyAuthorizationStatus, applyCaptureStatus } from "./webhook-events";

interface TransactionInfo {
  transaction_id?: string;
  transaction_event_code?: string;
  transaction_status?: string;
  transaction_amount?: { value?: string; currency_code?: string };
}

type Facts = ReturnType<typeof orderFacts>;

export async function reconcileWithPayPal(): Promise<Reconciliation> {
  const state = await readState();
  const rows: ReconRow[] = [];
  /** PayPal responses whose statuses the ledger takes over at the end (one state write). */
  const batchSyncs: { batchId: string; res: PayoutBatchResponse }[] = [];
  const orderSyncs: { orderId: string; facts: Facts }[] = [];

  // 1. Payout batches (REST).
  for (const batch of state.batches) {
    let res: PayoutBatchResponse | null = null;
    let error: string | undefined;
    try {
      res = await getPayoutBatch(batch.id, { batchId: batch.id, planId: batch.planId });
    } catch (err) {
      error = err instanceof PayPalError ? err.message : "PayPal error";
    }
    const items = res?.items ?? [];
    let ahead = false;
    for (const item of batch.items) {
      const doc = state.documents.find((d) => d.id === item.docId);
      const pp = items.find((i) => i.payout_item.sender_item_id === item.senderItemId);
      const paypalCents = pp ? fromDecimalString(pp.payout_item.amount.value) : null;
      const sameAmount = paypalCents === item.amountCents;
      const sameStatus = pp?.transaction_status === item.transactionStatus;
      if (pp && sameAmount && !sameStatus) ahead = true;
      rows.push({
        id: `payout-${batch.id}-${item.senderItemId}`,
        kind: "payout",
        counterparty: supplierById(doc?.review?.supplierId)?.name ?? item.receiver,
        reference: `${batch.id} · ${pp?.payout_item_id ?? item.payoutItemId ?? "item pending"}`,
        transactionId: pp?.transaction_id ?? item.transactionId ?? null,
        ledgerCents: item.amountCents,
        paypalCents,
        ledgerStatus: sameAmount && pp ? pp.transaction_status : item.transactionStatus,
        paypalStatus: pp?.transaction_status ?? (error ? "unreachable" : "not found"),
        result: !pp ? "mismatch" : !sameAmount ? "mismatch" : "match",
        note: !pp
          ? error ?? "PayPal has no item for this payment in the batch"
          : !sameAmount
            ? `PayPal paid ${fmt(paypalCents)}, the ledger says ${fmt(item.amountCents)}`
            : sameStatus
              ? "Amount and status agree"
              : `Ledger updated from PayPal by this reconciliation: ${item.transactionStatus} → ${pp.transaction_status}`,
        listed: null,
      });
    }
    if (res && ahead) batchSyncs.push({ batchId: batch.id, res });
  }

  // 2. Store orders and 3. the account transaction list (both through the toolkit).
  const window = reconcileWindow(state.batches.map((b) => b.createdAt).concat(state.orders.map((o) => o.createdAt)));
  let transactionSearch: Reconciliation["transactionSearch"] = { ok: false, count: 0, start: window.start, end: window.end, error: "Nothing to look up yet" };
  await withToolkit(async (tk) => {
    for (const order of state.orders) {
      const r = await tk.call("get_order", { id: order.id }, { ref: { orderId: order.id } });
      const f = r.ok ? orderFacts(r.data) : null;
      const counterparty = supplierById(order.supplierId)?.name ?? order.supplierId;
      const reference = [order.id, f?.authorizationId && `auth ${f.authorizationId}`, f?.captureId && `capture ${f.captureId}`].filter(Boolean).join(" · ");
      if (!f) {
        rows.push({
          id: `order-${order.id}`,
          kind: "order",
          counterparty,
          reference,
          transactionId: order.captureId ?? null,
          ledgerCents: order.totalCents,
          paypalCents: null,
          ledgerStatus: order.status,
          paypalStatus: "unreachable",
          result: "mismatch",
          note: r.error ?? "PayPal did not return the order",
          listed: null,
        });
        continue;
      }
      if (order.intent === "AUTHORIZE" && order.authorization) {
        // Pay-for-what-arrived orders: compare the authorization and the capture separately.
        const auth = order.authorization;
        const authAmountOk = f.authorizationCents == null || f.authorizationCents === auth.amountCents;
        const capAmountOk = order.capturedCents == null || !order.captureId || f.capturedCents === order.capturedCents;
        const authAhead = !!f.authorizationStatus && f.authorizationStatus !== auth.status;
        const capAhead = !!f.captureId && (f.captureId !== order.captureId || f.captureStatus !== order.captureStatus);
        const amountsOk = authAmountOk && capAmountOk && f.currency === "EUR";
        if (amountsOk && (authAhead || capAhead)) orderSyncs.push({ orderId: order.id, facts: f });
        const ledger = `auth ${auth.status}${order.captureStatus ? ` · capture ${order.captureStatus}` : ""}`;
        const paypal = `auth ${f.authorizationStatus ?? "none"}${f.captureStatus ? ` · capture ${f.captureStatus}` : ""}`;
        rows.push({
          id: `order-${order.id}`,
          kind: "order",
          counterparty,
          reference,
          transactionId: f.captureId ?? order.captureId ?? null,
          // Captured amount once something was captured; the authorized amount until then (or when voided).
          ledgerCents: order.captureId ? (order.capturedCents ?? auth.amountCents) : auth.amountCents,
          paypalCents: f.captureId ? f.capturedCents : f.authorizationCents,
          ledgerStatus: amountsOk && (authAhead || capAhead) ? paypal : ledger,
          paypalStatus: paypal,
          result: amountsOk ? "match" : "mismatch",
          note: !authAmountOk
            ? `PayPal authorized ${fmt(f.authorizationCents)}, the ledger ${fmt(auth.amountCents)}`
            : !capAmountOk
              ? `PayPal captured ${fmt(f.capturedCents)}, the ledger ${fmt(order.capturedCents)}`
              : authAhead || capAhead
                ? `Ledger updated from PayPal by this reconciliation: ${ledger} → ${paypal}`
                : order.captureId
                  ? `Authorized ${fmt(auth.amountCents)} → captured ${fmt(order.capturedCents)} → released ${fmt(order.releasedCents)}: amounts and statuses agree`
                  : auth.status === "VOIDED"
                    ? `Authorization voided: all ${fmt(auth.amountCents)} released`
                    : `Authorized ${fmt(auth.amountCents)}, waiting for the delivery note: amount and status agree`,
          listed: null,
        });
        continue;
      }
      const sameAmount = f.amountCents === order.totalCents && f.currency === "EUR";
      const sameStatus = f.status === order.status;
      const sameCapture = (f.captureId ?? null) === (order.captureId ?? null) && (!f.captureId || f.captureStatus === order.captureStatus);
      const captureAhead = sameAmount && sameStatus && !!f.captureId && !sameCapture;
      if (captureAhead) orderSyncs.push({ orderId: order.id, facts: f });
      rows.push({
        id: `order-${order.id}`,
        kind: "order",
        counterparty,
        reference,
        transactionId: f.captureId ?? order.captureId ?? null,
        ledgerCents: order.totalCents,
        paypalCents: f.amountCents ?? null,
        ledgerStatus: `${order.status}${(captureAhead ? f.captureStatus : order.captureStatus) ? ` · capture ${captureAhead ? f.captureStatus : order.captureStatus}` : ""}`,
        paypalStatus: `${f.status}${f.captureStatus ? ` · capture ${f.captureStatus}` : ""}`,
        result: !sameAmount ? "mismatch" : sameStatus ? "match" : "pending",
        note: !sameAmount
          ? `PayPal shows ${f.currency} ${(f.amountCents ?? 0) / 100}, the ledger ${fmt(order.totalCents)}`
          : captureAhead
            ? `Ledger updated from PayPal by this reconciliation: capture ${order.captureStatus ?? "none"} → ${f.captureStatus}`
            : sameStatus
              ? "Amount, status and capture agree"
              : `PayPal says ${f.status}, the ledger ${order.status}`,
        listed: null,
      });
    }

    if (!rows.length) return;
    const r = await tk.call("list_transactions", { start_date: window.start, end_date: window.end, page_size: 500 });
    if (!r.ok) {
      transactionSearch = {
        ok: false,
        count: 0,
        start: window.start,
        end: window.end,
        error:
          r.status === 403
            ? "PayPal refused Transaction Search for this app (403 NOT_AUTHORIZED). Enable “Transaction search” in the app's features on developer.paypal.com, then reconcile again."
            : r.error,
      };
      return;
    }
    const details = (r.data.transaction_details as { transaction_info?: TransactionInfo }[] | undefined) ?? [];
    const ids = new Set(details.map((d) => d.transaction_info?.transaction_id).filter(Boolean) as string[]);
    for (const row of rows) row.listed = row.transactionId ? ids.has(row.transactionId) : false;
    transactionSearch = { ok: true, count: details.length, start: window.start, end: window.end };
  });

  const result: Reconciliation = {
    at: new Date().toISOString(),
    rows,
    transactionSearch,
    totals: {
      match: rows.filter((r) => r.result === "match").length,
      pending: rows.filter((r) => r.result === "pending").length,
      mismatch: rows.filter((r) => r.result === "mismatch").length,
    },
  };
  const synced = batchSyncs.length + orderSyncs.length;
  await updateState((s) => {
    const by: StatusUpdate = { source: "reconcile", at: result.at };
    for (const { batchId, res } of batchSyncs) if (s.batches.some((b) => b.id === batchId)) applyBatch(s, batchId, res, by);
    for (const { orderId, facts } of orderSyncs) {
      const o = s.orders.find((x) => x.id === orderId);
      if (!o) continue;
      if (o.intent === "AUTHORIZE" && facts.authorizationId && facts.authorizationStatus) {
        applyAuthorizationStatus(o, { id: facts.authorizationId, status: facts.authorizationStatus, amountCents: facts.authorizationCents ?? undefined }, by);
      }
      if (facts.captureId && facts.captureStatus) {
        applyCaptureStatus(o, { id: facts.captureId, status: facts.captureStatus, amountCents: facts.capturedCents ?? undefined, finalCapture: facts.authorizationStatus === "CAPTURED" }, by);
      }
    }
    s.reconciliation = result;
    s.audit.push(
      auditEntry({
        actor: "system",
        message: `Reconciled the ledger with PayPal: ${result.totals.match} match, ${result.totals.pending} pending, ${result.totals.mismatch} mismatch${synced ? `; ledger statuses updated from PayPal for ${synced} payment${synced === 1 ? "" : "s"}` : ""}${transactionSearch.ok ? `; ${transactionSearch.count} transactions in the account list` : ""}.`,
      }),
    );
  });
  return result;
}

/** PayPal's Transaction Search covers at most 31 days per request. */
function reconcileWindow(timestamps: string[]): { start: string; end: string } {
  const now = new Date();
  const earliest = timestamps.length ? Math.min(...timestamps.map((t) => Date.parse(t))) : now.getTime();
  const start = Math.max(earliest - 86_400_000, now.getTime() - 30 * 86_400_000);
  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
  return { start: iso(start), end: iso(now.getTime()) };
}
