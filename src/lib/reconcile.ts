// Ledger reconciliation: compares what Supplora recorded with what PayPal says, read-only.
//
//  - every store order       → get_order through the official PayPal Agent Toolkit (MCP)
//  - every payout batch      → GET /v1/payments/payouts/{id} over REST (the toolkit has no Payouts tool)
//  - the account's own list  → list_transactions through the toolkit, to confirm each capture and
//                              payout item appears in the PayPal account's transaction history
// Nothing here changes a payment: mismatches are reported for the owner, never "fixed".

import { supplierById } from "@/data/seed";
import { fmt, fromDecimalString } from "./money";
import { getPayoutBatch, PayPalError } from "./paypal";
import { orderFacts, withToolkit } from "./paypal-toolkit";
import { auditEntry, readState, updateState } from "./state";
import type { Reconciliation, ReconRow } from "./types";

interface TransactionInfo {
  transaction_id?: string;
  transaction_event_code?: string;
  transaction_status?: string;
  transaction_amount?: { value?: string; currency_code?: string };
}

export async function reconcileWithPayPal(): Promise<Reconciliation> {
  const state = await readState();
  const rows: ReconRow[] = [];

  // 1. Payout batches (REST).
  for (const batch of state.batches) {
    let items: Awaited<ReturnType<typeof getPayoutBatch>>["items"] = [];
    let error: string | undefined;
    try {
      items = (await getPayoutBatch(batch.id, { batchId: batch.id, planId: batch.planId })).items ?? [];
    } catch (err) {
      error = err instanceof PayPalError ? err.message : "PayPal error";
    }
    for (const item of batch.items) {
      const doc = state.documents.find((d) => d.id === item.docId);
      const pp = items.find((i) => i.payout_item.sender_item_id === item.senderItemId);
      const paypalCents = pp ? fromDecimalString(pp.payout_item.amount.value) : null;
      const sameAmount = paypalCents === item.amountCents;
      const sameStatus = pp?.transaction_status === item.transactionStatus;
      rows.push({
        id: `payout-${batch.id}-${item.senderItemId}`,
        kind: "payout",
        counterparty: supplierById(doc?.review?.supplierId)?.name ?? item.receiver,
        reference: `${batch.id} · ${pp?.payout_item_id ?? item.payoutItemId ?? "item pending"}`,
        transactionId: pp?.transaction_id ?? item.transactionId ?? null,
        ledgerCents: item.amountCents,
        paypalCents,
        ledgerStatus: item.transactionStatus,
        paypalStatus: pp?.transaction_status ?? (error ? "unreachable" : "not found"),
        result: !pp ? "mismatch" : !sameAmount ? "mismatch" : sameStatus ? "match" : "pending",
        note: !pp
          ? error ?? "PayPal has no item for this payment in the batch"
          : !sameAmount
            ? `PayPal paid ${fmt(paypalCents)}, the ledger says ${fmt(item.amountCents)}`
            : sameStatus
              ? "Amount and status agree"
              : `PayPal is ahead of the ledger (${item.transactionStatus} → ${pp.transaction_status}); the payment run page syncs it`,
        listed: null,
      });
    }
  }

  // 2. Store orders and 3. the account transaction list (both through the toolkit).
  const window = reconcileWindow(state.batches.map((b) => b.createdAt).concat(state.orders.map((o) => o.createdAt)));
  let transactionSearch: Reconciliation["transactionSearch"] = { ok: false, count: 0, start: window.start, end: window.end, error: "Nothing to look up yet" };
  await withToolkit(async (tk) => {
    for (const order of state.orders) {
      const r = await tk.call("get_order", { id: order.id }, { ref: { orderId: order.id } });
      const f = r.ok ? orderFacts(r.data) : null;
      const sameAmount = f?.amountCents === order.totalCents && f?.currency === "EUR";
      const sameStatus = f?.status === order.status;
      const sameCapture = (f?.captureId ?? null) === (order.captureId ?? null);
      rows.push({
        id: `order-${order.id}`,
        kind: "order",
        counterparty: supplierById(order.supplierId)?.name ?? order.supplierId,
        reference: `${order.id}${f?.captureId ? ` · ${f.captureId}` : ""}`,
        transactionId: f?.captureId ?? order.captureId ?? null,
        ledgerCents: order.totalCents,
        paypalCents: f?.amountCents ?? null,
        ledgerStatus: order.status,
        paypalStatus: f ? `${f.status}${f.captureStatus ? ` · capture ${f.captureStatus}` : ""}` : "unreachable",
        result: !f ? "mismatch" : sameAmount && sameStatus && sameCapture ? "match" : !sameAmount ? "mismatch" : "pending",
        note: !f
          ? r.error ?? "PayPal did not return the order"
          : !sameAmount
            ? `PayPal shows ${f.currency} ${(f.amountCents ?? 0) / 100}, the ledger ${fmt(order.totalCents)}`
            : sameStatus && sameCapture
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
  await updateState((s) => {
    s.reconciliation = result;
    s.audit.push(
      auditEntry({
        actor: "system",
        message: `Reconciled the ledger with PayPal: ${result.totals.match} match, ${result.totals.pending} pending, ${result.totals.mismatch} mismatch${transactionSearch.ok ? `; ${transactionSearch.count} transactions in the account list` : ""}.`,
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
