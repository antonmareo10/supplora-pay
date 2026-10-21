import Link from "next/link";
import { supplierById } from "@/data/seed";
import { fmtDateTime } from "@/lib/dates";
import { fmt } from "@/lib/money";
import { orderPhase, planSettlement, scriptedDelivery } from "@/lib/settlement";
import type { StoreOrder } from "@/lib/types";
import { updatedByLabel, webhookSeenLabel } from "@/lib/webhook-events";
import { DeliveryActions } from "./client/DeliveryActions";
import { IconExternal } from "./icons";
import { cx, Mono, Pill, type Tone } from "./ui";

export function orderStatus(o: StoreOrder): { label: string; tone: Tone } {
  switch (orderPhase(o)) {
    case "awaiting_approval":
      return { label: "Checkout created · awaiting approval", tone: "ledger" };
    case "approving":
      return { label: o.intent === "AUTHORIZE" ? "Approved · authorizing" : "Approved · capturing", tone: "ledger" };
    case "authorized":
      return { label: "Authorized · awaiting delivery note", tone: "saffron" };
    case "settling":
      return { label: "Settling with PayPal…", tone: "ledger" };
    case "captured":
      return { label: `Paid for what arrived · capture ${o.captureStatus ?? "COMPLETED"}`, tone: "olive" };
    case "voided":
      return { label: "Nothing arrived · authorization voided", tone: "muted" };
    case "paid":
      return { label: `Paid · capture ${o.captureStatus ?? "COMPLETED"}`, tone: "olive" };
    case "refunded":
      return { label: "Refunded", tone: "muted" };
    default:
      return { label: "Payment failed", tone: "terracotta" };
  }
}

/** Authorized → captured → released, for orders paid only for what arrived. */
function SettlementTrail({ order }: { order: StoreOrder }) {
  const auth = order.authorization;
  if (order.intent !== "AUTHORIZE" || !auth) return null;
  const phase = orderPhase(order);
  const settled = phase === "captured" || phase === "voided" || phase === "refunded";
  const steps: { label: string; value: string; note: string; tone: string }[] = [
    { label: "Authorized", value: fmt(auth.amountCents), note: "held on the card on file", tone: "text-ink" },
    settled
      ? {
          label: "Captured",
          value: fmt(order.capturedCents ?? 0),
          note: order.delivery ? `what ${order.delivery.noteNumber} confirms` : "per PayPal",
          tone: "text-olive",
        }
      : { label: "Captured", value: "—", note: "when the delivery note is in", tone: "text-muted" },
    settled
      ? { label: "Released", value: fmt(order.releasedCents ?? 0), note: phase === "voided" ? "authorization voided" : "back to the card", tone: "text-ink-2" }
      : { label: "Released", value: "—", note: "whatever did not arrive", tone: "text-muted" },
  ];
  return (
    <ol className="grid grid-cols-3 border-t border-line bg-paper/50 text-sm" aria-label="Payment for this order">
      {steps.map((s, i) => (
        <li key={s.label} className={cx("min-w-0 px-4 py-2.5", i > 0 && "border-l border-dashed border-line")}>
          <p className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">
            {i > 0 && <span aria-hidden="true">→ </span>}
            {s.label}
          </p>
          <p className={cx("num text-base font-semibold", s.tone)}>{s.value}</p>
          <p className="text-[11px] leading-snug text-muted">{s.note}</p>
        </li>
      ))}
    </ol>
  );
}

export function OrderCard({ order, settleEnabled = true }: { order: StoreOrder; settleEnabled?: boolean }) {
  const supplier = supplierById(order.supplierId);
  const st = orderStatus(order);
  const phase = orderPhase(order);
  const delivered = new Map(order.delivery?.lines.map((l) => [l.sku, l.delivered]) ?? []);
  const source = updatedByLabel(order.updatedBy);
  // What the scripted delivery would capture, computed by the same code the settlement runs.
  const preview =
    phase === "authorized" && order.authorization && !order.delivery
      ? planSettlement(order.lines, order.authorization.amountCents, scriptedDelivery(order.lines))
      : null;
  return (
    <article className="overflow-hidden rounded-xl border border-line bg-card">
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3" style={{ borderTop: `3px solid ${supplier?.store?.accent ?? "var(--ledger)"}`, borderTopLeftRadius: 12, borderTopRightRadius: 12 }}>
        <div className="min-w-0">
          <Link href={`/store/${order.supplierId}`} className="inline-flex items-center gap-1 font-semibold text-ink hover:text-ledger">
            {supplier?.name ?? order.supplierId} <IconExternal size={13} />
          </Link>
          <p className="text-xs text-muted">
            PayPal order <Mono>{order.id}</Mono>
            {order.intent === "AUTHORIZE" && <> · intent AUTHORIZE</>}
            {order.authorization && (
              <>
                {" "}
                · authorization <Mono>{order.authorization.id}</Mono>
              </>
            )}
            {order.captureId && (
              <>
                {" "}
                · capture <Mono>{order.captureId}</Mono>
              </>
            )}
          </p>
        </div>
        <Pill tone={st.tone}>{st.label}</Pill>
      </header>
      <ul className="divide-y divide-dashed divide-line px-4 text-sm">
        {order.lines.map((l) => {
          const got = delivered.get(l.sku);
          const short = got != null && got < l.qty;
          return (
            <li key={l.sku} className="flex gap-3 py-2">
              <span className="num w-8 shrink-0 font-semibold text-ink">{l.qty}×</span>
              <span className="min-w-0 flex-1">
                <span className="text-ink">{l.name}</span>
                {l.reason && <span className="block text-xs text-muted">{l.reason}</span>}
                {got != null && (
                  <span className={cx("block text-xs", short ? "font-semibold text-terracotta" : "text-olive")}>
                    {short ? `Delivery note: ${got} of ${l.qty} arrived` : "Delivery note: all arrived"}
                  </span>
                )}
              </span>
              <span className="num shrink-0 text-ink-2">{fmt(l.netCents)}</span>
            </li>
          );
        })}
      </ul>
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-sm">
        <span className="text-xs text-muted">
          {order.source === "agent" ? "Created by the purchasing agent" : "Bought by the owner"} · {fmtDateTime(order.createdAt)}
          {order.cardLabel && ` · ${order.cardLabel} (PayPal Vault)`}
        </span>
        <span className="num">
          <span className="text-xs text-muted">
            {fmt(order.netCents)} + VAT {fmt(order.vatCents)} ={" "}
          </span>
          <strong className="text-ink">{fmt(order.totalCents)}</strong>
        </span>
      </footer>
      <SettlementTrail order={order} />
      {order.delivery && (
        <p className="border-t border-line px-4 py-2 text-xs text-muted">
          Delivery note <Mono>{order.delivery.noteNumber}</Mono> signed by {order.delivery.receivedBy} · {fmtDateTime(order.delivery.receivedAt)}
          {order.delivery.scripted && <> · scripted demo delivery (in production Supplora captures the signed note at the kitchen door)</>}
        </p>
      )}
      {preview && settleEnabled && (
        <DeliveryActions orderId={order.id} authorizedCents={preview.authorizedCents} captureCents={preview.captureCents} releaseCents={preview.releaseCents} shortages={preview.shortages} />
      )}
      {source && phase !== "awaiting_approval" && (
        <p className="border-t border-line px-4 py-1.5 text-[11px] text-muted">
          Last PayPal status from: <span className="font-medium text-ink-2">{source}</span>
          {order.updatedBy?.at && ` · ${fmtDateTime(order.updatedBy.at)}`}
          {order.lastWebhook && order.updatedBy?.eventId !== order.lastWebhook.eventId && ` · ${webhookSeenLabel(order.lastWebhook)} received`}
        </p>
      )}
      {order.error && <p className="border-t border-line px-4 py-2 text-xs text-terracotta">{order.error}</p>}
    </article>
  );
}
