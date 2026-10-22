// PayPal's Cart API (agentic commerce, v1), merchant side, for the suppliers' trade stores.
//
// The Cart API is the contract a merchant exposes so that AI agents can shop with it:
//   POST /merchant-cart                     create a cart: the store validates and prices it and creates the PayPal order
//   GET  /merchant-cart/{cart_id}           read it
//   PUT  /merchant-cart/{cart_id}           replace its contents (a full replacement, re-validated)
//   POST /merchant-cart/{cart_id}/checkout  complete it once the buyer's payment is approved
// Every answer is a cart: status (CREATED, INCOMPLETE, READY, COMPLETED), validation_status (VALID,
// INVALID, REQUIRES_ADDITIONAL_INFORMATION), validation_issues the agent has to resolve (code, type,
// user_message, field, resolution_options), items and totals priced by the store, and
// payment_method.token, the PayPal order id. Failures come back as { name, message, debug_id, details }.
//
// Both supplier stores in this demo implement it (src/app/api/paypal/v1/stores/[supplier]/merchant-cart),
// and the purchasing agent's create_checkout shops through it (store-carts.ts). This file is the pure
// part: request parsing, the store's own pricing and validation, totals, the response and the checkout
// decision. Unit-tested in cart-api.test.ts. Field names follow PayPal's published schema as mirrored by
// WooCommerce's open-source Store Sync module (woocommerce-paypal-payments, modules/ppcp-store-sync).

import { pctOf, toDecimalString } from "./money.ts";
import type { CartLine, StoreProduct, Supplier } from "./types.ts";

export const CART_STATUSES = ["CREATED", "INCOMPLETE", "READY", "COMPLETED"] as const;
export type CartStatus = (typeof CART_STATUSES)[number];
export const VALIDATION_STATUSES = ["VALID", "INVALID", "REQUIRES_ADDITIONAL_INFORMATION"] as const;
export type ValidationStatus = (typeof VALIDATION_STATUSES)[number];

export type IssueCode = "INVENTORY_ISSUE" | "PRICING_ERROR" | "SHIPPING_ERROR" | "DATA_ERROR" | "BUSINESS_RULE_ERROR" | "PAYMENT_ERROR";
export type IssueType = "BUSINESS_RULE" | "INVALID_DATA" | "MISSING_FIELD";
export type ResolutionAction = "MODIFY_CART" | "ACCEPT_NEW_PRICE" | "REMOVE_ITEM" | "USE_DIFFERENT_CURRENCY" | "SPLIT_ORDER" | "REQUEST_APPROVAL";
export type CartErrorName = "INVALID_REQUEST" | "CART_NOT_FOUND" | "UNPROCESSABLE_ENTITY" | "INTERNAL_SERVER_ERROR";

export interface Money {
  currency_code: string;
  value: string;
}

export interface ResolutionOption {
  action: ResolutionAction;
  label: string;
}

export interface CartIssue {
  code: IssueCode;
  type: IssueType;
  message: string;
  user_message?: string;
  field?: string;
  item_id?: string;
  resolution_options?: ResolutionOption[];
}

/** One line of the agent's request, before the store has looked at it. */
export interface RequestedItem {
  index: number;
  variant_id: unknown;
  quantity: unknown;
  price: unknown;
}

/** A cart as the store keeps it. */
export interface StoreCart {
  id: string;
  supplierId: string;
  /** "agent": our purchasing agent's create_checkout; "api": any other caller of the public endpoints. */
  source: "agent" | "api";
  createdAt: string;
  updatedAt: string;
  /** Bumped by every replacement (PUT); each revision that needs a new payment gets a new PayPal order. */
  revision: number;
  status: CartStatus;
  validationStatus: ValidationStatus;
  issues: CartIssue[];
  lines: CartLine[];
  /** The PayPal order id (payment_method.token), once the cart was valid and the store created the order. */
  paymentToken?: string;
  merchantOrderNumber?: string;
  completedAt?: string;
}

export const MAX_CART_LINES = 20;
export const MAX_LINE_QTY = 50;
export const CART_CURRENCY = "EUR";

/** A request the store cannot even read: answered with the error envelope, not with a cart. */
export class CartApiError extends Error {
  readonly status: number;
  readonly errorName: CartErrorName;
  readonly details?: CartIssue[];
  constructor(errorName: CartErrorName, message: string, status: number, details?: CartIssue[]) {
    super(message);
    this.errorName = errorName;
    this.status = status;
    this.details = details;
  }
}

/** The error envelope: name, message, a debug id to find the log line, and details when there are any. */
export function cartErrorBody(err: CartApiError, debugId: string) {
  return { name: err.errorName, message: err.message, debug_id: debugId, ...(err.details?.length ? { details: err.details } : {}) };
}

export function isCartId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

export function newCartId(): string {
  return `cart_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

const money = (cents: number): Money => ({ currency_code: CART_CURRENCY, value: toDecimalString(cents) });

/** Reads the request body. Only a body that is not a cart at all is rejected outright (400); everything else becomes a validation issue. */
export function parseCartRequest(body: unknown): RequestedItem[] {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new CartApiError("INVALID_REQUEST", "The request body must be a cart object.", 400);
  const items = (body as { items?: unknown }).items;
  if (items === undefined) return [];
  if (!Array.isArray(items)) throw new CartApiError("INVALID_REQUEST", "items must be an array.", 400);
  return items.map((raw, index) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new CartApiError("INVALID_REQUEST", `items[${index}] must be an object.`, 400);
    const item = raw as Record<string, unknown>;
    return { index, variant_id: item.variant_id, quantity: item.quantity, price: item.price };
  });
}

function issue(code: IssueCode, type: IssueType, message: string, extra: Omit<CartIssue, "code" | "type" | "message"> = {}): CartIssue {
  return { code, type, message, user_message: extra.user_message ?? message, ...extra };
}

/**
 * The store prices and validates the cart itself: prices, VAT and stock come from the store's
 * catalog, never from the caller. A price the caller assumed is only compared (a mismatch is a
 * PRICING_ERROR the agent has to accept), never charged.
 */
export function priceStoreCart(supplier: Supplier, products: StoreProduct[], items: RequestedItem[]): { lines: CartLine[]; issues: CartIssue[] } {
  const issues: CartIssue[] = [];
  const lines: CartLine[] = [];
  if (!items.length) {
    issues.push(issue("DATA_ERROR", "MISSING_FIELD", "The cart has no items.", { field: "items", resolution_options: [{ action: "MODIFY_CART", label: "Add at least one item" }] }));
  }
  if (items.length > MAX_CART_LINES) {
    issues.push(
      issue("BUSINESS_RULE_ERROR", "BUSINESS_RULE", `At most ${MAX_CART_LINES} different products per order.`, {
        field: "items",
        resolution_options: [{ action: "SPLIT_ORDER", label: "Split into smaller orders" }],
      }),
    );
  }
  const seen = new Set<string>();
  for (const item of items) {
    const field = `items[${item.index}]`;
    if (typeof item.variant_id !== "string" || !item.variant_id.trim()) {
      issues.push(issue("DATA_ERROR", "MISSING_FIELD", "Each item needs a variant_id (the store SKU).", { field: `${field}.variant_id`, resolution_options: [{ action: "REMOVE_ITEM", label: "Remove the item" }] }));
      continue;
    }
    const sku = item.variant_id.trim();
    const product = products.find((p) => p.sku === sku && p.supplierId === supplier.id);
    if (!product) {
      issues.push(
        issue("INVENTORY_ISSUE", "INVALID_DATA", `SKU ${sku} is not sold by ${supplier.name}.`, {
          field: `${field}.variant_id`,
          item_id: sku,
          resolution_options: [{ action: "REMOVE_ITEM", label: "Remove the item" }],
        }),
      );
      continue;
    }
    if (seen.has(sku)) {
      issues.push(issue("DATA_ERROR", "INVALID_DATA", `SKU ${sku} appears twice.`, { field, item_id: sku, resolution_options: [{ action: "MODIFY_CART", label: "Merge the two lines" }] }));
      continue;
    }
    seen.add(sku);
    const qty = item.quantity;
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1 || qty > MAX_LINE_QTY) {
      issues.push(
        issue("DATA_ERROR", "INVALID_DATA", `Quantity for ${sku} must be a whole number from 1 to ${MAX_LINE_QTY}.`, {
          field: `${field}.quantity`,
          item_id: sku,
          resolution_options: [{ action: "MODIFY_CART", label: "Change the quantity" }],
        }),
      );
      continue;
    }
    if (qty > product.inStock) {
      issues.push(
        issue("INVENTORY_ISSUE", "BUSINESS_RULE", `${supplier.name} only has ${product.inStock} of ${sku} in stock.`, {
          field: `${field}.quantity`,
          item_id: sku,
          resolution_options: [{ action: "MODIFY_CART", label: `Order ${product.inStock} or fewer` }],
        }),
      );
    }
    if (item.price !== undefined) {
      const assumed = item.price as Partial<Money> | null;
      if (typeof assumed !== "object" || assumed === null || typeof assumed.value !== "string" || typeof assumed.currency_code !== "string") {
        issues.push(issue("DATA_ERROR", "INVALID_DATA", `The price of ${sku} must be { currency_code, value }.`, { field: `${field}.price`, item_id: sku }));
      } else if (assumed.currency_code !== CART_CURRENCY) {
        issues.push(
          issue("PRICING_ERROR", "BUSINESS_RULE", `${supplier.name} sells in ${CART_CURRENCY}, not ${assumed.currency_code}.`, {
            field: `${field}.price.currency_code`,
            item_id: sku,
            resolution_options: [{ action: "USE_DIFFERENT_CURRENCY", label: `Pay in ${CART_CURRENCY}` }],
          }),
        );
      } else if (assumed.value.trim() !== toDecimalString(product.unitPriceCents)) {
        issues.push(
          issue("PRICING_ERROR", "BUSINESS_RULE", `The price of ${sku} is ${toDecimalString(product.unitPriceCents)} ${CART_CURRENCY} excl. VAT, not ${assumed.value}.`, {
            field: `${field}.price.value`,
            item_id: sku,
            resolution_options: [{ action: "ACCEPT_NEW_PRICE", label: `Accept ${toDecimalString(product.unitPriceCents)} ${CART_CURRENCY}` }],
          }),
        );
      }
    }
    const unitVatCents = pctOf(product.unitPriceCents, product.vatRate);
    lines.push({
      sku,
      name: `${product.name} (${product.pack})`,
      qty,
      unitPriceCents: product.unitPriceCents,
      vatRate: product.vatRate,
      unitVatCents,
      netCents: product.unitPriceCents * qty,
      vatCents: unitVatCents * qty,
    });
  }
  return { lines, issues };
}

export function cartTotals(lines: CartLine[]) {
  const netCents = lines.reduce((s, l) => s + l.netCents, 0);
  const vatCents = lines.reduce((s, l) => s + l.vatCents, 0);
  return { netCents, vatCents, totalCents: netCents + vatCents };
}

/** Do two pricings charge exactly the same lines? (A replacement that changes nothing keeps its PayPal order.) */
export function sameCharge(a: CartLine[], b: CartLine[]): boolean {
  const key = (lines: CartLine[]) =>
    lines
      .map((l) => `${l.sku}:${l.qty}:${l.unitPriceCents}:${l.unitVatCents}`)
      .sort()
      .join("|");
  return key(a) === key(b);
}

/** A supplier's order number for a completed cart, e.g. "CHS-4F2A1B" for CleanPro Hospitality Supplies. */
export function merchantOrderNumber(supplier: Pick<Supplier, "name">, cartId: string): string {
  const initials =
    supplier.name
      .split(/[^A-Za-z]+/)
      .filter((w) => w && w !== "Ltd" && w !== "S" && w !== "L")
      .map((w) => w[0].toUpperCase())
      .join("")
      .slice(0, 3) || "ORD";
  return `${initials}-${cartId.replace(/[^A-Za-z0-9]/g, "").slice(-6).toUpperCase()}`;
}

/** The cart as the Cart API returns it. Statuses are whitelisted and empty fields dropped, so the answer always fits the schema. */
export function cartResponse(cart: StoreCart) {
  const totals = cartTotals(cart.lines);
  const status: CartStatus = (CART_STATUSES as readonly string[]).includes(cart.status) ? cart.status : "INCOMPLETE";
  const validation: ValidationStatus = (VALIDATION_STATUSES as readonly string[]).includes(cart.validationStatus) ? cart.validationStatus : "INVALID";
  return {
    id: cart.id,
    status,
    validation_status: validation,
    validation_issues: cart.issues,
    items: cart.lines.map((l) => ({
      item_id: l.sku,
      variant_id: l.sku,
      name: l.name,
      quantity: l.qty,
      price: money(l.unitPriceCents),
      tax: money(l.unitVatCents),
    })),
    totals: { subtotal: money(totals.netCents), shipping: money(0), tax: money(totals.vatCents), total: money(totals.totalCents) },
    ...(cart.paymentToken ? { payment_method: { type: "paypal", token: cart.paymentToken } } : {}),
    ...(cart.merchantOrderNumber
      ? { payment_confirmation: { merchant_order_number: cart.merchantOrderNumber, order_review_page: `/store/${cart.supplierId}` } }
      : {}),
  };
}

/** What PayPal says about the cart's payment (the order behind payment_method.token). */
export interface PaymentFacts {
  orderStatus?: string;
  authorizationStatus?: string;
}

const AUTHORIZED = ["CREATED", "CAPTURED", "PARTIALLY_CAPTURED", "PENDING"];

/**
 * May the store complete this cart? Only once the buyer's payment is in place: in this app that
 * means the restaurant owner approved the purchase and PayPal authorized the card (the purchasing
 * agent can create carts, but nothing it can call completes one). A completed cart stays completed.
 */
export function checkoutDecision(cart: StoreCart, payment: PaymentFacts | null): { ok: true; alreadyCompleted: boolean } | { ok: false; issue: CartIssue } {
  if (cart.status === "COMPLETED") return { ok: true, alreadyCompleted: true };
  if (cart.validationStatus !== "VALID" || !cart.paymentToken) {
    return {
      ok: false,
      issue: issue("DATA_ERROR", "INVALID_DATA", "Resolve the cart's validation issues before checkout.", {
        field: "validation_issues",
        resolution_options: [{ action: "MODIFY_CART", label: "Fix the cart" }],
      }),
    };
  }
  const authorized = (payment?.authorizationStatus && AUTHORIZED.includes(payment.authorizationStatus)) || payment?.orderStatus === "COMPLETED";
  if (!authorized) {
    return {
      ok: false,
      issue: issue("PAYMENT_ERROR", "BUSINESS_RULE", `PayPal order ${cart.paymentToken} is ${payment?.orderStatus ?? "not readable"}: the buyer has not approved this payment.`, {
        user_message: "The restaurant's owner approves every purchase. Checkout completes after that approval, never before.",
        field: "payment_method.token",
        resolution_options: [{ action: "REQUEST_APPROVAL", label: "Ask the owner to approve" }],
      }),
    };
  }
  return { ok: true, alreadyCompleted: false };
}
