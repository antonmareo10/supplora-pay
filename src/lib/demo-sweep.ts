// Public demo (DEMO_MODE) housekeeping: give unclaimed sandbox payouts back to the demo account.
//
// Demo payees are placeholder addresses, so every payout item ends UNCLAIMED and PayPal would hold
// the money for 30 days: a few judges clicking through would lock the sandbox balance. Every batch
// the demo sends is registered at creation (state.ts, same backend as the sessions); this sweep reads
// each registered batch from PayPal and cancels its UNCLAIMED items, which returns the money at once.
// A batch leaves the registry once none of its items can still change (all cancelled, claimed,
// returned or failed). Visitors' own ledgers are not rewritten: a reconciliation in that session
// shows the item as returned on PayPal's side.
//
// Pure (PayPal and storage are injected) so it can be unit-tested with Node's test runner.

import { fromDecimalString } from "./money.ts";
import type { PayoutBatchResponse } from "./paypal.ts";

export interface DemoPayoutEntry {
  batchId: string;
  /** The visitor session (state key) that sent it. */
  key: string;
  /** When the batch was created (ms since epoch). */
  at: number;
  cents: number;
}

export interface SweepDeps {
  list(): Promise<DemoPayoutEntry[]>;
  forget(batchId: string): Promise<void>;
  getBatch(entry: DemoPayoutEntry): Promise<PayoutBatchResponse>;
  cancelItem(itemId: string, cents: number, entry: DemoPayoutEntry): Promise<void>;
  now(): number;
}

export interface SweepOptions {
  /** Only batches at least this old (ms). */
  minAgeMs: number;
  /** Extra filter, e.g. one session's batches on Reset demo. */
  only?: (entry: DemoPayoutEntry) => boolean;
  /** Bound on PayPal calls per sweep: at most this many batches (oldest first). */
  maxBatches?: number;
}

export interface SweepResult {
  /** Batches in the registry, and those old enough (and matching `only`) for this sweep. */
  listed: number;
  due: number;
  checked: number;
  cancelled: number;
  cents: number;
  forgotten: number;
  errors: number;
  /** Cancels PayPal refused for good (4xx): the item was claimed or cancelled already, or cannot be cancelled. */
  rejected: number;
}

/** Old enough that PayPal has returned any unclaimed money itself (30 days), so stop tracking it. */
export const REGISTRY_MAX_AGE_MS = 31 * 24 * 60 * 60 * 1000;
const BATCH_MOVING = ["PENDING", "PROCESSING", "NEW"];
const ITEM_MOVING = ["PENDING", "ONHOLD", "NEW"];

/** A 4xx from PayPal is final for this item or batch (already cancelled, claimed, not found); 408/429 are worth retrying. */
function isFinalRejection(err: unknown): boolean {
  const status = (err as { status?: unknown })?.status;
  return typeof status === "number" && status >= 400 && status < 500 && status !== 408 && status !== 429;
}

function amountCents(value: string | undefined): number {
  try {
    return value ? fromDecimalString(value) : 0;
  } catch {
    return 0;
  }
}

export async function sweepDemoPayouts(deps: SweepDeps, opts: SweepOptions): Promise<SweepResult> {
  const r: SweepResult = { listed: 0, due: 0, checked: 0, cancelled: 0, cents: 0, forgotten: 0, errors: 0, rejected: 0 };
  const now = deps.now();
  const registered = await deps.list();
  const eligible = registered.filter((e) => now - e.at >= opts.minAgeMs && (!opts.only || opts.only(e)));
  r.listed = registered.length;
  r.due = eligible.length;
  const due = eligible.sort((a, b) => a.at - b.at).slice(0, opts.maxBatches ?? 10);

  for (const entry of due) {
    if (now - entry.at > REGISTRY_MAX_AGE_MS) {
      await deps.forget(entry.batchId);
      r.forgotten++;
      continue;
    }
    r.checked++;
    let batch: PayoutBatchResponse;
    try {
      batch = await deps.getBatch(entry);
    } catch (err) {
      if (isFinalRejection(err)) {
        await deps.forget(entry.batchId);
        r.forgotten++;
      } else r.errors++;
      continue;
    }
    let stillOpen = BATCH_MOVING.includes(batch.batch_header?.batch_status ?? "PENDING");
    for (const item of batch.items ?? []) {
      if (item.transaction_status === "UNCLAIMED") {
        const cents = amountCents(item.payout_item?.amount?.value);
        try {
          await deps.cancelItem(item.payout_item_id, cents, entry);
          r.cancelled++;
          r.cents += cents;
        } catch (err) {
          // Already cancelled or claimed: nothing left to recover. Anything else: try again next sweep.
          if (!isFinalRejection(err)) {
            stillOpen = true;
            r.errors++;
          } else r.rejected++;
        }
      } else if (ITEM_MOVING.includes(item.transaction_status)) {
        stillOpen = true;
      }
    }
    if (!stillOpen) {
      await deps.forget(entry.batchId);
      r.forgotten++;
    }
  }
  return r;
}
