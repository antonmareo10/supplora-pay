// Does the PayPal order (read back through the PayPal Agent Toolkit's get_order) match the checkout
// the agent created and the owner is approving? Used twice: the purchasing agent must verify each
// checkout before submit_for_approval accepts it, and the owner's approval re-reads the order and
// refuses to authorize or capture if PayPal's amount, currency, id or status differs.
//
// Pure, unit-tested in order-checks.test.ts.

import { fmt } from "./money.ts";
import { orderFacts, type ToolkitResult } from "./paypal-facts.ts";
import type { StoreOrder } from "./types.ts";

export function checkOrderMatches(order: Pick<StoreOrder, "id" | "totalCents">, r: ToolkitResult): { ok: boolean; reason: string } {
  if (!r.ok) return { ok: false, reason: `PayPal Agent Toolkit get_order failed: ${r.error}` };
  const f = orderFacts(r.data);
  if (f.id !== order.id) return { ok: false, reason: `PayPal returned order ${f.id}, expected ${order.id}` };
  if (f.currency !== "EUR" || f.amountCents !== order.totalCents) {
    return { ok: false, reason: `PayPal shows ${f.currency} ${f.amountCents != null ? (f.amountCents / 100).toFixed(2) : "?"} for ${order.id}, but the checkout is ${fmt(order.totalCents)}` };
  }
  if (!["CREATED", "APPROVED"].includes(f.status)) return { ok: false, reason: `Order ${order.id} is ${f.status} on PayPal, expected CREATED` };
  return { ok: true, reason: `${order.id} is ${f.status} on PayPal for ${fmt(order.totalCents)}` };
}
