// Run with: npm test   (Node's built-in test runner with type stripping)
// PayPal's Cart API, merchant side: the supplier store prices and validates every cart itself, answers
// with issues the agent has to resolve, and completes checkout only after the buyer's approval.
import assert from "node:assert/strict";
import { test } from "node:test";
import { STORE_PRODUCTS, supplierById } from "../data/seed.ts";
import {
  CartApiError,
  cartErrorBody,
  cartResponse,
  cartTotals,
  checkoutDecision,
  isCartId,
  merchantOrderNumber,
  parseCartRequest,
  priceStoreCart,
  sameCharge,
  type StoreCart,
} from "./cart-api.ts";

const CLEANPRO = supplierById("cleanpro")!;
const ATLANTIC = supplierById("atlantic-wine")!;
// The recorded restock: 2 dishwasher detergent, 7 sanitiser, 3 boxes of gloves = €144.96 incl. VAT.
const RECORDED = {
  items: [
    { variant_id: "CP-DW-20", quantity: 2, price: { currency_code: "EUR", value: "38.50" } },
    { variant_id: "CP-SAN-750", quantity: 7, price: { currency_code: "EUR", value: "3.20" } },
    { variant_id: "CP-GLV-100", quantity: 3 },
  ],
  payment_method: { type: "paypal" },
};
const price = (body: unknown, supplier = CLEANPRO) => priceStoreCart(supplier, STORE_PRODUCTS, parseCartRequest(body));
const cart = (over: Partial<StoreCart> = {}): StoreCart => {
  const { lines, issues } = price(RECORDED);
  return {
    id: "cart_0123456789abcdef4f2a1b",
    supplierId: "cleanpro",
    source: "agent",
    createdAt: "2026-10-22T09:00:00.000Z",
    updatedAt: "2026-10-22T09:00:00.000Z",
    revision: 0,
    status: "CREATED",
    validationStatus: "VALID",
    issues,
    lines,
    paymentToken: "2TM3647911023980M",
    ...over,
  };
};

test("cart api: the store prices the recorded restock itself: €119.80 + €25.16 VAT = €144.96", () => {
  assert.ok(ATLANTIC, "seed has a second store");
  const { lines, issues } = price(RECORDED);
  assert.deepEqual(issues, []);
  assert.deepEqual(cartTotals(lines), { netCents: 11_980, vatCents: 2_516, totalCents: 14_496 });
  const body = cartResponse(cart());
  assert.equal(body.status, "CREATED");
  assert.equal(body.validation_status, "VALID");
  assert.deepEqual(body.totals, {
    subtotal: { currency_code: "EUR", value: "119.80" },
    shipping: { currency_code: "EUR", value: "0.00" },
    tax: { currency_code: "EUR", value: "25.16" },
    total: { currency_code: "EUR", value: "144.96" },
  });
  assert.deepEqual(body.payment_method, { type: "paypal", token: "2TM3647911023980M" });
  assert.equal(body.items[0].variant_id, "CP-DW-20");
  assert.equal("payment_confirmation" in body, false, "no confirmation before checkout");
});

test("cart api: a price the agent assumed is compared, never charged (PRICING_ERROR, accept the store's price)", () => {
  const { lines, issues } = price({ items: [{ variant_id: "CP-DW-20", quantity: 2, price: { currency_code: "EUR", value: "1.00" } }] });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, "PRICING_ERROR");
  assert.equal(issues[0].field, "items[0].price.value");
  assert.deepEqual(issues[0].resolution_options?.map((r) => r.action), ["ACCEPT_NEW_PRICE"]);
  assert.equal(lines[0].unitPriceCents, 3_850, "the line is still priced by the store");
  const usd = price({ items: [{ variant_id: "CP-DW-20", quantity: 1, price: { currency_code: "USD", value: "38.50" } }] }).issues;
  assert.deepEqual([usd[0].code, usd[0].resolution_options?.[0].action], ["PRICING_ERROR", "USE_DIFFERENT_CURRENCY"]);
});

test("cart api: unknown, duplicate, out-of-range and out-of-stock items come back as issues to resolve", () => {
  const { issues } = price({
    items: [
      { variant_id: "AWS-RIO-75", quantity: 1 }, // Atlantic Wine's Rioja, not sold by CleanPro
      { variant_id: "CP-RA-10", quantity: 2 },
      { variant_id: "CP-RA-10", quantity: 1 },
      { variant_id: "CP-BR-6", quantity: 0 },
      { variant_id: "CP-DEG-5", quantity: 2.5 },
      { variant_id: "CP-DW-20", quantity: 23 }, // 22 in stock
      { quantity: 1 },
    ],
  });
  const got = issues.map((i) => `${i.code}/${i.type}@${i.field}`);
  assert.deepEqual(got, [
    "INVENTORY_ISSUE/INVALID_DATA@items[0].variant_id",
    "DATA_ERROR/INVALID_DATA@items[2]",
    "DATA_ERROR/INVALID_DATA@items[3].quantity",
    "DATA_ERROR/INVALID_DATA@items[4].quantity",
    "INVENTORY_ISSUE/BUSINESS_RULE@items[5].quantity",
    "DATA_ERROR/MISSING_FIELD@items[6].variant_id",
  ]);
  assert.ok(issues.every((i) => i.user_message && i.message));
  assert.deepEqual(price({ items: [] }).issues.map((i) => i.type), ["MISSING_FIELD"]);
  assert.equal(price({ items: Array.from({ length: 21 }, () => ({ variant_id: "CP-RA-10", quantity: 1 })) }).issues[0].resolution_options?.[0].action, "SPLIT_ORDER");
});

test("cart api: a body that is not a cart is a 400 INVALID_REQUEST envelope, not a cart", () => {
  for (const bad of [null, [], "cart", 42, { items: "CP-RA-10" }, { items: ["CP-RA-10"] }]) {
    assert.throws(() => parseCartRequest(bad), (e: CartApiError) => e.status === 400 && e.errorName === "INVALID_REQUEST", JSON.stringify(bad));
  }
  const env = cartErrorBody(new CartApiError("CART_NOT_FOUND", "No such cart.", 404), "dbg_1");
  assert.deepEqual(env, { name: "CART_NOT_FOUND", message: "No such cart.", debug_id: "dbg_1" });
  assert.equal(isCartId("cart_0123456789abcdef4f2a1b"), true);
  assert.equal(isCartId("../../state"), false);
  assert.equal(isCartId("x".repeat(65)), false);
});

test("cart api: checkout completes only after the owner's approval authorized the payment", () => {
  const waiting = checkoutDecision(cart(), { orderStatus: "CREATED" });
  assert.equal(waiting.ok, false);
  if (!waiting.ok) {
    assert.equal(waiting.issue.code, "PAYMENT_ERROR");
    assert.deepEqual(waiting.issue.resolution_options?.map((r) => r.action), ["REQUEST_APPROVAL"]);
  }
  assert.equal(checkoutDecision(cart(), null).ok, false, "unreadable payment");
  assert.equal(checkoutDecision(cart(), { orderStatus: "APPROVED" }).ok, false, "approved but not authorized");
  assert.deepEqual(checkoutDecision(cart(), { orderStatus: "COMPLETED", authorizationStatus: "CREATED" }), { ok: true, alreadyCompleted: false });
  const invalid = checkoutDecision(cart({ status: "INCOMPLETE", validationStatus: "INVALID", paymentToken: undefined }), { orderStatus: "COMPLETED", authorizationStatus: "CREATED" });
  assert.equal(invalid.ok, false, "an invalid cart never completes");
  assert.deepEqual(checkoutDecision(cart({ status: "COMPLETED" }), null), { ok: true, alreadyCompleted: true });
});

test("cart api: confirmation, whitelisted statuses, and replacements that keep or renew the PayPal order", () => {
  const done = cartResponse(cart({ status: "COMPLETED", merchantOrderNumber: merchantOrderNumber(CLEANPRO, "cart_0123456789abcdef4f2a1b") }));
  assert.deepEqual(done.payment_confirmation, { merchant_order_number: "CHS-4F2A1B", order_review_page: "/store/cleanpro" });
  assert.equal(merchantOrderNumber(ATLANTIC, "cart_x9"), "AWS-CARTX9");
  assert.equal(cartResponse(cart({ status: "PAID" as never })).status, "INCOMPLETE");
  assert.equal(cartResponse(cart({ validationStatus: "OK" as never })).validation_status, "INVALID");
  const a = price(RECORDED).lines;
  const fewer = price({ items: [{ variant_id: "CP-DW-20", quantity: 2 }, { variant_id: "CP-SAN-750", quantity: 6 }, { variant_id: "CP-GLV-100", quantity: 3 }] }).lines;
  assert.equal(sameCharge(a, [...a].reverse()), true, "same lines in another order");
  assert.equal(sameCharge(a, fewer), false);
});
