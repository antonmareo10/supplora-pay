// Run with: npm test   (Node's built-in test runner with type stripping)
// "Pay only for what arrived": the capture is decided in code from the order lines and the delivery note.
import assert from "node:assert/strict";
import { test } from "node:test";
import { nothingDelivered, orderHeldCents, orderPaidCents, orderPhase, planRefund, planSettlement, scriptedDamage, scriptedDelivery, SettlementError, unitGrossCents } from "./settlement.ts";
import { pctOf } from "./money.ts";
import type { CartLine, StoreOrder } from "./types.ts";

const line = (sku: string, qty: number, unitPriceCents: number, vatRate = 21): CartLine => {
  const unitVatCents = pctOf(unitPriceCents, vatRate);
  return { sku, name: sku, qty, unitPriceCents, vatRate, unitVatCents, netCents: unitPriceCents * qty, vatCents: unitVatCents * qty };
};

// The recorded restock run: 2 dishwasher detergents, 7 sanitisers, 3 boxes of gloves = €144.96 at CleanPro.
const ORDER = [line("CP-DW-20", 2, 3850), line("CP-SAN-750", 7, 320), line("CP-GLV-100", 3, 680)];
const TOTAL = ORDER.reduce((s, l) => s + l.netCents + l.vatCents, 0);

test("settlement: the recorded CleanPro order totals €144.96 and a full delivery captures exactly that", () => {
  assert.equal(TOTAL, 14496);
  const full = Object.fromEntries(ORDER.map((l) => [l.sku, l.qty]));
  const p = planSettlement(ORDER, TOTAL, full);
  assert.equal(p.action, "capture");
  assert.equal(p.captureCents, 14496);
  assert.equal(p.releaseCents, 0);
  assert.deepEqual(p.shortages, []);
});

test("settlement: the scripted delivery is one sanitiser short → capture €141.09, release €3.87", () => {
  const delivered = scriptedDelivery(ORDER);
  assert.deepEqual(delivered, { "CP-DW-20": 2, "CP-SAN-750": 6, "CP-GLV-100": 3 });
  const p = planSettlement(ORDER, TOTAL, delivered);
  assert.equal(unitGrossCents(ORDER[1]), 387); // €3.20 + 21% VAT
  assert.equal(p.action, "capture");
  assert.equal(p.captureCents, 14109);
  assert.equal(p.releaseCents, 387);
  assert.equal(p.captureCents + p.releaseCents, p.authorizedCents);
  assert.deepEqual(p.shortages, ["6 of 7 CP-SAN-750"]);
});

test("settlement: nothing arrived → void the whole authorization", () => {
  const p = planSettlement(ORDER, TOTAL, nothingDelivered(ORDER));
  assert.equal(p.action, "void");
  assert.equal(p.captureCents, 0);
  assert.equal(p.releaseCents, TOTAL);
});

test("settlement: refuses notes that would pay more than was ordered or authorized", () => {
  assert.throws(() => planSettlement(ORDER, TOTAL, { "CP-DW-20": 3, "CP-SAN-750": 7, "CP-GLV-100": 3 }), SettlementError); // more than ordered
  assert.throws(() => planSettlement(ORDER, TOTAL, { "CP-DW-20": 2, "CP-SAN-750": 7 }), SettlementError); // a line missing from the note
  assert.throws(() => planSettlement(ORDER, TOTAL, { "CP-DW-20": 2, "CP-SAN-750": 7, "CP-GLV-100": 3, "X-1": 1 }), SettlementError); // unknown SKU
  assert.throws(() => planSettlement(ORDER, TOTAL, { "CP-DW-20": 1.5, "CP-SAN-750": 7, "CP-GLV-100": 3 }), SettlementError); // fractional unit
  assert.throws(() => planSettlement(ORDER, TOTAL, { "CP-DW-20": -1, "CP-SAN-750": 7, "CP-GLV-100": 3 }), SettlementError);
  assert.throws(() => planSettlement(ORDER, TOTAL - 1, Object.fromEntries(ORDER.map((l) => [l.sku, l.qty]))), SettlementError); // over the hold
});

test("settlement: a single one-unit order that arrives short is voided", () => {
  const one = [line("X", 1, 1000)];
  assert.deepEqual(scriptedDelivery(one), { X: 0 });
  assert.equal(planSettlement(one, 1210, scriptedDelivery(one)).action, "void");
});

const base: StoreOrder = { id: "ORDER1", supplierId: "cleanpro", createdAt: "2026-10-21T10:00:00Z", source: "agent", lines: ORDER, netCents: 0, vatCents: 0, totalCents: TOTAL, status: "CREATED", intent: "AUTHORIZE" };

test("order phases: authorize → captured, and what each counts as paid or held", () => {
  assert.equal(orderPhase(base), "awaiting_approval");
  const authorized: StoreOrder = { ...base, status: "COMPLETED", authorization: { id: "AUTH1", status: "CREATED", amountCents: TOTAL, createdAt: "" } };
  assert.equal(orderPhase(authorized), "authorized");
  assert.equal(orderPaidCents(authorized), 0); // an authorization is not a payment
  assert.equal(orderHeldCents(authorized), TOTAL);
  assert.equal(orderPhase({ ...authorized, settlingSince: "x" }), "settling");
  const captured: StoreOrder = { ...authorized, authorization: { ...authorized.authorization!, status: "CAPTURED" }, captureId: "CAP1", captureStatus: "COMPLETED", capturedCents: 14109, releasedCents: 387 };
  assert.equal(orderPhase(captured), "captured");
  assert.equal(orderPaidCents(captured), 14109);
  assert.equal(orderHeldCents(captured), 0);
  const voided: StoreOrder = { ...authorized, authorization: { ...authorized.authorization!, status: "VOIDED" }, capturedCents: 0, releasedCents: TOTAL };
  assert.equal(orderPhase(voided), "voided");
  assert.equal(orderPaidCents(voided), 0);
});

test("order phases: the owner's checkout orders (intent CAPTURE, or older orders without intent) are paid at once", () => {
  const legacy: StoreOrder = { ...base, intent: undefined, status: "COMPLETED", captureId: "C", captureStatus: "COMPLETED" };
  assert.equal(orderPhase(legacy), "paid");
  assert.equal(orderPaidCents(legacy), TOTAL);
  assert.equal(orderPhase({ ...legacy, status: "CREATED", captureId: undefined, error: "declined" }), "failed");
});

// After the capture: the scripted delivery (one sanitiser short) was captured at €141.09.
const delivered = scriptedDelivery(ORDER);
const CAPTURED: StoreOrder = {
  ...base,
  status: "COMPLETED",
  authorization: { id: "AUTH1", status: "CAPTURED", amountCents: TOTAL, createdAt: "" },
  captureId: "CAP1AAAAAAA",
  captureStatus: "COMPLETED",
  capturedCents: 14109,
  releasedCents: 387,
  delivery: {
    noteNumber: "DN-1",
    receivedAt: "",
    receivedBy: "kitchen",
    scripted: true,
    lines: ORDER.map((l) => ({ sku: l.sku, name: l.name, ordered: l.qty, delivered: delivered[l.sku], unitGrossCents: unitGrossCents(l) })),
    confirmedCents: 14109,
  },
};

test("refunds: damaged goods are refunded at the order's unit price incl. VAT (one detergent: €46.59)", () => {
  const d = scriptedDamage(CAPTURED);
  assert.deepEqual(d && { sku: d.sku, qty: d.qty }, { sku: "CP-DW-20", qty: 1 }, "the most expensive delivered line");
  const r = planRefund(CAPTURED, "CP-DW-20", 1);
  assert.equal(r.amountCents, 3850 + 809);
  assert.equal(r.step, 0);
  const after: StoreOrder = { ...CAPTURED, refundedCents: r.amountCents, captureStatus: "PARTIALLY_REFUNDED", refunds: [{ id: "R1", status: "COMPLETED", amountCents: r.amountCents, at: "", source: "app", sku: "CP-DW-20", qty: 1, scripted: true }] };
  assert.equal(orderPhase(after), "captured");
  assert.equal(orderPaidCents(after), 14109 - 4659, "paid = captured − refunded");
  assert.equal(scriptedDamage(after), null, "the demo refunds once");
});

test("refunds: never more than was delivered on the line, never more than was captured, never before the capture", () => {
  assert.throws(() => planRefund(CAPTURED, "CP-SAN-750", 7), SettlementError, "7 ordered but only 6 delivered");
  assert.equal(planRefund(CAPTURED, "CP-SAN-750", 6).amountCents, 6 * (320 + 67));
  const twice: StoreOrder = { ...CAPTURED, refunds: [{ id: "R1", status: "COMPLETED", amountCents: 9318, at: "", source: "app", sku: "CP-DW-20", qty: 2 }], refundedCents: 9318 };
  assert.throws(() => planRefund(twice, "CP-DW-20", 1), SettlementError, "both detergents already refunded");
  assert.throws(() => planRefund({ ...CAPTURED, refundedCents: 14109 - 100 }, "CP-DW-20", 1), SettlementError, "over the captured total");
  assert.throws(() => planRefund({ ...CAPTURED, captureId: undefined, captureStatus: undefined, authorization: { ...CAPTURED.authorization!, status: "CREATED" } }, "CP-DW-20", 1), SettlementError);
  assert.throws(() => planRefund(CAPTURED, "CP-NOPE", 1), SettlementError);
  assert.throws(() => planRefund(CAPTURED, "CP-DW-20", 0), SettlementError);
});
