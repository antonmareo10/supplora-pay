// Display helpers for the reconciliation grid (pure, import-free, so the client grid and the tests can use them).
//
// The grid has to fit a 1280 px laptop, so PayPal ids are stacked one per line under the payment they belong
// to, and the ledger's status and PayPal's share one column: shown once when they agree, both when they differ.

/** One PayPal id with what it is ("batch", "item", "order", "auth", "capture"). */
export interface RefPart {
  label: string;
  id: string;
}

/**
 * Splits a reconciliation reference into labelled ids, one per line:
 * "BATCH · ITEM" for a payout, "ORDER · auth AUTH · capture CAPTURE" for a store order (see lib/reconcile.ts).
 */
export function referenceParts(kind: "payout" | "order", reference: string): RefPart[] {
  const parts = reference
    .split(" · ")
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.map((part, i) => {
    const labelled = /^([a-z]+) (.+)$/.exec(part);
    if (labelled) return { label: labelled[1], id: labelled[2] };
    if (i === 0) return { label: kind === "payout" ? "batch" : "order", id: part };
    return { label: kind === "payout" && i === 1 ? "item" : "", id: part };
  });
}

/** A status line per part: "auth CAPTURED · capture COMPLETED" → ["auth CAPTURED", "capture COMPLETED"]. */
export function statusLines(status: string): string[] {
  const lines = status
    .split(" · ")
    .map((s) => s.trim())
    .filter(Boolean);
  return lines.length ? lines : ["—"];
}

export interface StatusView {
  /** The ledger and PayPal report the same status. */
  agree: boolean;
  ledger: string[];
  paypal: string[];
}

/** The ledger's status next to PayPal's: one value when they agree, both when they differ. */
export function statusView(ledgerStatus: string, paypalStatus: string): StatusView {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toUpperCase();
  return { agree: norm(ledgerStatus) === norm(paypalStatus), ledger: statusLines(ledgerStatus), paypal: statusLines(paypalStatus) };
}
