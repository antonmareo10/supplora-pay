// What a PayPal Agent Toolkit call returned, and the facts the app reads from a get_order result.
// Pure (no SDK, Node or Next APIs) so the order checks built on it are unit-tested
// (order-checks.test.ts). paypal-toolkit.ts re-exports both.

import { fromDecimalString } from "./money.ts";

export interface ToolkitResult {
  ok: boolean;
  /** Parsed JSON the toolkit returned (the PayPal API response, or its error object). */
  data: Record<string, unknown>;
  /** Raw text the toolkit returned (what Claude sees). */
  text: string;
  error?: string;
  status?: number;
  durationMs: number;
}

/** Status, amount, authorization and captures of an order as returned by get_order. */
export function orderFacts(data: Record<string, unknown>) {
  type Money = { value?: string; currency_code?: string };
  const pu = (
    data.purchase_units as
      | {
          amount?: Money;
          payments?: { captures?: { id: string; status: string; amount?: Money }[]; authorizations?: { id: string; status: string; amount?: Money }[] };
        }[]
      | undefined
  )?.[0];
  const money = (m?: Money) => {
    try {
      return m?.value ? fromDecimalString(m.value) : null;
    } catch {
      return null;
    }
  };
  const captures = pu?.payments?.captures ?? [];
  const auth = pu?.payments?.authorizations?.[0];
  return {
    id: String(data.id ?? ""),
    status: String(data.status ?? ""),
    intent: typeof data.intent === "string" ? data.intent : undefined,
    amountCents: money(pu?.amount),
    currency: pu?.amount?.currency_code ?? "",
    captureId: captures[0]?.id,
    captureStatus: captures[0]?.status,
    capturedCents: captures.length ? captures.reduce((s, c) => s + (money(c.amount) ?? 0), 0) : null,
    authorizationId: auth?.id,
    authorizationStatus: auth?.status,
    authorizationCents: money(auth?.amount),
  };
}
