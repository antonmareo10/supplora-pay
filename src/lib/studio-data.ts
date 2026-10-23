// Data for the AG Studio ledger (/ledger/studio): the app state as related tables.
//
// Pure and serializable, like payables-view.ts: built on the server from readState() and handed to
// the client as plain JSON, where ledger-studio/data.ts declares the fields, relationships and
// calendar for AG Studio. Money is in euros (two decimals) because Studio formats numbers; the
// amounts come from the same helpers as ledgerStats(), so Studio's totals agree with the KPI tiles.

// Relative .ts imports so Node's test runner can load it (studio-data.test.ts).
import { CATALOG, PRICE_HISTORY, RESTAURANT, supplierById } from "../data/seed.ts";
import { effective, isPaidOrSent } from "./ap.ts";
import { daysBetween } from "./dates.ts";
import { ACTION_LABEL, STATUS_LABEL, STATUS_ORDER, statusOf } from "./payables-status.ts";
import { orderPaidCents, orderPhase } from "./settlement.ts";
import type { AppState, FindingKind, Severity, StatusUpdate } from "./types.ts";

export interface StudioInvoice {
  id: string;
  number: string;
  supplierId: string;
  /** Payables status, worded as on /ledger ("Held", "Pay partial", "Sent · awaiting claim", …). */
  status: string;
  /** Most urgent first, for sorting. */
  statusRank: number;
  decision: string;
  decidedBy: string;
  invoiceDate: string | null;
  dueDate: string | null;
  /** Where the invoice stands against the business date: "Overdue", "Due within 7 days", … */
  dueWindow: string;
  /** Days until due (negative when overdue); null when settled or undated. */
  daysToDue: number | null;
  /** Monday of the week the invoice falls due (ISO date), for "by week" views. */
  dueWeek: string | null;
  /** The same week as a label that sorts in time order: "W43 · 19 Oct". */
  dueWeekLabel: string | null;
  invoiced: number;
  /** Line overcharges withheld on a partial payment, until the supplier sends a credit note. */
  withheld: number;
  /** The whole invoice when it is on hold (nothing paid). */
  held: number;
  /** Still to pay through PayPal (0 once sent, or when held). */
  toPay: number;
  /** Sent through PayPal Payouts (claimed or awaiting the supplier's claim). */
  sent: number;
  discount: number;
  topFinding: string;
  findings: number;
  paypalBatch: string | null;
  paypalItem: string | null;
  /** Path of the invoice's review page. */
  link: string;
}

export interface StudioFinding {
  id: string;
  invoiceId: string;
  kind: string;
  severity: string;
  severityRank: number;
  title: string;
  detail: string;
  evidence: string;
  atStake: number;
  withhold: number;
  source: string;
}

export interface StudioSupplier {
  id: string;
  name: string;
  category: string;
  terms: string;
  /** False for a sender that is not one of the restaurant's suppliers (a possible fake invoice). */
  known: boolean;
}

export interface StudioPayout {
  id: string;
  invoiceId: string;
  supplierId: string;
  batch: string;
  item: string | null;
  status: string;
  amount: number;
  sentAt: string;
  confirmedBy: string;
}

export interface StudioOrder {
  id: string;
  supplierId: string;
  placedBy: string;
  status: string;
  authorized: number;
  captured: number;
  released: number;
  refunded: number;
  createdAt: string;
}

export interface StudioPrice {
  id: string;
  supplierId: string;
  item: string;
  unit: string;
  date: string;
  unitPrice: number;
  /** Earlier invoice in the price history, or the invoice in this week's inbox. */
  source: string;
  ref: string;
}

export interface StudioPriceChange {
  id: string;
  invoiceId: string;
  supplierId: string;
  item: string;
  unit: string;
  /** Unit price on the last earlier invoice. */
  before: number;
  beforeRef: string;
  /** Unit price on this week's invoice. */
  now: number;
  ref: string;
  change: number;
  /** Change as a fraction of the earlier price (0.05 = 5 %). */
  changePct: number;
}

export interface StudioTables {
  asOf: string;
  restaurant: { name: string; city: string; owner: string };
  invoices: StudioInvoice[];
  findings: StudioFinding[];
  suppliers: StudioSupplier[];
  payouts: StudioPayout[];
  orders: StudioOrder[];
  prices: StudioPrice[];
  priceChanges: StudioPriceChange[];
}

const euros = (cents: number | null | undefined): number => Math.round(cents ?? 0) / 100;

export const FINDING_KIND_LABEL: Record<FindingKind, string> = {
  duplicate: "Duplicate invoice",
  possible_duplicate: "Possible duplicate",
  unknown_supplier: "Unknown sender",
  payment_details_changed: "Changed payment details",
  suspicious_instruction: "Instructions aimed at the AI",
  not_an_invoice: "Not an invoice",
  currency: "Wrong currency",
  price_increase: "Price rise",
  quantity_mismatch: "Short delivery",
  not_delivered: "Not delivered",
  arithmetic: "Arithmetic error",
  totals_mismatch: "Totals don't add up",
  no_delivery_note: "No delivery note",
  early_payment_discount: "Early-payment discount",
  due_soon: "Due soon",
  overdue: "Overdue",
  observation: "Note on the document",
};

const SEVERITY_LABEL: Record<Severity, string> = { high: "High", medium: "Medium", low: "Low", info: "Info", opportunity: "Saving" };
const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2, opportunity: 3, info: 4 };

const CONFIRMED_BY: Record<StatusUpdate["source"], string> = {
  app: "Payouts API",
  poll: "Status poll",
  webhook: "Verified webhook",
  reconcile: "Reconciliation",
};

/** Monday of the ISO week of a date ("2026-10-22" → "2026-10-19"). */
export function weekOf(day: string | null): string | null {
  if (!day) return null;
  const d = new Date(`${day}T00:00:00Z`);
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** ISO week label that sorts in time order within a year: "W43 · 19 Oct" (week starting Monday 19 Oct). */
export function weekLabel(day: string | null): string | null {
  const monday = weekOf(day);
  if (!monday) return null;
  const d = new Date(`${monday}T00:00:00Z`);
  // ISO week number: the week with the year's first Thursday is week 1.
  const thursday = new Date(d);
  thursday.setUTCDate(d.getUTCDate() + 3);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `W${String(week).padStart(2, "0")} · ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** Where an open invoice stands against the business date. */
export function dueWindow(today: string, due: string | null, settled: boolean): { window: string; days: number | null } {
  if (settled) return { window: "Paid or sent", days: null };
  if (!due) return { window: "No due date", days: null };
  const days = daysBetween(today, due);
  if (days < 0) return { window: "Overdue", days };
  if (days <= 7) return { window: "Due within 7 days", days };
  if (days <= 14) return { window: "Due in 8 to 14 days", days };
  return { window: "Due later", days };
}

function orderStatusLabel(phase: ReturnType<typeof orderPhase>): string {
  switch (phase) {
    case "awaiting_approval":
      return "Awaiting approval";
    case "approving":
      return "Approving";
    case "authorized":
      return "Authorized, awaiting delivery";
    case "settling":
      return "Settling";
    case "captured":
      return "Paid for what arrived";
    case "voided":
      return "Nothing arrived, released";
    case "paid":
      return "Paid";
    case "refunded":
      return "Refunded";
    default:
      return "Payment failed";
  }
}

export function buildStudioTables(state: AppState, today: string): StudioTables {
  const invoices: StudioInvoice[] = [];
  const findings: StudioFinding[] = [];
  const unknownSenders = new Map<string, StudioSupplier>();
  const invoicePrices: StudioPrice[] = [];

  for (const doc of state.documents) {
    const e = effective(doc);
    const r = doc.review;
    if (!e || !r) continue;

    // A sender that is not a known supplier still gets a row, so its invoice joins to a name.
    let supplierId = r.supplierId;
    if (!supplierId || !supplierById(supplierId)) {
      const name = r.extraction.supplier_name?.trim() || "Unknown sender";
      supplierId = `unknown:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`;
      if (!unknownSenders.has(supplierId)) {
        unknownSenders.set(supplierId, { id: supplierId, name: `${name} (not a supplier on file)`, category: "unknown", terms: "—", known: false });
      }
    }

    const status = statusOf(doc.payment.status, e.action, e.withheldCents);
    const sentToPayPal = doc.payment.status === "paid" || doc.payment.status === "unclaimed";
    const settled = isPaidOrSent(doc);
    const { window, days } = dueWindow(today, r.dueDate, settled);
    const sortedFindings = [...r.findings].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
    const number = r.extraction.invoice_number ?? doc.fileName;

    invoices.push({
      id: doc.id,
      number,
      supplierId,
      status: STATUS_LABEL[status],
      statusRank: STATUS_ORDER.indexOf(status),
      decision: ACTION_LABEL[e.action],
      decidedBy: e.byOwner ? "Owner" : "Checks and Claude",
      invoiceDate: r.extraction.invoice_date ?? null,
      dueDate: r.dueDate,
      dueWindow: window,
      daysToDue: days,
      dueWeek: weekOf(r.dueDate),
      dueWeekLabel: weekLabel(r.dueDate),
      invoiced: euros(e.invoiceCents),
      withheld: e.action === "hold" ? 0 : euros(e.withheldCents),
      held: e.action === "hold" ? euros(e.invoiceCents) : 0,
      toPay: settled || e.action === "hold" ? 0 : euros(e.payableCents),
      sent: sentToPayPal ? euros(doc.payment.amountCents) : 0,
      discount: sentToPayPal ? euros(doc.payment.discountCents) : 0,
      topFinding: sortedFindings[0]?.title ?? "No issues found",
      findings: r.findings.length,
      paypalBatch: doc.payment.batchId ?? null,
      paypalItem: doc.payment.payoutItemId ?? null,
      link: `/inbox/${doc.id}`,
    });

    for (const f of r.findings) {
      findings.push({
        id: `${doc.id}:${f.id}`,
        invoiceId: doc.id,
        kind: FINDING_KIND_LABEL[f.kind] ?? f.kind,
        severity: SEVERITY_LABEL[f.severity],
        severityRank: SEVERITY_RANK[f.severity],
        title: f.title,
        detail: f.detail,
        evidence: f.evidence.map((x) => `${x.label}: ${x.value}`).join(" · "),
        atStake: euros(f.impactCents),
        withhold: euros(f.withholdCents),
        source: f.source === "rule" ? "Rule" : "Claude",
      });
    }

    // What this week's invoice charges per item, next to the earlier prices.
    const date = r.extraction.invoice_date ?? doc.addedAt.slice(0, 10);
    r.extraction.lines.forEach((line, i) => {
      const item = line.matched_item_key ? CATALOG.find((c) => c.key === line.matched_item_key) : undefined;
      if (!item || !(line.unit_price > 0) || item.supplierId !== supplierId) return;
      invoicePrices.push({
        id: `${doc.id}:line-${i}`,
        supplierId,
        item: item.name,
        unit: item.unit,
        date,
        unitPrice: Math.round(line.unit_price * 100) / 100,
        source: "This week's invoice",
        ref: number,
      });
    });
  }

  const suppliers: StudioSupplier[] = [];
  for (const id of new Set(invoices.map((i) => i.supplierId).concat(state.orders.map((o) => o.supplierId)))) {
    const s = supplierById(id);
    if (s) suppliers.push({ id: s.id, name: s.name, category: s.category, terms: s.termsLabel, known: true });
  }
  suppliers.push(...unknownSenders.values());
  // Price history for every supplier on file, so the price chart has a past to compare against.
  for (const h of PRICE_HISTORY) {
    if (!suppliers.some((s) => s.id === h.supplierId)) {
      const s = supplierById(h.supplierId);
      if (s) suppliers.push({ id: s.id, name: s.name, category: s.category, terms: s.termsLabel, known: true });
    }
  }

  const prices: StudioPrice[] = PRICE_HISTORY.flatMap((h) => {
    const item = CATALOG.find((c) => c.key === h.itemKey);
    return h.points.map((p, i) => ({
      id: `${h.itemKey}:${i}`,
      supplierId: h.supplierId,
      item: item?.name ?? h.itemKey,
      unit: item?.unit ?? "",
      date: p.date,
      unitPrice: euros(p.unitPriceCents),
      source: "Earlier invoice",
      ref: p.ref,
    }));
  }).concat(invoicePrices);

  // This week's price per item against the last earlier invoice for the same item.
  const priceChanges: StudioPriceChange[] = [];
  for (const p of invoicePrices) {
    const item = CATALOG.find((c) => c.supplierId === p.supplierId && c.name === p.item);
    const history = item ? PRICE_HISTORY.find((h) => h.itemKey === item.key) : undefined;
    const earlier = history?.points.filter((pt) => pt.date < p.date).at(-1);
    if (!earlier) continue;
    const before = euros(earlier.unitPriceCents);
    const change = Math.round((p.unitPrice - before) * 100) / 100;
    priceChanges.push({
      id: p.id,
      invoiceId: p.id.split(":")[0],
      supplierId: p.supplierId,
      item: p.item,
      unit: p.unit,
      before,
      beforeRef: earlier.ref,
      now: p.unitPrice,
      ref: p.ref,
      change,
      changePct: before > 0 ? Math.round((change / before) * 10000) / 10000 : 0,
    });
  }

  const payouts: StudioPayout[] = [];
  for (const b of state.batches) {
    for (const item of b.items) {
      const inv = invoices.find((i) => i.id === item.docId);
      payouts.push({
        id: `${b.id}:${item.senderItemId}`,
        invoiceId: item.docId,
        supplierId: inv?.supplierId ?? "unknown",
        batch: b.id,
        item: item.payoutItemId ?? null,
        status: item.transactionStatus,
        amount: euros(item.amountCents),
        sentAt: b.createdAt,
        confirmedBy: item.updatedBy ? CONFIRMED_BY[item.updatedBy.source] : "Payouts API",
      });
    }
  }

  const orders: StudioOrder[] = state.orders.map((o) => ({
    id: o.id,
    supplierId: o.supplierId,
    placedBy: o.source === "agent" ? "Purchasing agent" : "Owner",
    status: orderStatusLabel(orderPhase(o)),
    authorized: euros(o.authorization?.amountCents),
    captured: euros(orderPaidCents(o)),
    released: euros(o.releasedCents),
    refunded: euros(o.refundedCents),
    createdAt: o.createdAt,
  }));

  return {
    asOf: today,
    restaurant: { name: RESTAURANT.name, city: "Málaga", owner: RESTAURANT.owner },
    invoices,
    findings,
    suppliers,
    payouts,
    orders,
    prices,
    priceChanges,
  };
}
