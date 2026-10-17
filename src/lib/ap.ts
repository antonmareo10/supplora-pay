// Accounts-payable helpers shared by the server and the UI (no Node APIs here).

import type { AppState, DocumentRecord, FindingKind, PayAction } from "./types";

export const OVERCHARGE_KINDS: FindingKind[] = ["price_increase", "quantity_mismatch", "not_delivered", "arithmetic", "totals_mismatch"];

// Findings that mean "don't pay this at all" (hold). They never translate into a partial withholding,
// so an invoice whose only findings are these cannot be paid partially — it is pay-in-full or hold.
const HOLD_ONLY_KINDS: FindingKind[] = ["duplicate", "unknown_supplier", "payment_details_changed", "not_an_invoice", "currency"];

/** What a partial payment would withhold (line-level overcharges only), capped at the invoice. 0 ⇒ partial makes no sense. */
export function withholdableCents(doc: DocumentRecord): number {
  const r = doc.review;
  if (!r) return 0;
  const lineWithheld = r.findings.filter((f) => !HOLD_ONLY_KINDS.includes(f.kind)).reduce((s, f) => s + f.withholdCents, 0);
  return Math.min(r.invoiceCents, lineWithheld);
}

export const ACTION_LABEL: Record<PayAction, string> = {
  pay_full: "Pay in full",
  pay_partial: "Pay partial",
  hold: "Hold",
};

export interface Effective {
  action: PayAction;
  byOwner: boolean;
  invoiceCents: number;
  withheldCents: number;
  payableCents: number;
}

/** The action that will be used for payment: the owner's decision wins over Claude's review. */
export function effective(doc: DocumentRecord): Effective | null {
  const r = doc.review;
  if (!r) return null;
  const action = doc.decision?.action ?? r.recommendation;
  const byOwner = !!doc.decision && doc.decision.by === "owner" && doc.decision.action !== r.recommendation;
  if (action === "hold") return { action, byOwner, invoiceCents: r.invoiceCents, withheldCents: r.invoiceCents, payableCents: 0 };
  if (action === "pay_full") return { action, byOwner, invoiceCents: r.invoiceCents, withheldCents: 0, payableCents: r.invoiceCents };
  // Partial: withhold what the checks flagged (lines), never the whole invoice.
  const withheld = withholdableCents(doc);
  return { action, byOwner, invoiceCents: r.invoiceCents, withheldCents: withheld, payableCents: r.invoiceCents - withheld };
}

export function isSettled(doc: DocumentRecord): boolean {
  return ["paid", "unclaimed", "processing", "scheduled"].includes(doc.payment.status);
}

export function invoiceLabel(doc: DocumentRecord): string {
  return doc.review?.extraction.invoice_number ?? doc.fileName;
}

export interface LedgerStats {
  documents: number;
  reviewed: number;
  openPayableCents: number;
  paidCents: number;
  paidCount: number;
  heldCents: number;
  heldCount: number;
  withheldCents: number;
  disputedCount: number;
  overchargesCaughtCents: number;
  duplicatesBlockedCents: number;
  discountsCapturedCents: number;
  discountsAvailableCents: number;
  ordersCents: number;
  ordersCount: number;
  protectedCents: number;
}

export function ledgerStats(state: AppState, today: string): LedgerStats {
  const s: LedgerStats = {
    documents: state.documents.length,
    reviewed: 0,
    openPayableCents: 0,
    paidCents: 0,
    paidCount: 0,
    heldCents: 0,
    heldCount: 0,
    withheldCents: 0,
    disputedCount: 0,
    overchargesCaughtCents: 0,
    duplicatesBlockedCents: 0,
    discountsCapturedCents: 0,
    discountsAvailableCents: 0,
    ordersCents: 0,
    ordersCount: 0,
    protectedCents: 0,
  };
  for (const doc of state.documents) {
    const e = effective(doc);
    if (!e || !doc.review) continue;
    s.reviewed++;
    const paid = doc.payment.status === "paid" || doc.payment.status === "unclaimed";
    if (paid) {
      s.paidCents += doc.payment.amountCents ?? 0;
      s.paidCount++;
      s.discountsCapturedCents += doc.payment.discountCents ?? 0;
    } else if (e.action !== "hold" && !isSettled(doc)) {
      s.openPayableCents += e.payableCents;
      const d = doc.review.discount;
      if (d?.available && d.deadline >= today) s.discountsAvailableCents += d.amountCents;
    }
    if (e.action === "hold") {
      s.heldCents += e.invoiceCents;
      s.heldCount++;
      if (doc.review.findings.some((f) => f.kind === "duplicate")) s.duplicatesBlockedCents += e.invoiceCents;
    } else if (e.withheldCents > 0) {
      s.withheldCents += e.withheldCents;
      s.disputedCount++;
    }
    if (e.action !== "pay_full") {
      s.overchargesCaughtCents += doc.review.findings
        .filter((f) => OVERCHARGE_KINDS.includes(f.kind))
        .reduce((a, f) => a + f.withholdCents, 0);
    }
  }
  for (const o of state.orders) {
    if (o.status === "COMPLETED") {
      s.ordersCents += o.totalCents;
      s.ordersCount++;
    }
  }
  s.protectedCents = s.overchargesCaughtCents + s.duplicatesBlockedCents + s.discountsCapturedCents;
  return s;
}

export function lowStock(state: AppState) {
  return state.inventory.filter((i) => i.onHand < i.par);
}
