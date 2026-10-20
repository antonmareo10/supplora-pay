// Domain model for Supplora Pay. All money is integer cents (see money.ts).

export type SupplierCategory = "produce" | "fish" | "meat" | "dairy" | "drinks" | "cleaning";

export interface Supplier {
  id: string;
  name: string;
  category: SupplierCategory;
  language: "es" | "en";
  taxId: string;
  address: string;
  contactName: string;
  email: string;
  phone: string;
  /** PayPal account that receives payouts (sandbox test address in this demo). */
  paypalEmail: string;
  terms: { netDays: number; discount?: { percent: number; withinDays: number } };
  termsLabel: string;
  /** What the owner told us about this supplier; the payment agent reads it. */
  relationship: string;
  store?: { tagline: string; accent: string; leadTime: string };
}

/** A product a supplier sells to the restaurant, as known from past purchases. */
export interface CatalogItem {
  key: string;
  supplierId: string;
  name: string;
  unit: string;
  vatRate: number;
}

export interface PricePoint {
  date: string;
  unitPriceCents: number;
  ref: string;
}

export interface PriceHistory {
  supplierId: string;
  itemKey: string;
  points: PricePoint[];
}

/** Signed delivery note (albarán) as captured by Supplora at the kitchen door. */
export interface DeliveryNote {
  id: string;
  supplierId: string;
  number: string;
  date: string;
  receivedBy: string;
  lines: { itemKey: string; description: string; qty: number; unit: string }[];
}

export interface PaidInvoice {
  supplierId: string;
  invoiceNumber: string;
  amountCents: number;
  paidAt: string;
  method: "bank_transfer" | "paypal";
  reference: string;
}

export interface StoreProduct {
  sku: string;
  supplierId: string;
  name: string;
  pack: string;
  unitPriceCents: number;
  vatRate: number;
  inStock: number;
}

export interface InventoryItem {
  key: string;
  name: string;
  unit: string;
  onHand: number;
  par: number;
  supplierId: string;
  sku: string;
}

// ---------------------------------------------------------------------------
// What Claude reads off a supplier document (transcribed exactly as printed).

export interface ExtractedLine {
  description: string;
  matched_item_key: string | null;
  quantity: number;
  unit: string;
  unit_price: number;
  line_total: number;
  vat_rate_percent: number | null;
}

export interface Extraction {
  document_type: "invoice" | "credit_note" | "delivery_note" | "receipt" | "other";
  language: string;
  supplier_name: string;
  supplier_tax_id: string | null;
  matched_supplier_id: string | null;
  payment_email: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  payment_terms: string | null;
  early_payment_discount: { percent: number; within_days: number } | null;
  delivery_note_refs: string[];
  currency: string;
  lines: ExtractedLine[];
  subtotal: number | null;
  vat_total: number | null;
  total: number;
  observations: { text: string; severity: "info" | "warning" }[];
  legibility: "clear" | "partly_legible" | "poor";
}

// ---------------------------------------------------------------------------
// Review outcome

export type Severity = "high" | "medium" | "low" | "info" | "opportunity";

export type FindingKind =
  | "duplicate"
  | "possible_duplicate"
  | "unknown_supplier"
  | "payment_details_changed"
  | "not_an_invoice"
  | "currency"
  | "price_increase"
  | "quantity_mismatch"
  | "not_delivered"
  | "arithmetic"
  | "totals_mismatch"
  | "no_delivery_note"
  | "early_payment_discount"
  | "due_soon"
  | "overdue"
  | "observation";

export interface Finding {
  id: string;
  kind: FindingKind;
  severity: Severity;
  title: string;
  detail: string;
  /** Money at stake (overcharge, duplicate amount or saving), cents incl. VAT. */
  impactCents: number;
  /** Part of the invoice we should not pay until resolved, cents incl. VAT. */
  withholdCents: number;
  lineIndex?: number;
  evidence: { label: string; value: string }[];
  source: "rule" | "claude";
}

export type PayAction = "pay_full" | "pay_partial" | "hold";

export interface LineCheck {
  index: number;
  status: "ok" | "price_up" | "qty_short" | "not_delivered" | "math" | "unmatched";
  deliveredQty: number | null;
  lastPriceCents: number | null;
}

export interface ReviewOutcome {
  supplierId: string | null;
  deliveryNoteId: string | null;
  findings: Finding[];
  lineChecks: LineCheck[];
  recommendation: PayAction;
  invoiceCents: number;
  withheldCents: number;
  payableCents: number;
  dueDate: string | null;
  discount: { percent: number; deadline: string; amountCents: number; available: boolean } | null;
  summary: string;
}

export interface ReviewRecord extends ReviewOutcome {
  reviewedAt: string;
  model: string;
  durationMs: number;
  cached: boolean;
  extraction: Extraction;
}

export type PaymentStatus = "unpaid" | "scheduled" | "processing" | "paid" | "unclaimed" | "failed" | "returned";

export interface DocumentRecord {
  id: string;
  origin: "sample" | "upload";
  fileName: string;
  mimeType: string;
  /** Where the browser can load the original file. */
  url: string;
  addedAt: string;
  reviewStatus: "pending" | "reviewing" | "reviewed" | "failed";
  reviewError?: string;
  review?: ReviewRecord;
  decision?: { action: PayAction; by: "agent" | "owner"; at: string; note?: string };
  payment: {
    status: PaymentStatus;
    amountCents?: number;
    discountCents?: number;
    planId?: string;
    batchId?: string;
    payoutItemId?: string;
    transactionId?: string;
    at?: string;
    error?: string;
  };
  dispute?: {
    status: "drafted" | "sent" | "resolved";
    subject: string;
    body: string;
    to: string;
    language: "es" | "en";
    createdAt: string;
    sentAt?: string;
  };
}

// ---------------------------------------------------------------------------
// Payment run

export interface PlannedPayment {
  docId: string;
  supplierId: string;
  supplierName: string;
  invoiceNumber: string;
  dueDate: string | null;
  invoiceCents: number;
  withheldCents: number;
  discountCents: number;
  amountCents: number;
  reason: string;
  status: "proposed" | "sending" | "processing" | "paid" | "unclaimed" | "failed" | "cancelled";
  batchId?: string;
  payoutItemId?: string;
  error?: string;
}

export interface DeferredPayment {
  docId: string;
  supplierName: string;
  invoiceNumber: string;
  amountCents: number;
  reason: string;
}

export interface PaymentPlan {
  id: string;
  createdAt: string;
  today: string;
  status: "awaiting_approval" | "partially_paid" | "completed" | "superseded";
  cashCapCents: number;
  payments: PlannedPayment[];
  deferred: DeferredPayment[];
  totals: { payCents: number; discountCents: number; withheldCents: number; deferredCents: number; headroomCents: number };
  summary: string;
  messageToOwner: string;
  agentLog: AgentEvent[];
}

export interface PayoutBatchRecord {
  id: string;
  senderBatchId: string;
  planId: string;
  createdAt: string;
  status: string;
  totalCents: number;
  feesCents?: number;
  completedAt?: string;
  lastPolledAt?: string;
  items: {
    docId: string;
    senderItemId: string;
    receiver: string;
    amountCents: number;
    payoutItemId?: string;
    transactionId?: string;
    transactionStatus: string;
    errorName?: string;
  }[];
}

// ---------------------------------------------------------------------------
// Agentic reorder

export interface CartLine {
  sku: string;
  name: string;
  qty: number;
  unitPriceCents: number;
  vatRate: number;
  unitVatCents: number;
  netCents: number;
  vatCents: number;
  reason?: string;
}

export interface StoreOrder {
  id: string;
  supplierId: string;
  createdAt: string;
  source: "agent" | "owner";
  proposalId?: string;
  lines: CartLine[];
  netCents: number;
  vatCents: number;
  totalCents: number;
  /** PayPal order status: CREATED, APPROVED, COMPLETED, VOIDED... */
  status: string;
  captureId?: string;
  captureStatus?: string;
  cardLabel?: string;
  error?: string;
  received?: boolean;
}

export interface RestockProposal {
  id: string;
  createdAt: string;
  status: "awaiting_approval" | "paying" | "completed" | "failed" | "declined";
  limitCents: number;
  orderIds: string[];
  totalCents: number;
  summary: string;
  agentLog: AgentEvent[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Audit log

export interface ApiCallInfo {
  method: string;
  endpoint: string;
  status: number;
  ok: boolean;
  durationMs: number;
  resourceId?: string;
  requestId?: string;
  debugId?: string;
  error?: string;
  /** Set when the call went through the official PayPal Agent Toolkit (MCP) instead of our REST client. */
  via?: "toolkit";
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: "claude" | "agent" | "owner" | "paypal" | "system";
  message: string;
  api?: ApiCallInfo;
  ref?: { docId?: string; planId?: string; batchId?: string; orderId?: string; proposalId?: string };
  amountCents?: number;
}

// ---------------------------------------------------------------------------
// Ledger reconciliation (read-only comparison with PayPal)

export interface ReconRow {
  id: string;
  kind: "payout" | "order";
  counterparty: string;
  reference: string;
  /** PayPal transaction id (capture id or payout item transaction id) when known. */
  transactionId: string | null;
  ledgerCents: number;
  paypalCents: number | null;
  ledgerStatus: string;
  paypalStatus: string;
  result: "match" | "pending" | "mismatch";
  note: string;
  /** Found in the account's transaction list (toolkit list_transactions); null when not checked. */
  listed: boolean | null;
}

export interface Reconciliation {
  at: string;
  rows: ReconRow[];
  transactionSearch: { ok: boolean; count: number; start: string; end: string; error?: string };
  totals: { match: number; pending: number; mismatch: number };
}

export interface Settings {
  cashCapCents: number;
  restockLimitCents: number;
}

export interface AppState {
  version: 1;
  createdAt: string;
  settings: Settings;
  documents: DocumentRecord[];
  plans: PaymentPlan[];
  batches: PayoutBatchRecord[];
  proposals: RestockProposal[];
  orders: StoreOrder[];
  inventory: InventoryItem[];
  cardOnFile?: { vaultId: string; brand: string; last4: string; createdAt: string };
  reconciliation?: Reconciliation;
  audit: AuditEntry[];
}

// ---------------------------------------------------------------------------
// Streaming agent events (NDJSON from the agent routes)

export type AgentEvent =
  | { type: "note"; text: string }
  /** Not from Claude: how this run is produced (demo replay or the deterministic fallback). */
  | { type: "info"; text: string; tone: "replay" | "fallback" }
  | { type: "tool_start"; id: string; tool: string; label: string }
  | { type: "tool_end"; id: string; tool: string; summary: string; error?: boolean }
  | { type: "result"; kind: "plan" | "proposal"; id: string }
  | { type: "error"; message: string }
  | { type: "done"; elapsedMs: number };
