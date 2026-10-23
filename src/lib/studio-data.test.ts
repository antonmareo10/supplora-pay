// Run with: npm test   (Node's built-in test runner with type stripping)
// The AG Studio tables must agree with the ledger's KPI tiles (ledgerStats), so a total in Studio
// never contradicts the number above the grid on /ledger.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ledgerStats } from "./ap.ts";
import { buildStudioTables, dueWindow } from "./studio-data.ts";
import type { AppState, DocumentRecord } from "./types.ts";

const extraction = (number: string, supplier: string, lines: { key: string; price: number }[] = []) => ({
  invoice_number: number,
  invoice_date: "2026-10-14",
  supplier_name: supplier,
  lines: lines.map((l) => ({ description: l.key, matched_item_key: l.key, quantity: 1, unit: "kg", unit_price: l.price, line_total: l.price, vat_rate_percent: 10 })),
});

const doc = (
  id: string,
  supplierId: string | null,
  invoiceCents: number,
  recommendation: string,
  findings: { kind: string; severity?: string; withholdCents: number; impactCents?: number }[],
  payment: Record<string, unknown>,
  lines: { key: string; price: number }[] = [],
): DocumentRecord =>
  ({
    id,
    fileName: `${id}.png`,
    addedAt: "2026-10-16T07:05:00.000Z",
    review: {
      supplierId,
      invoiceCents,
      recommendation,
      dueDate: "2026-10-20",
      discount: null,
      findings: findings.map((f, i) => ({
        id: `f${i}`,
        kind: f.kind,
        severity: f.severity ?? "high",
        title: f.kind,
        detail: `${f.kind} detail`,
        impactCents: f.impactCents ?? f.withholdCents,
        withholdCents: f.withholdCents,
        evidence: [{ label: "Delivered", value: "2 kg" }],
        source: "rule",
      })),
      extraction: extraction(`INV-${id}`, supplierId ? "Known S.L." : "Fake Seafood Ltd", lines),
    },
    payment,
  }) as unknown as DocumentRecord;

const state = {
  documents: [
    doc("a", "pescados-bahia", 56034, "pay_partial", [{ kind: "price_increase", withholdCents: 2926 }], { status: "unpaid" }, [{ key: "pb.gamba", price: 36.0 }]),
    doc("b", "cleanpro", 36966, "pay_full", [], { status: "unclaimed", amountCents: 36966, batchId: "BATCH1", payoutItemId: "ITEM1" }),
    doc("c", "green-valley", 27471, "hold", [{ kind: "duplicate", withholdCents: 0, impactCents: 27471 }], { status: "unpaid" }),
    doc("d", null, 22433, "hold", [{ kind: "suspicious_instruction", withholdCents: 0, impactCents: 22433 }], { status: "unpaid" }),
    { id: "e", fileName: "e.png", reviewStatus: "pending", payment: { status: "unpaid" } } as unknown as DocumentRecord,
  ],
  batches: [],
  orders: [],
} as unknown as AppState;

const sum = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) * 100);

test("studio tables: one invoice row per reviewed document, totals match ledgerStats", () => {
  const t = buildStudioTables(state, "2026-10-16");
  const s = ledgerStats(state, "2026-10-16");
  assert.equal(t.invoices.length, 4);
  assert.equal(sum(t.invoices.map((i) => i.toPay)), s.openPayableCents);
  assert.equal(sum(t.invoices.map((i) => i.withheld)), s.withheldCents);
  assert.equal(sum(t.invoices.map((i) => i.held)), s.heldCents);
  assert.equal(sum(t.invoices.map((i) => i.sent)), s.sentCents);
});

test("studio tables: a held invoice is held in full, never also counted as withheld or to pay", () => {
  const c = buildStudioTables(state, "2026-10-16").invoices.find((i) => i.id === "c")!;
  assert.equal(c.held, 274.71);
  assert.equal(c.withheld, 0);
  assert.equal(c.toPay, 0);
  assert.equal(c.decision, "Hold");
});

test("studio tables: a sender that is not a supplier on file still joins to a named row", () => {
  const t = buildStudioTables(state, "2026-10-16");
  const d = t.invoices.find((i) => i.id === "d")!;
  const sender = t.suppliers.find((s) => s.id === d.supplierId)!;
  assert.equal(sender.known, false);
  assert.match(sender.name, /Fake Seafood Ltd \(not a supplier on file\)/);
});

test("studio tables: findings carry their evidence and money, labelled for people", () => {
  const f = buildStudioTables(state, "2026-10-16").findings.find((x) => x.invoiceId === "a")!;
  assert.equal(f.kind, "Price rise");
  assert.equal(f.withhold, 29.26);
  assert.equal(f.evidence, "Delivered: 2 kg");
});

test("studio tables: sent invoices keep their PayPal ids and leave nothing to pay", () => {
  const b = buildStudioTables(state, "2026-10-16").invoices.find((i) => i.id === "b")!;
  assert.equal(b.sent, 369.66);
  assert.equal(b.toPay, 0);
  assert.equal(b.paypalBatch, "BATCH1");
  assert.equal(b.dueWindow, "Paid or sent");
});

test("studio tables: this week's price is compared with the last earlier invoice", () => {
  const change = buildStudioTables(state, "2026-10-16").priceChanges.find((p) => p.item === "Gamba blanca de Huelva")!;
  // Price history: 33.50 then 34.00 on 6 Oct; this week's invoice charges 36.00.
  assert.equal(change.before, 34);
  assert.equal(change.now, 36);
  assert.equal(change.change, 2);
  assert.equal(change.changePct, 0.0588);
});

test("dueWindow: overdue, this week, next week, later, settled", () => {
  assert.deepEqual(dueWindow("2026-10-16", "2026-10-14", false), { window: "Overdue", days: -2 });
  assert.deepEqual(dueWindow("2026-10-16", "2026-10-23", false), { window: "Due within 7 days", days: 7 });
  assert.deepEqual(dueWindow("2026-10-16", "2026-10-30", false), { window: "Due in 8 to 14 days", days: 14 });
  assert.deepEqual(dueWindow("2026-10-16", "2026-11-20", false), { window: "Due later", days: 35 });
  assert.deepEqual(dueWindow("2026-10-16", "2026-10-14", true), { window: "Paid or sent", days: null });
  assert.deepEqual(dueWindow("2026-10-16", null, false), { window: "No due date", days: null });
});
