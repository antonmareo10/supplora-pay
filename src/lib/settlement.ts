// "Pay only for what arrived": how a purchasing-agent order settles against its delivery note.
//
// The agent's restock orders are PayPal orders with intent AUTHORIZE. The owner's approval puts a
// hold on the card on file for the order total; nothing is taken yet. When the signed delivery note
// comes back, the code below decides, line by line, how much of the hold to capture:
//   - every delivered unit is paid at the price the order was placed at (net + VAT per unit, the
//     same integer cents PayPal was sent), never more than ordered;
//   - something arrived: one final capture for exactly that amount (final_capture=true, so PayPal
//     releases the rest of the authorization back to the card);
//   - nothing arrived: the authorization is voided.
// No model is involved: the amounts come from the order lines and the delivery note.
//
// Pure (no Node or Next APIs) so it can be unit-tested with Node's test runner.

import { fmt } from "./money.ts";
import type { CartLine, StoreOrder } from "./types.ts";

/** One unit incl. VAT, exactly as the order priced it for PayPal. */
export function unitGrossCents(line: CartLine): number {
  return line.unitPriceCents + line.unitVatCents;
}

export class SettlementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettlementError";
  }
}

export interface SettlementLine {
  sku: string;
  name: string;
  ordered: number;
  delivered: number;
  unitGrossCents: number;
  confirmedCents: number;
}

export interface SettlementPlan {
  action: "capture" | "void";
  authorizedCents: number;
  captureCents: number;
  releaseCents: number;
  lines: SettlementLine[];
  /** Short owner-facing summary, e.g. "6 of 7 Food-safe sanitiser". */
  shortages: string[];
}

/**
 * Decide the capture from the delivered quantities (by SKU). Every ordered line must be on the
 * note (0 when it did not arrive); quantities are whole units between 0 and what was ordered.
 */
export function planSettlement(lines: CartLine[], authorizedCents: number, delivered: Record<string, number>): SettlementPlan {
  if (!lines.length) throw new SettlementError("The order has no lines.");
  const skus = new Set(lines.map((l) => l.sku));
  for (const sku of Object.keys(delivered)) {
    if (!skus.has(sku)) throw new SettlementError(`The delivery note lists ${sku}, which is not on this order.`);
  }
  const out: SettlementLine[] = lines.map((l) => {
    const qty = delivered[l.sku];
    if (qty === undefined) throw new SettlementError(`The delivery note has no quantity for ${l.sku}.`);
    if (!Number.isInteger(qty) || qty < 0) throw new SettlementError(`Delivered quantity for ${l.sku} must be a whole number ≥ 0.`);
    if (qty > l.qty) throw new SettlementError(`The delivery note shows ${qty} × ${l.sku} but only ${l.qty} were ordered; extra units are not paid through this order.`);
    const unit = unitGrossCents(l);
    return { sku: l.sku, name: l.name, ordered: l.qty, delivered: qty, unitGrossCents: unit, confirmedCents: unit * qty };
  });
  const captureCents = out.reduce((s, l) => s + l.confirmedCents, 0);
  if (captureCents > authorizedCents) {
    throw new SettlementError(`The delivered goods (${fmt(captureCents)}) exceed the authorized ${fmt(authorizedCents)}; nothing was captured.`);
  }
  return {
    action: captureCents > 0 ? "capture" : "void",
    authorizedCents,
    captureCents,
    releaseCents: authorizedCents - captureCents,
    lines: out,
    shortages: out.filter((l) => l.delivered < l.ordered).map((l) => `${l.delivered} of ${l.ordered} ${l.name}`),
  };
}

/**
 * The public demo's scripted delivery: everything arrives except one unit of the line with the
 * most units (ties: the first such line). Deterministic, so the demo shows the same partial
 * capture every time; the UI labels it as scripted.
 */
export function scriptedDelivery(lines: CartLine[]): Record<string, number> {
  const delivered: Record<string, number> = Object.fromEntries(lines.map((l) => [l.sku, l.qty]));
  const short = lines.reduce<CartLine | null>((best, l) => (!best || l.qty > best.qty ? l : best), null);
  if (short) delivered[short.sku] = short.qty - 1;
  return delivered;
}

/** Nothing arrived: every line at zero. */
export function nothingDelivered(lines: CartLine[]): Record<string, number> {
  return Object.fromEntries(lines.map((l) => [l.sku, 0]));
}

export type OrderPhase =
  | "awaiting_approval"
  | "approving"
  | "authorized"
  | "settling"
  | "captured"
  | "voided"
  | "paid"
  | "refunded"
  | "failed";

const CAPTURED = ["COMPLETED", "PENDING", "PARTIALLY_REFUNDED"];

/** Where an order stands, whatever its intent. */
export function orderPhase(o: StoreOrder): OrderPhase {
  if (o.intent === "AUTHORIZE") {
    const auth = o.authorization;
    if (o.captureId && o.captureStatus === "REFUNDED") return "refunded";
    if (o.captureId && CAPTURED.includes(o.captureStatus ?? "")) return "captured";
    if (o.captureId && ["DECLINED", "FAILED"].includes(o.captureStatus ?? "")) return "failed";
    if (auth?.status === "VOIDED") return "voided";
    if (auth && ["CREATED", "PENDING", "PARTIALLY_CAPTURED"].includes(auth.status)) return o.settlingSince ? "settling" : "authorized";
    if (auth?.status === "CAPTURED") return "captured";
    if (auth?.status === "DENIED" || (o.error && !auth && o.status !== "CREATED")) return "failed";
    if (o.status === "CREATED") return o.error ? "failed" : "awaiting_approval";
    if (o.status === "APPROVED") return "approving";
    return o.error ? "failed" : "approving";
  }
  if (o.status === "COMPLETED") return o.captureStatus === "REFUNDED" ? "refunded" : "paid";
  if (o.error) return "failed";
  if (o.status === "CREATED") return "awaiting_approval";
  return "approving";
}

/** Money actually taken for an order (captured, less anything refunded), in cents. */
export function orderPaidCents(o: StoreOrder): number {
  const phase = orderPhase(o);
  if (o.intent === "AUTHORIZE") return phase === "captured" ? Math.max(0, (o.capturedCents ?? 0) - (o.refundedCents ?? 0)) : 0;
  return phase === "paid" ? Math.max(0, o.totalCents - (o.refundedCents ?? 0)) : 0;
}

/** Money on hold on the card (authorized, waiting for the delivery note), in cents. */
export function orderHeldCents(o: StoreOrder): number {
  const phase = orderPhase(o);
  return o.intent === "AUTHORIZE" && (phase === "authorized" || phase === "settling") ? (o.authorization?.amountCents ?? 0) : 0;
}

/** An approved order: authorized, settled or paid (shown in order history, counted in the ledger). */
export function orderApproved(o: StoreOrder): boolean {
  return ["authorized", "settling", "captured", "voided", "paid", "refunded"].includes(orderPhase(o));
}

// ---------------------------------------------------------------------------
// After the capture: goods that arrived damaged are refunded on the capture, never more than what was
// delivered and paid for that line, and never more than was captured in total.

/** Units of a line already refunded on this order. */
function refundedUnits(o: StoreOrder, sku: string): number {
  return (o.refunds ?? []).filter((r) => r.sku === sku && r.status !== "FAILED" && r.status !== "CANCELLED").reduce((s, r) => s + (r.qty ?? 0), 0);
}

export interface RefundPlan {
  sku: string;
  name: string;
  qty: number;
  amountCents: number;
  /** The n-th refund on this line (0-based): part of the idempotency key, so a retry never refunds twice. */
  step: number;
}

/**
 * Plan a refund for damaged units of one line of a captured order. Amounts are the order's own unit
 * prices incl. VAT (the cents PayPal was sent).
 */
export function planRefund(o: StoreOrder, sku: string, qty: number): RefundPlan {
  if (o.intent !== "AUTHORIZE" || !o.captureId || orderPhase(o) !== "captured") throw new SettlementError("Only goods that were delivered and captured can be refunded.");
  const line = o.lines.find((l) => l.sku === sku);
  if (!line) throw new SettlementError(`${sku} is not on this order.`);
  if (!Number.isInteger(qty) || qty < 1) throw new SettlementError("Refund at least one whole unit.");
  const delivered = o.delivery?.lines.find((l) => l.sku === sku)?.delivered ?? 0;
  const already = refundedUnits(o, sku);
  if (qty > delivered - already) {
    throw new SettlementError(`Only ${Math.max(0, delivered - already)} × ${line.name} can still be refunded (${delivered} delivered, ${already} refunded).`);
  }
  const amountCents = unitGrossCents(line) * qty;
  const captured = o.capturedCents ?? 0;
  if ((o.refundedCents ?? 0) + amountCents > captured) throw new SettlementError(`Refunds would exceed the ${fmt(captured)} captured.`);
  return { sku, name: line.name, qty, amountCents, step: (o.refunds ?? []).filter((r) => r.sku === sku).length };
}

/**
 * The public demo's scripted damage report: one unit of the most expensive line that was delivered
 * arrived damaged (ties: the first). Null when nothing can be refunded any more.
 */
export function scriptedDamage(o: StoreOrder): { sku: string; qty: number; reason: string } | null {
  if (o.intent !== "AUTHORIZE" || orderPhase(o) !== "captured" || !o.delivery) return null;
  const candidates = o.lines.filter((l) => (o.delivery!.lines.find((d) => d.sku === l.sku)?.delivered ?? 0) - refundedUnits(o, l.sku) > 0);
  const line = candidates.reduce<CartLine | null>((best, l) => (!best || unitGrossCents(l) > unitGrossCents(best) ? l : best), null);
  if (!line || (o.refunds ?? []).some((r) => r.scripted)) return null;
  return { sku: line.sku, qty: 1, reason: `1 × ${line.name} arrived damaged (container split)` };
}
