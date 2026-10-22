// Agentic reorder. The purchasing agent reads stock levels and the suppliers'
// online store catalogs, then creates PayPal checkouts (Orders v2, status CREATED)
// within the owner's spending limit, and verifies each one on PayPal with get_order from
// the official PayPal Agent Toolkit. It cannot pay: the toolkit's pay_order is never enabled,
// and capture only happens when the owner approves, using the restaurant's card on file
// (PayPal Vault token), after the order is re-read through the toolkit.

import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { RESTAURANT, STORE_PRODUCTS, supplierById } from "@/data/seed";
import { callTool, replayRun, runLive } from "./agent-run";
import { lowStock } from "./ap";
import { anthropic, claudeErrorMessage, claudeMode, MODEL } from "./claude";
import { cartTotals as storeCartTotals, parseCartRequest, priceStoreCart } from "./cart-api";
import { fmt, fromDecimalString, pctOf, toDecimalString } from "./money";
import { fmtDay } from "./dates";
import {
  authorizeOrder,
  captureAuthorization,
  captureOrder,
  cartTotals,
  confirmWithCardOnFile,
  createOrder,
  ensureCardOnFile,
  firstAuthorization,
  firstCapture,
  PayPalError,
  voidAuthorization,
} from "./paypal";
import { checkOrderMatches } from "./order-checks";
import { serializer } from "./serialize";
import { openToolkit, orderFacts, withToolkit, type ToolkitConnection, type ToolkitResult } from "./paypal-toolkit";
import { RESTOCK_AGENT_TOOLKIT_TOOLS } from "./paypal-toolkit-policy";
import { fingerprint, recordedRun, recordMode, type RecordedCall } from "./recordings";
import { nothingDelivered, orderApproved, planSettlement, scriptedDelivery, SettlementError, type SettlementPlan } from "./settlement";
import { auditEntry, indexPayPalResources, newId, readState, updateState } from "./state";
import { checkoutCart, createCart, replaceCart } from "./store-carts";
import type { AgentEvent, AppState, CartLine, StoreOrder } from "./types";

type Emit = (e: AgentEvent) => void;
const eur = (cents: number) => Number(toDecimalString(cents));

export class CommerceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** The public catalog a supplier store exposes (also served at /api/store/[supplier]/catalog). */
export function storeCatalog(supplierId: string) {
  const supplier = supplierById(supplierId);
  if (!supplier?.store) return null;
  return {
    store: {
      id: supplier.id,
      name: supplier.name,
      tagline: supplier.store.tagline,
      delivery: supplier.store.leadTime,
      currency: "EUR",
      prices: "excl. VAT",
      // Agents buy through the store's PayPal Cart API (agentic commerce, v1).
      cart_api: `/api/paypal/v1/stores/${supplier.id}/merchant-cart`,
    },
    products: STORE_PRODUCTS.filter((p) => p.supplierId === supplierId).map((p) => ({
      sku: p.sku,
      name: p.name,
      pack: p.pack,
      price_eur: eur(p.unitPriceCents),
      vat_rate_percent: p.vatRate,
      in_stock: p.inStock,
    })),
  };
}

/** Builds priced cart lines from SKUs and quantities with the store's own pricing (cart-api.ts); prices always come from the catalog, never from the model. */
export function priceCart(supplierId: string, items: { sku: string; qty: number; reason?: string }[]): CartLine[] {
  const supplier = supplierById(supplierId);
  if (!supplier?.store) throw new CommerceError(`${supplier?.name ?? supplierId} has no online store.`, 400);
  const { lines, issues } = priceStoreCart(
    supplier,
    STORE_PRODUCTS,
    items.map((i, index) => ({ index, variant_id: i.sku, quantity: i.qty, price: undefined })),
  );
  if (issues.length) throw new CommerceError(issues.map((i) => i.user_message ?? i.message).join(" "), 400);
  const reasons = new Map(items.map((i) => [i.sku, i.reason?.slice(0, 200)]));
  return lines.map((l) => ({ ...l, reason: reasons.get(l.sku) }));
}

const SYSTEM = `You are the purchasing agent for ${RESTAURANT.name}, a restaurant in Málaga. You restock items that are below their par level by buying from the suppliers' online trade stores, within the spending limit (VAT included) the owner set for this run. You can create PayPal checkouts at the stores, but you cannot pay: the owner approves each order, and only then is it paid with the restaurant's card on file.

How to work:
1. Call check_inventory.
2. Call browse_store for each supplier with low-stock items (in parallel).
3. Decide quantities. Bring items back to par. When the limit does not cover everything, prioritise kitchen hygiene and food-safety essentials and items at zero stock, then bar items. Buying less than par is fine. Never exceed the limit.
4. Call create_checkout once per supplier: it builds the cart at the store through the store's PayPal Cart API. If it returns an error or validation issues, fix the cart and call it again.
5. Verify each checkout on PayPal with get_order (PayPal Agent Toolkit): it must be CREATED, in EUR, for the total create_checkout returned. submit_for_approval refuses unverified checkouts.
6. Call submit_for_approval once, with a short summary for the owner. Any euro figure in it must come from the tool results (do not estimate totals you did not get from a tool).

Before each group of tool calls, write one short sentence (max 15 words) saying what you are doing.`;

/** What a recorded restock run depends on: replay only when this matches exactly. */
export function restockFingerprint(state: AppState): string {
  return fingerprint({
    limit: state.settings.restockLimitCents,
    low: lowStock(state).map((i) => [i.key, i.onHand, i.par, i.sku]),
    products: STORE_PRODUCTS.map((p) => [p.sku, p.unitPriceCents, p.vatRate, p.inStock]),
  });
}

export async function runRestockAgent(emit: Emit, signal?: AbortSignal): Promise<string | null> {
  const mode = claudeMode();
  const state = await readState();
  const limitCents = state.settings.restockLimitCents;
  const proposalId = newId("rst");
  const checkouts = new Map<string, StoreOrder>();
  /** Checkouts whose PayPal order was read back through the toolkit and matched. */
  const verified = new Set<string>();
  /** Recording only: which supplier each PayPal order id belonged to (replays remap ids). */
  const orderSuppliers: Record<string, string> = {};
  let submitted = false;
  const log: AgentEvent[] = [];
  const out: Emit = (e) => {
    log.push(e);
    emit(e);
  };
  const spent = () => [...checkouts.values()].reduce((s, o) => s + o.totalCents, 0);
  // create_checkout calls emitted in one assistant turn run concurrently (the tool runner awaits
  // them with Promise.all). Serialize them so each sees the running total the previous committed;
  // otherwise two carts can each read an empty total and both slip past the limit check.
  const serialize = serializer();

  const wrap = <T extends z.ZodType>(def: {
    name: string;
    description: string;
    inputSchema: T;
    label: (input: z.infer<T>) => string;
    run: (input: z.infer<T>) => Promise<{ summary: string; result: unknown; error?: boolean }>;
  }) =>
    betaZodTool({
      name: def.name,
      description: def.description,
      inputSchema: def.inputSchema,
      run: async (input, ctx) => {
        const id = ctx?.toolUse.id ?? crypto.randomUUID();
        out({ type: "tool_start", id, tool: def.name, label: def.label(input) });
        try {
          const r = await def.run(input);
          out({ type: "tool_end", id, tool: def.name, summary: r.summary, error: r.error });
          return JSON.stringify(r.result);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          out({ type: "tool_end", id, tool: def.name, summary: message, error: true });
          return `Error: ${message}`;
        }
      },
    });

  const checkInventory = wrap({
    name: "check_inventory",
    description: "Items whose stock is below par level, with the supplier and store SKU to reorder them.",
    inputSchema: z.object({}),
    label: () => "Checking stock against par levels",
    run: async () => {
      const low = lowStock(await readState());
      return {
        summary: `${low.length} items below par`,
        result: {
          spending_limit_eur: eur(limitCents),
          items: low.map((i) => ({
            item: i.name,
            on_hand: i.onHand,
            par: i.par,
            unit: i.unit,
            needed_to_reach_par: i.par - i.onHand,
            supplier_id: i.supplierId,
            supplier: supplierById(i.supplierId)?.name,
            sku: i.sku,
          })),
        },
      };
    },
  });

  const browseStore = wrap({
    name: "browse_store",
    description: "Read a supplier store's public product catalog (prices excl. VAT, VAT rate, stock).",
    inputSchema: z.object({ supplier_id: z.string() }),
    label: ({ supplier_id }) => `Browsing ${supplierById(supplier_id)?.name ?? supplier_id}'s store`,
    run: async ({ supplier_id }) => {
      const catalog = storeCatalog(supplier_id);
      if (!catalog) return { summary: "No online store", result: { error: `${supplier_id} has no online store` }, error: true };
      return { summary: `${catalog.products.length} products`, result: catalog };
    },
  });

  const createCheckout = wrap({
    name: "create_checkout",
    description:
      "Create a cart at one supplier's store through its PayPal Cart API (POST /merchant-cart). The store prices it (prices come from the store) and returns a PayPal order as the cart's payment token. Fails if the running total of all checkouts (VAT incl.) would exceed the owner's limit. Calling it again for the same supplier replaces that supplier's cart (PUT /merchant-cart/{id}).",
    inputSchema: z.object({
      supplier_id: z.string(),
      items: z.array(z.object({ sku: z.string(), qty: z.number(), reason: z.string().describe("Why, e.g. on hand 1, par 4") })),
    }),
    label: ({ supplier_id, items }) => `Creating a checkout at ${supplierById(supplier_id)?.name ?? supplier_id} (${items.length} items)`,
    run: ({ supplier_id, items }) =>
      serialize(async () => {
        const supplier = supplierById(supplier_id);
        if (!supplier?.store) throw new CommerceError(`${supplier?.name ?? supplier_id} has no online store.`, 400);
        // The Cart API request: SKUs, quantities and the catalog price the agent read (the store re-prices it anyway).
        const body = {
          items: items.map((i) => {
            const p = STORE_PRODUCTS.find((x) => x.sku === i.sku && x.supplierId === supplier_id);
            return { variant_id: i.sku, quantity: i.qty, ...(p ? { price: { currency_code: "EUR", value: toDecimalString(p.unitPriceCents) } } : {}) };
          }),
          payment_method: { type: "paypal" },
        };
        // The agent's own budget check comes first, on the store's prices: nothing is created at the store if it fails.
        const quote = priceStoreCart(supplier, STORE_PRODUCTS, parseCartRequest(body));
        if (quote.issues.length) {
          return {
            summary: `The store's Cart API returned ${quote.issues.length} validation issue${quote.issues.length === 1 ? "" : "s"}`,
            result: {
              ok: false,
              error: "The store did not accept this cart. Resolve the validation issues and call create_checkout again.",
              validation_issues: quote.issues.map((i) => ({ code: i.code, message: i.user_message ?? i.message, field: i.field, resolution: i.resolution_options?.map((r) => r.action) })),
            },
            error: true,
          };
        }
        const totals = storeCartTotals(quote.lines);
        const previous = checkouts.get(supplier_id);
        const others = spent() - (previous?.totalCents ?? 0);
        if (others + totals.totalCents > limitCents) {
          return {
            summary: `Over the limit by ${fmt(others + totals.totalCents - limitCents)}`,
            result: {
              ok: false,
              error: `This cart costs ${fmt(totals.totalCents)} incl. VAT; with other checkouts (${fmt(others)}) that exceeds the ${fmt(limitCents)} limit by ${fmt(others + totals.totalCents - limitCents)}. Reduce quantities or drop items.`,
            },
            error: true,
          };
        }
        // The store's Cart API: create the cart, or replace this supplier's cart from earlier in the run.
        const ref = { proposalId };
        const { cart, order } = previous?.cart
          ? await replaceCart(supplier_id, previous.cart.id, body, { ref })
          : await createCart(supplier_id, body, { source: "agent", ref });
        if (cart.validationStatus !== "VALID" || !cart.paymentToken) {
          return {
            summary: `Cart API: cart ${cart.id} ${cart.validationStatus}`,
            result: {
              ok: false,
              error: "The store did not accept this cart.",
              validation_issues: cart.issues.map((i) => ({ code: i.code, message: i.user_message ?? i.message, field: i.field })),
            },
            error: true,
          };
        }
        const reasons = new Map(items.map((i) => [i.sku, i.reason?.slice(0, 200)]));
        const lines = cart.lines.map((l) => ({ ...l, reason: reasons.get(l.sku) }));
        const record: StoreOrder = {
          id: cart.paymentToken,
          supplierId: supplier_id,
          createdAt: new Date().toISOString(),
          source: "agent",
          proposalId,
          lines,
          ...storeCartTotals(lines),
          // Intent AUTHORIZE: approval only holds the money; the delivery note decides what is captured.
          intent: "AUTHORIZE",
          status: order?.status ?? previous?.status ?? "CREATED",
          cart: { id: cart.id, status: cart.status },
        };
        checkouts.set(supplier_id, record);
        orderSuppliers[record.id] = supplier_id;
        return {
          summary: `Cart API cart ${cart.id} ${cart.validationStatus} · PayPal order ${record.id} · ${record.status} · ${fmt(record.totalCents)}`,
          result: {
            ok: true,
            cart_id: cart.id,
            cart_status: cart.status,
            validation_status: cart.validationStatus,
            paypal_order_id: record.id,
            status: record.status,
            total_incl_vat_eur: eur(record.totalCents),
            remaining_limit_eur: eur(limitCents - spent()),
          },
        };
      }),
  });

  const submit = wrap({
    name: "submit_for_approval",
    description: "Send the checkouts to the owner for approval. Call once at the end. You cannot pay orders yourself.",
    inputSchema: z.object({ summary: z.string().describe("2-3 sentences for the owner: what you are buying and what you left out") }),
    label: () => "Sending the orders to the owner for approval",
    run: async ({ summary }) => {
      if (!checkouts.size) return { summary: "No checkouts yet", result: { error: "Create at least one checkout first." }, error: true };
      const unverified = [...checkouts.values()].filter((o) => !verified.has(o.id)).map((o) => o.id);
      if (unverified.length) {
        return {
          summary: `${unverified.length} checkout${unverified.length === 1 ? "" : "s"} not verified yet`,
          result: { error: `Verify these PayPal orders with get_order first: ${unverified.join(", ")}` },
          error: true,
        };
      }
      await saveProposal(proposalId, [...checkouts.values()], limitCents, summary.trim(), log);
      submitted = true;
      out({ type: "result", kind: "proposal", id: proposalId });
      return { summary: "Waiting for approval", result: { ok: true, note: "Sent to the owner. Stop here." } };
    },
  });

  // The official PayPal Agent Toolkit, as an in-process MCP server: Claude gets get_order only.
  let toolkit: ToolkitConnection;
  try {
    toolkit = await openToolkit();
  } catch (err) {
    out({ type: "error", message: `Could not start the PayPal Agent Toolkit: ${err instanceof Error ? err.message : String(err)}` });
    return null;
  }
  const verify = (orderId: string, r: ToolkitResult): string => {
    const order = [...checkouts.values()].find((o) => o.id === orderId);
    if (!order) return `No checkout from this run has id ${orderId}`;
    const check = checkOrderMatches(order, r);
    if (check.ok) verified.add(order.id);
    return check.reason;
  };
  const toolkitTools = toolkit.agentTools(RESTOCK_AGENT_TOOLKIT_TOOLS, {
    before: (name, input, id) => {
      out({ type: "tool_start", id, tool: `${name} · PayPal Agent Toolkit`, label: `Verifying PayPal order ${String(input.id ?? "")} on PayPal` });
      return input;
    },
    after: (name, input, r, id) => {
      const verdict = verify(String(input.id ?? ""), r);
      out({ type: "tool_end", id, tool: `${name} · PayPal Agent Toolkit`, summary: r.ok ? `${orderFacts(r.data).status} · ${verdict}` : verdict, error: !r.ok || !verified.has(String(input.id)) });
      return `${r.text}\n\nSupplora check: ${verdict}`;
    },
  });
  const tools = [checkInventory, browseStore, createCheckout, ...toolkitTools, submit];
  const fp = restockFingerprint(state);

  try {
    if (mode === "replay") {
      const rec = recordedRun("restock");
      if (rec && rec.fingerprint === fp) {
        // Recorded PayPal order ids are replaced by the ids of the orders created in this replay.
        const recordedSuppliers = (rec.meta.orderSuppliers ?? {}) as Record<string, string>;
        const remap = (c: RecordedCall): RecordedCall => {
          if (c.tool !== "get_order") return c;
          const supplier = recordedSuppliers[String(c.input.id)];
          const current = supplier ? checkouts.get(supplier)?.id : undefined;
          return current ? { ...c, input: { ...c.input, id: current } } : c;
        };
        await replayRun(rec, tools, out, signal, remap);
      } else {
        out({
          type: "info",
          tone: "fallback",
          text: "Your stock or spending limit differs from the recorded Claude run, so the demo's deterministic buyer fills the carts instead (zero-stock items first, then hygiene, then bar; same tools, same limit checks, same PayPal calls). Run the app with your own API key to see Claude shop any scenario.",
        });
        await runFallbackRestock(tools, state, limitCents);
      }
    } else {
      const result = await runLive(
        anthropic(),
        {
          model: MODEL,
          max_tokens: 16000,
          max_iterations: 12,
          system: SYSTEM,
          output_config: { effort: "medium" },
          thinking: { type: "adaptive", display: "updates" },
          betas: ["server-side-fallback-2026-07-01", "thinking-display-updates-2026-08-18"],
          fallbacks: "default",
          tools,
          messages: [{ role: "user", content: `Restock what's running low. Spending limit for this run: ${fmt(limitCents)} including VAT.` }],
        },
        out,
        signal,
        recordMode() ? { kind: "restock", fingerprint: fp, meta: { limitCents, orderSuppliers } } : null,
      );
      if (result.refused) {
        out({ type: "error", message: "The model declined this request." });
        return null;
      }
      if (result.error && !submitted) {
        out({ type: "error", message: claudeErrorMessage(result.error) });
        return null;
      }
    }

    if (!submitted && checkouts.size) {
      // The agent stopped before submitting: verify any unverified order ourselves, then route it.
      for (const o of checkouts.values()) {
        if (!verified.has(o.id)) verify(o.id, await toolkit.call("get_order", { id: o.id }, { ref: { proposalId } }));
      }
      const bad = [...checkouts.values()].filter((o) => !verified.has(o.id));
      if (bad.length) {
        out({ type: "error", message: `PayPal does not confirm ${bad.map((o) => o.id).join(", ")}; nothing was sent for approval.` });
        return null;
      }
      await saveProposal(proposalId, [...checkouts.values()], limitCents, "Restock orders prepared by the purchasing agent.", log);
      submitted = true;
      out({ type: "result", kind: "proposal", id: proposalId });
    }
  } finally {
    await toolkit.close();
  }
  if (!submitted) {
    out({ type: "error", message: "The agent stopped before preparing any order. Please try again." });
    return null;
  }
  await updateState((s) => {
    const p = s.proposals.find((x) => x.id === proposalId);
    if (p) p.agentLog = log;
  });
  return proposalId;
}

/**
 * Demo-only fallback when the visitor's stock or limit differs from the recorded run: a greedy
 * buyer (zero stock first, then hygiene and food safety, then bar) driven through the agent's
 * own tools, so carts, limits, PayPal orders and the toolkit verification are identical.
 * Never used when Claude is available.
 */
async function runFallbackRestock(tools: Parameters<typeof callTool>[0], state: AppState, limitCents: number): Promise<void> {
  const call = (tool: string, input: Record<string, unknown> = {}) => callTool(tools, { id: `fallback_${tool}_${crypto.randomUUID().slice(0, 8)}`, tool, input });
  await call("check_inventory");
  const low = lowStock(state);
  const suppliers = [...new Set(low.map((i) => i.supplierId))];
  await Promise.all(suppliers.map((supplier_id) => call("browse_store", { supplier_id })));
  const rank = (i: (typeof low)[number]) => (i.onHand === 0 ? 0 : supplierById(i.supplierId)?.category === "cleaning" ? 1 : 2);
  let remaining = limitCents;
  const carts = new Map<string, { sku: string; qty: number; reason: string }[]>();
  for (const item of [...low].sort((a, b) => rank(a) - rank(b) || b.par - b.onHand - (a.par - a.onHand))) {
    const p = STORE_PRODUCTS.find((x) => x.sku === item.sku && x.supplierId === item.supplierId);
    if (!p) continue;
    const unit = p.unitPriceCents + pctOf(p.unitPriceCents, p.vatRate);
    const qty = Math.min(item.par - item.onHand, p.inStock, Math.floor(remaining / unit));
    if (qty < 1) continue;
    remaining -= qty * unit;
    const lines = carts.get(item.supplierId) ?? [];
    lines.push({ sku: p.sku, qty, reason: `on hand ${item.onHand}, par ${item.par}${qty < item.par - item.onHand ? "; partial, spending limit" : ""}` });
    carts.set(item.supplierId, lines);
  }
  if (!carts.size) return;
  const created: string[] = [];
  for (const [supplier_id, items] of carts) {
    const r = await call("create_checkout", { supplier_id, items });
    const id = /"paypal_order_id":"([A-Z0-9]+)"/.exec(r)?.[1];
    if (id) created.push(id);
  }
  await Promise.all(created.map((id) => call("get_order", { id })));
  const left = low.filter((i) => ![...carts.values()].flat().some((l) => l.sku === i.sku));
  await call("submit_for_approval", {
    summary: `Bought ${[...carts.values()].flat().length} item lines within the ${fmt(limitCents)} limit (${fmt(limitCents - remaining)} incl. VAT).${left.length ? ` Left for the next order: ${left.map((i) => i.name).join(", ")}.` : ""}`,
  });
}

async function saveProposal(id: string, orders: StoreOrder[], limitCents: number, summary: string, log: AgentEvent[]) {
  const total = orders.reduce((s, o) => s + o.totalCents, 0);
  await updateState((s) => {
    for (const p of s.proposals) if (p.status === "awaiting_approval") p.status = "declined";
    s.orders.push(...orders);
    s.proposals.push({ id, createdAt: new Date().toISOString(), status: "awaiting_approval", limitCents, orderIds: orders.map((o) => o.id), totalCents: total, summary, agentLog: log });
    s.audit.push(
      auditEntry({
        actor: "agent",
        message: `Restock proposed: ${orders.length} PayPal checkout${orders.length === 1 ? "" : "s"} (${orders.map((o) => supplierById(o.supplierId)?.name).join(", ")}) totalling ${fmt(total)} of the ${fmt(limitCents)} limit. Awaiting owner approval.`,
        ref: { proposalId: id },
        amountCents: total,
      }),
    );
  });
}

/**
 * Approve an order with the card on file: re-read it through the PayPal Agent Toolkit (refuse if
 * PayPal's amount or status differs from what the owner approved), confirm-payment-source with the
 * vault token, then, by intent:
 *   - AUTHORIZE (the purchasing agent's restocks): authorize only. The money is held on the card and
 *     captured later, for what the signed delivery note confirms (settleDelivery);
 *   - CAPTURE (the owner buying directly in a store): capture at once.
 */
async function payOrder(order: StoreOrder, ref: { proposalId?: string; orderId: string }): Promise<StoreOrder> {
  try {
    const check = await withToolkit(async (tk) => checkOrderMatches(order, await tk.call("get_order", { id: order.id }, { ref })));
    if (!check.ok) return { ...order, error: `Not paid: ${check.reason}.` };
  } catch (err) {
    return { ...order, error: `Not paid: could not verify the order on PayPal (${err instanceof Error ? err.message : "toolkit error"}).` };
  }
  const card = await ensureCardOnFile();
  // One idempotency suffix per approval attempt: double clicks are blocked by the
  // proposal lock, and PayPal itself refuses to capture or authorize an order twice.
  const attempt = crypto.randomUUID().slice(0, 8);
  let status = order.status;
  try {
    // An earlier attempt may have confirmed the order before failing: do not confirm it twice.
    const confirmed = status === "APPROVED" ? null : await confirmWithCardOnFile(order.id, card.vaultId, ref, attempt);
    if (confirmed) status = confirmed.status;
    if (order.intent === "AUTHORIZE") {
      const authorized = await authorizeOrder(order.id, ref, attempt, order.totalCents);
      const a = firstAuthorization(authorized);
      if (!a) return { ...order, status: authorized.status, cardLabel: card.label, error: "PayPal did not return an authorization for this order." };
      await indexPayPalResources([a.id]);
      const amountCents = a.amount?.value ? fromDecimalString(a.amount.value) : order.totalCents;
      const at = new Date().toISOString();
      // The card is authorized: the supplier store can now complete its Cart API checkout (the order is
      // confirmed to the supplier; the money stays held until the delivery note).
      let cart = order.cart;
      if (cart && cart.status !== "COMPLETED") {
        try {
          const done = await checkoutCart(order.supplierId, cart.id, { known: { orderStatus: authorized.status, authorizationStatus: a.status }, ref });
          cart = { id: done.id, status: done.status, merchantOrderNumber: done.merchantOrderNumber };
        } catch (err) {
          cart = { ...cart, error: `Cart API checkout did not complete: ${err instanceof Error ? err.message : String(err)}` };
        }
      }
      return {
        ...order,
        status: authorized.status,
        authorization: { id: a.id, status: a.status, amountCents, expiresAt: a.expiration_time, createdAt: at },
        cart,
        cardLabel: card.label,
        error: amountCents === order.totalCents ? undefined : `PayPal authorized ${fmt(amountCents)}, not ${fmt(order.totalCents)}.`,
        updatedBy: { source: "app", at },
      };
    }
    const done = status === "COMPLETED" && confirmed ? confirmed : await captureOrder(order.id, ref, attempt, order.totalCents);
    const cap = firstCapture(done);
    if (cap) await indexPayPalResources([cap.id]);
    return { ...order, status: done.status, captureId: cap?.id, captureStatus: cap?.status, cardLabel: card.label, error: undefined, updatedBy: { source: "app", at: new Date().toISOString() } };
  } catch (err) {
    const message = err instanceof PayPalError ? err.message : err instanceof Error ? err.message : "Payment failed";
    return { ...order, status, error: message };
  }
}

/** Puts delivered goods on the shelf: the delivered quantity of each line (all of it for checkout-paid orders). */
function receive(s: Awaited<ReturnType<typeof readState>>, order: StoreOrder, delivered?: Record<string, number>) {
  for (const line of order.lines) {
    const item = s.inventory.find((i) => i.sku === line.sku);
    if (item) item.onHand += delivered ? (delivered[line.sku] ?? 0) : line.qty;
  }
  order.received = true;
}

export async function approveProposal(proposalId: string): Promise<void> {
  const proposal = await updateState((s) => {
    const p = s.proposals.find((x) => x.id === proposalId);
    if (!p) throw new CommerceError("Restock proposal not found.", 404);
    if (p.status !== "awaiting_approval" && p.status !== "failed") throw new CommerceError(`This proposal is ${p.status}.`, 409);
    // Backstop: never capture more than the limit the owner set for this run, whatever the agent
    // proposed. The spending limit is enforced here at approval time, not only in the agent's tools.
    if (p.totalCents > p.limitCents)
      throw new CommerceError(
        `These orders total ${fmt(p.totalCents)}, over the ${fmt(p.limitCents)} spending limit. Decline and run the restock again.`,
        409,
      );
    p.status = "paying";
    s.audit.push(
      auditEntry({ actor: "owner", message: `${RESTAURANT.ownerFirstName} approved the restock orders (${fmt(p.totalCents)}).`, ref: { proposalId }, amountCents: p.totalCents }),
    );
    return { ...p, orders: s.orders.filter((o) => p.orderIds.includes(o.id)) };
  });
  const results: StoreOrder[] = [];
  for (const order of proposal.orders) {
    results.push(orderApproved(order) ? order : await payOrder(order, { proposalId, orderId: order.id }));
  }
  const failed = results.filter((r) => !orderApproved(r) || r.error);
  await updateState((s) => {
    const p = s.proposals.find((x) => x.id === proposalId)!;
    for (const r of results) {
      const i = s.orders.findIndex((o) => o.id === r.id);
      if (i < 0) continue;
      const before = s.orders[i];
      s.orders[i] = r;
      const supplier = supplierById(r.supplierId)?.name;
      if (r.intent === "AUTHORIZE" && r.authorization && !before.authorization) {
        s.audit.push(
          auditEntry({
            actor: "system",
            message: `Order ${r.id} at ${supplier}: ${fmt(r.authorization.amountCents)} authorized on the card on file (authorization ${r.authorization.id} ${r.authorization.status}${r.authorization.expiresAt ? `, valid until ${fmtDay(r.authorization.expiresAt.slice(0, 10))}` : ""}). Nothing is captured until the signed delivery note confirms what arrived.`,
            ref: { proposalId, orderId: r.id },
            amountCents: r.authorization.amountCents,
          }),
        );
      } else if (r.intent !== "AUTHORIZE" && r.status === "COMPLETED" && !s.orders[i].received) {
        receive(s, s.orders[i]);
        s.audit.push(
          auditEntry({
            actor: "system",
            message: `Order ${r.id} paid at ${supplier} (${fmt(r.totalCents)}, capture ${r.captureId} ${r.captureStatus}). Stock updated; delivery tomorrow.`,
            ref: { proposalId, orderId: r.id },
            amountCents: r.totalCents,
          }),
        );
      }
    }
    p.status = failed.length ? "failed" : "completed";
    p.error = failed.length ? failed.map((f) => f.error ?? `Order ${f.id} is ${f.status}`).join("; ") : undefined;
  });
  if (failed.length) throw new CommerceError(failed.find((r) => r.error)?.error ?? "Some orders could not be paid.", 502);
}

/**
 * The signed delivery note for an authorized order comes back: capture what it confirms, release
 * the rest. In the public demo the delivery note is scripted ("scripted": everything arrives except
 * one unit of the largest line; "nothing": the delivery never came) and labelled as such; in
 * production Supplora captures the signed note at the kitchen door. Amounts are computed in code
 * from the order's own lines (settlement.ts); the owner's click only says the note is in.
 */
export async function settleDelivery(orderId: string, outcome: "scripted" | "nothing"): Promise<StoreOrder> {
  const startedAt = new Date().toISOString();
  const claimed = await updateState((s) => {
    const o = s.orders.find((x) => x.id === orderId);
    if (!o) throw new CommerceError("Order not found.", 404);
    if (o.intent !== "AUTHORIZE" || !o.authorization) throw new CommerceError("This order was paid at checkout: there is no authorization to settle.", 409);
    if (o.delivery || o.captureId || o.authorization.status !== "CREATED") {
      throw new CommerceError(`This order is already settled (authorization ${o.authorization.status}).`, 409);
    }
    if (o.settlingSince && Date.now() - Date.parse(o.settlingSince) < 120_000) throw new CommerceError("This delivery is already being settled.", 409);
    o.settlingSince = startedAt;
    o.error = undefined;
    return o;
  });
  const auth = claimed.authorization!;
  const delivered = outcome === "nothing" ? nothingDelivered(claimed.lines) : scriptedDelivery(claimed.lines);
  let plan: SettlementPlan;
  try {
    plan = planSettlement(claimed.lines, auth.amountCents, delivered);
  } catch (err) {
    await updateState((s) => {
      const o = s.orders.find((x) => x.id === orderId);
      if (o) o.settlingSince = undefined;
    });
    throw new CommerceError(err instanceof SettlementError ? err.message : "Could not settle this delivery.", 400);
  }
  const supplier = supplierById(claimed.supplierId)?.name ?? claimed.supplierId;
  const noteNumber = `DN-${claimed.id.slice(-6)}`;
  const ref = { orderId, proposalId: claimed.proposalId };
  let captureId: string | undefined;
  let captureStatus: string | undefined;
  let authStatus = auth.status;
  try {
    if (plan.action === "capture") {
      const cap = await captureAuthorization({
        authorizationId: auth.id,
        amountCents: plan.captureCents,
        invoiceId: `${orderId}-${noteNumber}`,
        note: plan.shortages.length ? `Delivery note ${noteNumber}: ${plan.shortages.join("; ")}. Only delivered goods are charged.` : `Delivery note ${noteNumber}: delivered in full.`,
        ref,
      });
      captureId = cap.id;
      captureStatus = cap.status;
      authStatus = "CAPTURED";
      await indexPayPalResources([cap.id]);
    } else {
      authStatus = (await voidAuthorization(auth.id, ref, auth.amountCents)).status;
    }
  } catch (err) {
    const message = err instanceof PayPalError ? err.message : err instanceof Error ? err.message : "PayPal error";
    await updateState((s) => {
      const o = s.orders.find((x) => x.id === orderId);
      if (o) {
        o.settlingSince = undefined;
        o.error = `Delivery not settled: ${message}`;
      }
    });
    throw new CommerceError(`PayPal did not settle the delivery: ${message}`, 502);
  }
  return updateState((s) => {
    const o = s.orders.find((x) => x.id === orderId)!;
    const at = new Date().toISOString();
    o.settlingSince = undefined;
    o.error = undefined;
    o.authorization = { ...o.authorization!, status: authStatus };
    // A verified webhook may have recorded the capture already: PayPal's answer above is the same capture.
    o.captureId = captureId ?? o.captureId;
    o.captureStatus = captureStatus ?? o.captureStatus;
    o.capturedCents = plan.captureCents;
    o.releasedCents = plan.releaseCents;
    o.delivery = {
      noteNumber,
      receivedAt: at,
      receivedBy: "Javi (kitchen)",
      scripted: true,
      lines: plan.lines.map((l) => ({ sku: l.sku, name: l.name, ordered: l.ordered, delivered: l.delivered, unitGrossCents: l.unitGrossCents })),
      confirmedCents: plan.captureCents,
    };
    o.updatedBy = { source: "app", at };
    receive(s, o, delivered);
    s.audit.push(
      auditEntry({
        actor: "system",
        message:
          plan.action === "capture"
            ? `Delivery note ${noteNumber} from ${supplier} (scripted demo delivery): ${plan.shortages.length ? `${plan.shortages.join("; ")} arrived, everything else in full` : "everything arrived"}. Stock updated with what arrived.`
            : `Delivery note ${noteNumber} from ${supplier} (scripted demo delivery): nothing arrived.`,
        ref,
      }),
      auditEntry({
        actor: "system",
        message:
          plan.action === "capture"
            ? `Paid only for what arrived: ${fmt(plan.authorizedCents)} authorized → ${fmt(plan.captureCents)} captured (capture ${captureId} ${captureStatus}) → ${fmt(plan.releaseCents)} released to the card.`
            : `Nothing arrived: authorization ${auth.id} voided, all ${fmt(plan.authorizedCents)} released to the card.`,
        ref,
        amountCents: plan.captureCents,
      }),
    );
    return o;
  });
}

export async function declineProposal(proposalId: string): Promise<void> {
  await updateState((s) => {
    const p = s.proposals.find((x) => x.id === proposalId);
    if (!p) throw new CommerceError("Restock proposal not found.", 404);
    if (p.status !== "awaiting_approval") throw new CommerceError(`This proposal is ${p.status}.`, 409);
    p.status = "declined";
    s.audit.push(auditEntry({ actor: "owner", message: `${RESTAURANT.ownerFirstName} declined the restock proposal. The unpaid PayPal orders will expire.`, ref: { proposalId } }));
  });
}

/** Owner buys directly in a supplier store: create, confirm with the card on file, capture. */
export async function ownerCheckout(supplierId: string, items: { sku: string; qty: number }[]): Promise<StoreOrder> {
  const lines = priceCart(supplierId, items);
  const totals = cartTotals(lines);
  const supplier = supplierById(supplierId)!;
  const localId = newId("ord");
  const created = await createOrder({ localId, storeName: supplier.name, lines, ref: {}, source: "owner", intent: "CAPTURE" });
  await indexPayPalResources([created.id]);
  let order: StoreOrder = { id: created.id, supplierId, createdAt: new Date().toISOString(), source: "owner", lines, ...totals, intent: "CAPTURE", status: created.status };
  order = await payOrder(order, { orderId: order.id });
  await updateState((s) => {
    s.orders.push(order);
    const saved = s.orders[s.orders.length - 1];
    if (saved.status === "COMPLETED") receive(s, saved);
    s.audit.push(
      auditEntry({
        actor: "owner",
        message:
          saved.status === "COMPLETED"
            ? `${RESTAURANT.ownerFirstName} bought ${lines.length} item${lines.length === 1 ? "" : "s"} at ${supplier.name}: order ${saved.id} paid (${fmt(saved.totalCents)}, capture ${saved.captureId}).`
            : `${RESTAURANT.ownerFirstName}'s order at ${supplier.name} could not be paid: ${saved.error}`,
        ref: { orderId: saved.id },
        amountCents: saved.totalCents,
      }),
    );
  });
  if (order.status !== "COMPLETED") throw new CommerceError(order.error ?? "Payment failed", 502);
  return order;
}
