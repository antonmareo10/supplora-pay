// The supplier stores' side of PayPal's Cart API (server only): carts are priced and validated by the
// store (cart-api.ts), a valid cart gets its PayPal order (Orders v2, intent AUTHORIZE: the payment
// token), and checkout completes the cart only once PayPal shows the buyer's payment authorized.
//
// Two callers, one code path:
//   - the public endpoints under /api/paypal/v1/stores/[supplier]/merchant-cart, for any agent;
//   - the purchasing agent's create_checkout (restock.ts), and the owner's approval, which completes
//     the cart right after PayPal authorizes the card.
// Carts live in the visitor's session state, like everything else in the demo.

import { STORE_PRODUCTS, supplierById } from "@/data/seed";
import {
  CartApiError,
  cartTotals,
  checkoutDecision,
  merchantOrderNumber,
  newCartId,
  parseCartRequest,
  priceStoreCart,
  sameCharge,
  type PaymentFacts,
  type StoreCart,
} from "./cart-api";
import { fmt } from "./money";
import { createOrder, type OrderResponse } from "./paypal";
import { orderFacts, withToolkit } from "./paypal-toolkit";
import type { Supplier } from "./types";
import { auditEntry, indexPayPalResources, readState, updateState } from "./state";
import type { AuditEntry } from "./types";

/** Carts kept per session; the oldest carts that never led to an order are dropped first. */
const MAX_CARTS = 40;

export function storeFor(supplierId: string): Supplier {
  const supplier = supplierById(supplierId);
  if (!supplier?.store) throw new CartApiError("INVALID_REQUEST", `There is no store with the id ${supplierId}.`, 400);
  return supplier;
}

async function saveCart(cart: StoreCart, audit?: Omit<AuditEntry, "id" | "at">): Promise<void> {
  await updateState((s) => {
    const carts = (s.carts ??= []);
    const i = carts.findIndex((c) => c.id === cart.id);
    if (i >= 0) carts[i] = cart;
    else carts.push(cart);
    while (carts.length > MAX_CARTS) {
      const drop = carts.findIndex((c) => !c.paymentToken || c.status === "INCOMPLETE");
      carts.splice(drop >= 0 ? drop : 0, 1);
    }
    if (audit) s.audit.push(auditEntry(audit));
  });
}

export async function findCart(supplierId: string, cartId: string): Promise<StoreCart> {
  const cart = (await readState()).carts?.find((c) => c.id === cartId && c.supplierId === supplierId);
  if (!cart) throw new CartApiError("CART_NOT_FOUND", `No cart ${cartId} at this store.`, 404);
  return cart;
}

async function paymentFor(supplier: Supplier, cart: StoreCart, ref: AuditEntry["ref"], revision: number): Promise<OrderResponse> {
  const order = await createOrder({
    // The PayPal-Request-Id is derived from the cart and its revision: a retry never creates a second order.
    localId: revision ? `${cart.id}-r${revision}` : cart.id,
    storeName: supplier.name,
    lines: cart.lines,
    ref,
    source: "agent",
    intent: "AUTHORIZE",
  });
  await indexPayPalResources([order.id]);
  return order;
}

const describe = (cart: StoreCart) =>
  cart.validationStatus === "VALID"
    ? `${cart.lines.length} line${cart.lines.length === 1 ? "" : "s"}, ${fmt(cartTotals(cart.lines).totalCents)} incl. VAT`
    : `${cart.issues.length} issue${cart.issues.length === 1 ? "" : "s"} to resolve (${cart.issues.map((i) => i.code).join(", ")})`;

/** POST /merchant-cart: validate and price the cart; a valid cart gets its PayPal order (the payment token). */
export async function createCart(
  supplierId: string,
  body: unknown,
  opts: { source: "agent" | "api"; ref?: AuditEntry["ref"] },
): Promise<{ cart: StoreCart; order: OrderResponse | null }> {
  const supplier = storeFor(supplierId);
  const { lines, issues } = priceStoreCart(supplier, STORE_PRODUCTS, parseCartRequest(body));
  const now = new Date().toISOString();
  const cart: StoreCart = {
    id: newCartId(),
    supplierId,
    source: opts.source,
    createdAt: now,
    updatedAt: now,
    revision: 0,
    status: issues.length ? "INCOMPLETE" : "CREATED",
    validationStatus: issues.length ? "INVALID" : "VALID",
    issues,
    lines,
  };
  let order: OrderResponse | null = null;
  if (!issues.length) {
    order = await paymentFor(supplier, cart, opts.ref ?? {}, 0);
    cart.paymentToken = order.id;
  }
  await saveCart(cart, {
    actor: opts.source === "agent" ? "agent" : "system",
    message: `Cart API · ${supplier.name}: cart ${cart.id} ${cart.validationStatus} (${describe(cart)})${order ? `; PayPal order ${order.id} ${order.status} is its payment token` : "; no PayPal order until the issues are resolved"}.`,
    ref: opts.ref,
    amountCents: order ? cartTotals(lines).totalCents : undefined,
  });
  return { cart, order };
}

/** PUT /merchant-cart/{id}: a full replacement, validated again. Unchanged charges keep their PayPal order. */
export async function replaceCart(
  supplierId: string,
  cartId: string,
  body: unknown,
  opts: { ref?: AuditEntry["ref"] } = {},
): Promise<{ cart: StoreCart; order: OrderResponse | null }> {
  const supplier = storeFor(supplierId);
  const before = await findCart(supplierId, cartId);
  if (before.status === "COMPLETED") throw new CartApiError("UNPROCESSABLE_ENTITY", "This cart is completed and can no longer change.", 422);
  const { lines, issues } = priceStoreCart(supplier, STORE_PRODUCTS, parseCartRequest(body));
  const cart: StoreCart = {
    ...before,
    updatedAt: new Date().toISOString(),
    revision: before.revision + 1,
    status: issues.length ? "INCOMPLETE" : "CREATED",
    validationStatus: issues.length ? "INVALID" : "VALID",
    issues,
    lines,
    paymentToken: undefined,
  };
  let order: OrderResponse | null = null;
  if (!issues.length) {
    if (before.paymentToken && sameCharge(before.lines, lines)) cart.paymentToken = before.paymentToken;
    else {
      order = await paymentFor(supplier, cart, opts.ref ?? {}, cart.revision);
      cart.paymentToken = order.id;
    }
  }
  await saveCart(cart, {
    actor: before.source === "agent" ? "agent" : "system",
    message: `Cart API · ${supplier.name}: cart ${cart.id} replaced (revision ${cart.revision}, ${cart.validationStatus}: ${describe(cart)})${
      order ? `; new PayPal order ${order.id} is its payment token` : cart.paymentToken ? `; PayPal order ${cart.paymentToken} unchanged` : ""
    }.`,
    ref: opts.ref,
  });
  return { cart, order };
}

/**
 * POST /merchant-cart/{id}/checkout: complete the cart once PayPal shows the buyer's payment authorized.
 * `known` is what the owner's approval just got back from PayPal; without it (an external caller), the
 * store reads the order through the PayPal Agent Toolkit (get_order).
 */
export async function checkoutCart(supplierId: string, cartId: string, opts: { known?: PaymentFacts; ref?: AuditEntry["ref"] } = {}): Promise<StoreCart> {
  const supplier = storeFor(supplierId);
  const cart = await findCart(supplierId, cartId);
  let payment: PaymentFacts | null = opts.known ?? null;
  if (!payment && cart.paymentToken && cart.status !== "COMPLETED") {
    const r = await withToolkit((tk) => tk.call("get_order", { id: cart.paymentToken }, { ref: opts.ref }));
    if (r.ok) {
      const f = orderFacts(r.data);
      payment = { orderStatus: f.status, authorizationStatus: f.authorizationStatus };
    }
  }
  const decision = checkoutDecision(cart, payment);
  if (!decision.ok) throw new CartApiError("UNPROCESSABLE_ENTITY", decision.issue.message, 422, [decision.issue]);
  if (decision.alreadyCompleted) return cart;
  const done: StoreCart = {
    ...cart,
    status: "COMPLETED",
    updatedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    merchantOrderNumber: merchantOrderNumber(supplier, cart.id),
  };
  await saveCart(done, {
    actor: "system",
    message: `Cart API · ${supplier.name}: checkout completed for cart ${cart.id}, supplier order ${done.merchantOrderNumber} (PayPal order ${cart.paymentToken}, authorization ${payment?.authorizationStatus ?? payment?.orderStatus}). Nothing is captured until the delivery note.`,
    ref: opts.ref,
    amountCents: cartTotals(cart.lines).totalCents,
  });
  return done;
}
