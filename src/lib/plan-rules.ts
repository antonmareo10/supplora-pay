// The payment agent's plan check (its propose_payment_plan tool): every open invoice paid or
// deferred exactly once, held invoices never paid, discounts only when still available, the total
// within the cash cap, and every amount computed here, not by the model.
//
// Also what the agent is allowed to read about a document: invoice references are reduced to plain
// characters, so free text printed on an invoice never reaches the agent's context.
//
// Pure (no Node or Next APIs) so it can be unit-tested with Node's test runner, and run on the
// review page to show what the tool answers when asked to pay a held invoice.

import { fmt } from "./money.ts";
import type { DeferredPayment, PaymentPlan, PlannedPayment } from "./types.ts";

export interface PlanCandidate {
  docId: string;
  supplierId: string;
  supplierName: string;
  invoiceNumber: string;
  dueDate: string | null;
  invoiceCents: number;
  withheldCents: number;
  payableCents: number;
  /** Early-payment discount still available, in cents (null when none). */
  discountCents: number | null;
}

export interface ProposalInput {
  payments: { invoice_id: string; take_early_payment_discount: boolean; reason: string }[];
  deferred: { invoice_id: string; reason: string }[];
}

export interface ProposalCheck {
  errors: string[];
  payments: PlannedPayment[];
  deferred: DeferredPayment[];
  totals: PaymentPlan["totals"];
}

export function validateProposal(input: ProposalInput, open: PlanCandidate[], heldIds: string[], capCents: number): ProposalCheck {
  const errors: string[] = [];
  const seen = new Set<string>();
  const payments: PlannedPayment[] = [];
  const deferred: DeferredPayment[] = [];
  for (const p of input.payments) {
    const o = open.find((x) => x.docId === p.invoice_id);
    if (heldIds.includes(p.invoice_id)) errors.push(`${p.invoice_id} is held and must not be paid.`);
    else if (!o) errors.push(`${p.invoice_id} is not an open payable invoice.`);
    if (seen.has(p.invoice_id)) errors.push(`${p.invoice_id} appears more than once.`);
    seen.add(p.invoice_id);
    if (!o) continue;
    if (p.take_early_payment_discount && o.discountCents == null) errors.push(`${o.invoiceNumber} has no early-payment discount available.`);
    if (!p.reason.trim()) errors.push(`Give a reason for ${o.invoiceNumber}.`);
    const discountCents = p.take_early_payment_discount && o.discountCents != null ? o.discountCents : 0;
    payments.push({
      docId: o.docId,
      supplierId: o.supplierId,
      supplierName: o.supplierName,
      invoiceNumber: o.invoiceNumber,
      dueDate: o.dueDate,
      invoiceCents: o.invoiceCents,
      withheldCents: o.withheldCents,
      discountCents,
      amountCents: o.payableCents - discountCents,
      reason: p.reason.trim(),
      status: "proposed",
    });
  }
  for (const d of input.deferred) {
    const o = open.find((x) => x.docId === d.invoice_id);
    if (!o) {
      if (!heldIds.includes(d.invoice_id)) errors.push(`${d.invoice_id} is not an open payable invoice.`);
      continue;
    }
    if (seen.has(d.invoice_id)) errors.push(`${o.invoiceNumber} is both paid and deferred (or listed twice).`);
    seen.add(d.invoice_id);
    deferred.push({ docId: o.docId, supplierName: o.supplierName, invoiceNumber: o.invoiceNumber, amountCents: o.payableCents, reason: d.reason.trim() });
  }
  for (const o of open) if (!seen.has(o.docId)) errors.push(`${o.invoiceNumber} (${o.docId}) is missing: pay it or defer it.`);
  const payCents = payments.reduce((s, p) => s + p.amountCents, 0);
  if (payCents > capCents) errors.push(`Total ${fmt(payCents)} exceeds the cash cap of ${fmt(capCents)} by ${fmt(payCents - capCents)}.`);
  if (!payments.length && open.length) errors.push("The plan pays nothing although invoices are open.");
  return {
    errors,
    payments,
    deferred,
    totals: {
      payCents,
      discountCents: payments.reduce((s, p) => s + p.discountCents, 0),
      withheldCents: payments.reduce((s, p) => s + p.withheldCents, 0),
      deferredCents: deferred.reduce((s, d) => s + d.amountCents, 0),
      headroomCents: capCents - payCents,
    },
  };
}

/**
 * An invoice reference as the agent may see it: letters, digits and the separators invoice numbers
 * use (no spaces), at most 24 characters. Anything else printed in the field (say, a sentence
 * addressed to the agent) is dropped.
 */
export function agentRef(value: string | null | undefined): string | null {
  const clean = (value ?? "").replace(/[^A-Za-z0-9/._-]/g, "").slice(0, 24);
  return clean || null;
}
