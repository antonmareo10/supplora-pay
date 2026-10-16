// Run with: npm test   (Node's built-in test runner with type stripping)
import assert from "node:assert/strict";
import { test } from "node:test";
import { CATALOG, DELIVERY_NOTES, PAID_INVOICES, PRICE_HISTORY, SUPPLIERS } from "../data/seed.ts";
import { SAMPLE_INVOICES, printedTotals, type SampleInvoice } from "../data/samples.ts";
import { runChecks, type ReferenceData } from "./checks.ts";
import { fromDecimalString, pctOf, toCents, toDecimalString } from "./money.ts";
import type { Extraction } from "./types.ts";

const REF: ReferenceData = {
  suppliers: SUPPLIERS,
  catalog: CATALOG,
  priceHistory: PRICE_HISTORY,
  deliveryNotes: DELIVERY_NOTES,
  paidInvoices: PAID_INVOICES,
};
const CTX = { today: "2026-10-16", otherDocs: [], addedAt: "2026-10-16T08:00:00.000Z" };

/** A perfect transcription of a sample invoice, as Claude should return it. */
function perfect(inv: SampleInvoice): Extraction {
  const t = printedTotals(inv);
  const discount = /2\/10/.test(inv.terms) ? { percent: 2, within_days: 10 } : null;
  return {
    document_type: "invoice",
    language: inv.language,
    supplier_name: inv.supplierName,
    supplier_tax_id: inv.taxId,
    matched_supplier_id: inv.supplierId,
    payment_email: /[\w.]+@[\w.]+\.example/.exec(inv.payment)?.[0] ?? null,
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
    legibility: "clear",
  };
}

const sample = (id: string) => SAMPLE_INVOICES.find((s) => s.supplierId === id)!;

test("money helpers are exact", () => {
  assert.equal(toCents(28.2), 2820);
  assert.equal(toCents(0.95 * 25), 2375);
  assert.equal(pctOf(30550, 21), 6416);
  assert.equal(toDecimalString(113434), "1134.34");
  assert.equal(toDecimalString(5), "0.05");
  assert.equal(fromDecimalString("12.10"), 1210);
  assert.equal(fromDecimalString("7"), 700);
});

test("produce: line-total error is withheld with VAT", () => {
  const r = runChecks(perfect(sample("huerta-guadalhorce")), REF, CTX);
  assert.equal(r.recommendation, "pay_partial");
  assert.equal(r.invoiceCents, 16146);
  assert.equal(r.withheldCents, 312); // 3.00 + 4% VAT
  assert.equal(r.payableCents, 15834);
  const f = r.findings.find((x) => x.kind === "arithmetic");
  assert.ok(f, "arithmetic finding");
  assert.match(f.detail, /€25\.20/);
  assert.match(f.detail, /€28\.20/);
  assert.equal(r.deliveryNoteId, "dn-hg-1092");
});

test("fish: hake price rise is caught, calamari within tolerance is not", () => {
  const r = runChecks(perfect(sample("pescados-bahia")), REF, CTX);
  assert.equal(r.recommendation, "pay_partial");
  assert.equal(r.withheldCents, 2926); // 14 kg x 1.90 = 26.60 + 10% VAT
  assert.equal(r.payableCents, 58960 - 2926);
  const rises = r.findings.filter((x) => x.kind === "price_increase");
  assert.equal(rises.length, 1);
  assert.match(rises[0].title, /€13\.80/);
  assert.match(rises[0].title, /€11\.90/);
  assert.match(rises[0].title, /\+16\.0%/);
  assert.ok(r.findings.some((x) => x.kind === "due_soon"));
});

test("meat: short delivery against the signed delivery note", () => {
  const r = runChecks(perfect(sample("carnicas-sanz")), REF, CTX);
  assert.equal(r.recommendation, "pay_partial");
  assert.equal(r.withheldCents, 4070); // 2 kg x 18.50 = 37.00 + 10% VAT
  const f = r.findings.find((x) => x.kind === "quantity_mismatch")!;
  assert.match(f.detail, /AL-3307/);
  assert.equal(r.lineChecks[0].deliveredQty, 10);
});

test("dairy: reminder copy of an already-paid invoice is held", () => {
  const r = runChecks(perfect(sample("green-valley")), REF, CTX);
  assert.equal(r.recommendation, "hold");
  assert.equal(r.payableCents, 0);
  const f = r.findings.find((x) => x.kind === "duplicate")!;
  assert.match(f.detail, /TRF-20261009-114/);
  assert.equal(f.severity, "high");
});

test("drinks: 2/10 net 30 discount is offered with the exact saving", () => {
  const r = runChecks(perfect(sample("atlantic-wine")), REF, CTX);
  assert.equal(r.recommendation, "pay_full");
  assert.deepEqual(r.discount, { percent: 2, deadline: "2026-10-24", amountCents: 2315, available: true });
  assert.equal(r.dueDate, "2026-11-13");
  const expired = runChecks(perfect(sample("atlantic-wine")), REF, { ...CTX, today: "2026-10-25" });
  assert.equal(expired.discount?.available, false);
});

test("cleaning: the clean invoice has no findings", () => {
  const r = runChecks(perfect(sample("cleanpro")), REF, CTX);
  assert.equal(r.recommendation, "pay_full");
  assert.equal(r.findings.length, 0);
  assert.equal(r.payableCents, 36966);
});

test("unknown supplier and changed payment details are held", () => {
  const ex = perfect(sample("cleanpro"));
  const unknown = runChecks({ ...ex, matched_supplier_id: null, supplier_name: "Limpiezas Rápidas", supplier_tax_id: "B11111111" }, REF, CTX);
  assert.equal(unknown.recommendation, "hold");
  assert.ok(unknown.findings.some((f) => f.kind === "unknown_supplier"));
  const changed = runChecks({ ...ex, payment_email: "new-account@cleanpro-payments.example" }, REF, CTX);
  assert.equal(changed.recommendation, "hold");
  assert.ok(changed.findings.some((f) => f.kind === "payment_details_changed"));
});

test("a second copy in the inbox is held, the first is not", () => {
  const ex = perfect(sample("cleanpro"));
  const other = { docId: "a", addedAt: "2026-10-15T08:00:00.000Z", supplierId: "cleanpro", invoiceNumber: "CP-11902", totalCents: 36966 };
  const second = runChecks(ex, REF, { ...CTX, otherDocs: [other] });
  assert.equal(second.recommendation, "hold");
  const first = runChecks(ex, REF, { ...CTX, addedAt: "2026-10-14T08:00:00.000Z", otherDocs: [other] });
  assert.equal(first.recommendation, "pay_full");
});

test("short delivery and price rise on the same line do not double count", () => {
  const ex = perfect(sample("pescados-bahia"));
  const notes = DELIVERY_NOTES.map((n) =>
    n.id === "dn-pb-5521" ? { ...n, lines: n.lines.map((l) => (l.itemKey === "pb.merluza" ? { ...l, qty: 12 } : l)) } : n,
  );
  const r = runChecks(ex, { ...REF, deliveryNotes: notes }, CTX);
  // Fair: 12 kg x 11.90 = 142.80; printed 193.20 -> 50.40 net + 10% VAT = 55.44
  assert.equal(r.withheldCents, 5544);
});
