// Which PayPal Agent Toolkit tools Supplora Pay may use, and for what. Pure module (no
// imports) so the unit tests can check the policy against the real toolkit package.
//
// Three layers keep agents away from money movement:
//   1. TOOLKIT_ACTIONS is the `configuration.actions` handed to the toolkit: it only enables
//      reading orders and listing transactions, so the toolkit never registers pay_order,
//      refunds, invoices or dispute actions in the first place.
//   2. After connecting, every tool the toolkit lists is checked against TOOLKIT_ALLOWLIST and
//      the connection fails closed if anything else shows up (e.g. after a toolkit upgrade).
//   3. Each consumer gets only the subset it needs: the purchasing agent (Claude) gets get_order;
//      the ledger reconciliation (server code, no model) gets list_transactions and get_order.

export const TOOLKIT_ACTIONS = {
  orders: { get: true },
  transactions: { list: true },
} as const satisfies Record<string, Record<string, boolean>>;

/** Every toolkit tool the app may ever call. */
export const TOOLKIT_ALLOWLIST = ["get_order", "list_transactions"] as const;
export type ToolkitToolName = (typeof TOOLKIT_ALLOWLIST)[number];

/** Toolkit tools handed to Claude in the restock agent. */
export const RESTOCK_AGENT_TOOLKIT_TOOLS = ["get_order"] as const satisfies readonly ToolkitToolName[];

/** Toolkit tools the ledger reconciliation calls (server code, not an agent). */
export const RECONCILE_TOOLKIT_TOOLS = ["list_transactions", "get_order"] as const satisfies readonly ToolkitToolName[];

/**
 * Toolkit tools that move money, commit the merchant, or act on a customer's behalf. None of
 * them may ever be allowlisted. (create_order is not here because it only creates an unpaid
 * order; the app still does not use it: in toolkit 1.11.0 it only accepts USD, and the
 * restaurant's suppliers bill in EUR, so EUR checkouts are created over REST.)
 */
export const FORBIDDEN_TOOLKIT_TOOLS = [
  "pay_order",
  "create_refund",
  "accept_dispute_claim",
  "create_invoice",
  "send_invoice",
  "send_invoice_reminder",
  "cancel_sent_invoice",
  "record_payment_for_invoice",
  "record_refund_for_invoice",
  "create_subscription",
  "update_subscription",
  "cancel_subscription",
  "create_recurring_series",
  "activate_recurring_series",
] as const;

export class ToolkitPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolkitPolicyError";
  }
}

/**
 * Checks the tools a toolkit connection actually exposes and returns the requested subset.
 * Throws if the toolkit exposes anything outside the allowlist (fail closed) or if a requested
 * tool is missing or not allowlisted.
 */
export function selectToolkitTools<T extends { name: string }>(listed: T[], wanted: readonly string[]): T[] {
  const allowed = new Set<string>(TOOLKIT_ALLOWLIST);
  const unexpected = listed.map((t) => t.name).filter((n) => !allowed.has(n));
  if (unexpected.length) {
    throw new ToolkitPolicyError(`PayPal Agent Toolkit exposed tools outside the allowlist: ${unexpected.join(", ")}. Refusing to continue.`);
  }
  return wanted.map((name) => {
    if (!allowed.has(name)) throw new ToolkitPolicyError(`${name} is not on the PayPal Agent Toolkit allowlist.`);
    const tool = listed.find((t) => t.name === name);
    if (!tool) throw new ToolkitPolicyError(`The PayPal Agent Toolkit did not expose ${name}.`);
    return tool;
  });
}
