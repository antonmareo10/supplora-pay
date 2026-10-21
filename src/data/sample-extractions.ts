// Test fixtures: a perfect transcription of each sample invoice, as Claude should return it (the
// recorded real readings live in src/data/recorded/reviews.json). Used by the unit tests only.

import { printedTotals, type SampleInvoice } from "./samples.ts";
import type { Extraction } from "../lib/types.ts";

export function perfectExtraction(inv: SampleInvoice): Extraction {
  const t = printedTotals(inv);
  const discount = /2\/10/.test(inv.terms) ? { percent: 2, within_days: 10 } : null;
  return {
    document_type: "invoice",
    language: inv.language,
    supplier_name: inv.supplierName,
    supplier_tax_id: inv.taxId,
    matched_supplier_id: inv.supplierId,
    payment_email: /[\w.-]+@[\w.-]+\.example/.exec(inv.payment)?.[0] ?? null,
    invoice_number: inv.number,
    invoice_date: inv.date,
    due_date: inv.dueDate,
    payment_terms: inv.terms,
    early_payment_discount: discount,
    delivery_note_refs: [inv.deliveryRef],
    currency: "EUR",
    lines: inv.lines.map((l, i) => ({
      description: l.description,
      matched_item_key: l.itemKey,
      quantity: l.qty,
      unit: l.unit,
      unit_price: l.unitPrice,
      line_total: t.lineCents[i] / 100,
      vat_rate_percent: l.vat,
    })),
    subtotal: t.subtotal / 100,
    vat_total: t.vatTotal / 100,
    total: t.total / 100,
    observations: [],
    // What the prompt asks Claude to do with fine print addressed to the AI: copy it verbatim, as data.
    embedded_instructions: inv.finePrint ? [inv.finePrint] : [],
    legibility: "clear",
  };
}
