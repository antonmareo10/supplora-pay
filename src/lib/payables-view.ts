// View model for the AG Grid payables dashboard (/ledger).
//
// Pure, serializable projection of the app state: one row per reviewed invoice.
// Built on the server (readState) and handed to the client grid as plain JSON.
// No React and no Node APIs here so it can be imported from either side, and the
// numbers are computed the same way as ledgerStats() so the grid totals reconcile
// exactly with the KPI tiles above the grid.

import { supplierById } from "@/data/seed";
import { effective, FRAUD_HOLD_KINDS, isPaidOrSent, withholdableCents } from "@/lib/ap";
import { toCents } from "@/lib/money";
import { ACTION_LABEL, STATUS_LABEL, statusOf, type PayableStatus } from "@/lib/payables-status";
import type { AppState, PayAction, Severity } from "@/lib/types";
import { updatedByLabel, webhookSeenLabel } from "@/lib/webhook-events";

export type { PayableStatus } from "@/lib/payables-status";

export interface PayableRow {
  id: string;
  supplier: string;
  supplierId: string | null;
  category: string;
  invoiceNumber: string;
  status: PayableStatus;
  statusLabel: string;
  recommendation: PayAction;
  recommendationLabel: string;
  /** Owner overrode Claude's recommendation. */
  ownerDecision: boolean;
  /** What Claude and the rules recommended (the owner may have changed it). */
  recommended: PayAction;
  /** The owner's reason for changing the recommendation, as kept in the audit log. */
  ownerNote: string | null;
  /** A partial payment would withhold something (line overcharges); otherwise it is pay in full or hold. */
  partialAvailable: boolean;
  /** Sent to PayPal or being paid: the decision can no longer change. */
  locked: boolean;
  /** Held for possible fraud (unknown sender, changed payment details, instructions aimed at the AI). */
  fraudHold: boolean;
  /** For the accountant's export (libro de facturas recibidas). */
  supplierTaxId: string | null;
  invoiceDate: string | null;
  subtotalCents: number | null;
  vatCents: number | null;
  finding: string;
  findingSeverity: Severity | null;
  findingCount: number;
  /** Every finding with its evidence, most severe first (shown in the grid's tooltip). */
  findings: { title: string; severity: Severity; detail: string; withholdCents: number; impactCents: number }[];
  dueDate: string | null;
  invoiceCents: number;
  withheldCents: number;
  discountCents: number;
  /** Amount sent through PayPal Payouts, claimed or still UNCLAIMED (null when nothing has been sent yet). */
  paidCents: number | null;
  paypalBatchId: string | null;
  paypalItemId: string | null;
  /** Where the latest PayPal status came from: status poll, verified webhook or reconciliation. */
  paypalUpdatedBy: string | null;
  /** A verified PayPal webhook about this payout arrived (whether or not it changed the status). */
  paypalWebhook: string | null;
}

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2, opportunity: 3, info: 4 };

/** Build the payables rows from app state. Mirrors ledgerStats() so totals agree. */
export function buildPayableRows(state: AppState): PayableRow[] {
  const rows: PayableRow[] = [];
  for (const doc of state.documents) {
    const e = effective(doc);
    const r = doc.review;
    if (!e || !r) continue;

    const supplier = supplierById(r.supplierId);
    const status = statusOf(doc.payment.status, e.action, e.withheldCents);
    const paid = doc.payment.status === "paid" || doc.payment.status === "unclaimed";

    const findings = [...r.findings].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
    const top = findings[0];

    rows.push({
      id: doc.id,
      supplier: supplier?.name ?? r.extraction.supplier_name ?? "Unknown supplier",
      supplierId: r.supplierId,
      category: supplier?.category ?? "—",
      invoiceNumber: r.extraction.invoice_number ?? doc.fileName,
      status,
      statusLabel: STATUS_LABEL[status],
      recommendation: e.action,
      recommendationLabel: ACTION_LABEL[e.action],
      ownerDecision: e.byOwner,
      recommended: r.recommendation,
      ownerNote: e.byOwner ? (doc.decision?.note ?? null) : null,
      partialAvailable: withholdableCents(doc) > 0,
      locked: isPaidOrSent(doc),
      fraudHold: r.findings.some((f) => FRAUD_HOLD_KINDS.includes(f.kind)),
      supplierTaxId: supplier?.taxId ?? r.extraction.supplier_tax_id ?? null,
      invoiceDate: r.extraction.invoice_date ?? null,
      subtotalCents: r.extraction.subtotal != null ? toCents(r.extraction.subtotal) : null,
      vatCents: r.extraction.vat_total != null ? toCents(r.extraction.vat_total) : null,
      finding: top ? top.title : "No issues found",
      findingSeverity: top ? top.severity : null,
      findingCount: r.findings.length,
      findings: findings.slice(0, 6).map((f) => ({ title: f.title, severity: f.severity, detail: f.detail, withholdCents: f.withholdCents, impactCents: f.impactCents })),
      dueDate: r.dueDate,
      invoiceCents: e.invoiceCents,
      withheldCents: e.withheldCents,
      discountCents: doc.payment.discountCents ?? 0,
      // Money sent through PayPal (claimed or awaiting the supplier's claim), same rule as ledgerStats().
      paidCents: paid ? doc.payment.amountCents ?? null : null,
      paypalBatchId: doc.payment.batchId ?? null,
      paypalItemId: doc.payment.payoutItemId ?? null,
      paypalUpdatedBy: updatedByLabel(doc.payment.updatedBy),
      paypalWebhook: webhookSeenLabel(doc.payment.lastWebhook),
    });
  }
  return rows;
}
