import Link from "next/link";
import { supplierById } from "@/data/seed";
import { fmtDateTime } from "@/lib/dates";
import { fmt } from "@/lib/money";
import type { StoreOrder } from "@/lib/types";
import { IconExternal } from "./icons";
import { Mono, Pill, type Tone } from "./ui";

export function orderStatus(o: StoreOrder): { label: string; tone: Tone } {
  if (o.status === "COMPLETED") return { label: `Paid · capture ${o.captureStatus ?? "COMPLETED"}`, tone: "olive" };
  if (o.error) return { label: "Payment failed", tone: "terracotta" };
  if (o.status === "CREATED") return { label: "Checkout created · awaiting approval", tone: "ledger" };
  if (o.status === "APPROVED") return { label: "Approved · capturing", tone: "ledger" };
  return { label: o.status, tone: "muted" };
}

export function OrderCard({ order }: { order: StoreOrder }) {
  const supplier = supplierById(order.supplierId);
  const st = orderStatus(order);
  return (
    <article className="rounded-xl border border-line bg-card">
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3" style={{ borderTop: `3px solid ${supplier?.store?.accent ?? "var(--ledger)"}`, borderTopLeftRadius: 12, borderTopRightRadius: 12 }}>
        <div>
          <Link href={`/store/${order.supplierId}`} className="inline-flex items-center gap-1 font-semibold text-ink hover:text-ledger">
            {supplier?.name ?? order.supplierId} <IconExternal size={13} />
          </Link>
          <p className="text-xs text-muted">
            PayPal order <Mono>{order.id}</Mono>
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
        {order.lines.map((l) => (
          <li key={l.sku} className="flex gap-3 py-2">
            <span className="num w-8 shrink-0 font-semibold text-ink">{l.qty}×</span>
            <span className="min-w-0 flex-1">
              <span className="text-ink">{l.name}</span>
              {l.reason && <span className="block text-xs text-muted">{l.reason}</span>}
            </span>
            <span className="num shrink-0 text-ink-2">{fmt(l.netCents)}</span>
          </li>
        ))}
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
      {order.error && <p className="border-t border-line px-4 py-2 text-xs text-terracotta">{order.error}</p>}
    </article>
  );
}
