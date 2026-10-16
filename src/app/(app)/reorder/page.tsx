import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { AgentTimeline } from "@/components/AgentTimeline";
import { AgentRunner, EuroField } from "@/components/client/AgentRunner";
import { ProposalApproval } from "@/components/client/ProposalApproval";
import { IconArrowRight, IconCard, IconSpark } from "@/components/icons";
import { OrderCard } from "@/components/OrderCard";
import { Card, cx, PageHeader, Pill, SectionTitle } from "@/components/ui";
import { storeSuppliers, supplierById } from "@/data/seed";
import { lowStock } from "@/lib/ap";
import { claudeConfigured } from "@/lib/claude";
import { fmtDateTime } from "@/lib/dates";
import { fmt } from "@/lib/money";
import { paypalConfigured } from "@/lib/paypal";
import { readState } from "@/lib/state";

export const metadata: Metadata = { title: "Reorder" };

export default async function ReorderPage() {
  await connection();
  const state = await readState();
  const low = lowStock(state);
  const active = [...state.proposals].reverse().find((p) => ["awaiting_approval", "paying", "failed"].includes(p.status));
  const activeOrders = active ? state.orders.filter((o) => active.orderIds.includes(o.id)) : [];
  const history = [...state.orders].reverse().filter((o) => !active?.orderIds.includes(o.id) && o.status === "COMPLETED");
  const card = state.cardOnFile ? `${state.cardOnFile.brand} •••• ${state.cardOnFile.last4}` : null;
  const ready = claudeConfigured() && paypalConfigured();

  return (
    <div className="space-y-10">
      <PageHeader kicker="Reorder · agentic commerce" title="Restock without the phone calls">
        The purchasing agent checks stock against par levels, browses your suppliers&apos; online stores and creates PayPal checkouts within the
        spending limit you set. It cannot pay: you approve, and the order is paid with the restaurant&apos;s card on file.
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <Card className="p-5 sm:p-6">
          <SectionTitle kicker="Stock vs par" title={`${low.length} items running low`} />
          <ul className="space-y-2.5">
            {state.inventory.map((i) => {
              const pct = Math.min(100, Math.round((i.onHand / i.par) * 100));
              const isLow = i.onHand < i.par;
              return (
                <li key={i.key} className="grid grid-cols-[minmax(0,1fr)_88px_64px] items-center gap-3 text-sm">
                  <span className="min-w-0">
                    <span className={cx("block truncate", isLow ? "font-medium text-ink" : "text-ink-2")}>{i.name}</span>
                    <span className="block truncate text-xs text-muted">{supplierById(i.supplierId)?.name}</span>
                  </span>
                  <span className="h-2 overflow-hidden rounded-full bg-paper-2" role="img" aria-label={`${i.onHand} of ${i.par} on hand`}>
                    <span className={cx("block h-full rounded-full", i.onHand === 0 ? "bg-terracotta" : isLow ? "bg-saffron" : "bg-olive-2")} style={{ width: `${Math.max(pct, 4)}%` }} />
                  </span>
                  <span className={cx("num text-right text-xs", isLow ? "font-semibold text-ink" : "text-muted")}>
                    {i.onHand}/{i.par} {i.unit}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>

        <div className="space-y-6">
          <Card className="p-5 sm:p-6">
            <SectionTitle kicker="Purchasing agent" title="Restock within a limit" />
            <AgentRunner
              endpoint="/api/restock"
              buttonLabel="Let the agent restock"
              runningLabel="Shopping…"
              disabled={!ready || low.length === 0 || active?.status === "awaiting_approval"}
              disabledReason={
                !ready
                  ? "Needs both ANTHROPIC_API_KEY and the PayPal sandbox credentials in .env.local."
                  : low.length === 0
                    ? "Everything is at par. Nothing to buy."
                    : active?.status === "awaiting_approval"
                      ? "A restock proposal is waiting for your approval below."
                      : undefined
              }
              fields={
                <EuroField
                  name="limitEur"
                  label="Spending limit (incl. VAT)"
                  defaultValue={state.settings.restockLimitCents / 100}
                  min={5}
                  max={5000}
                  hint="The agent can't create checkouts above this."
                />
              }
            />
            <p className="mt-4 flex items-center gap-2 text-xs text-muted">
              <IconCard size={14} /> Card on file: {card ? `${card} · stored in PayPal Vault (the app keeps only the vault token)` : "a sandbox test card, vaulted with PayPal on first payment"}
            </p>
          </Card>

          <Card className="p-5 sm:p-6">
            <SectionTitle kicker="Supplier stores" title="Where the agent shops" />
            <ul className="space-y-2">
              {storeSuppliers().map((s) => (
                <li key={s.id}>
                  <Link href={`/store/${s.id}`} className="group flex items-center justify-between gap-3 rounded-xl border border-line px-4 py-3 hover:border-line-2">
                    <span className="flex items-center gap-3">
                      <span className="h-8 w-1.5 rounded-full" style={{ background: s.store?.accent }} aria-hidden="true" />
                      <span>
                        <span className="block text-sm font-semibold text-ink group-hover:text-ledger">{s.name}</span>
                        <span className="block text-xs text-muted">{s.store?.leadTime}</span>
                      </span>
                    </span>
                    <IconArrowRight size={16} className="text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted">
              Each store publishes a machine-readable catalog (e.g. <code className="font-mono">/api/store/cleanpro/catalog</code>) that the agent reads.
            </p>
          </Card>
        </div>
      </div>

      {active && (
        <section aria-labelledby="proposal" className="space-y-4">
          <SectionTitle
            id="proposal"
            kicker={active.status === "awaiting_approval" ? "Waiting for your approval" : active.status === "failed" ? "Payment failed" : "Paying"}
            title={`Restock proposal · ${fmt(active.totalCents)} of ${fmt(active.limitCents)}`}
            aside={<span className="text-xs text-muted">{fmtDateTime(active.createdAt)}</span>}
          />
          <Card className="space-y-5 p-5 sm:p-6">
            <figure className="flex gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ledger text-white" aria-hidden="true">
                <IconSpark size={16} />
              </span>
              <blockquote className="font-display text-[22px] leading-snug text-ink">“{active.summary}”</blockquote>
            </figure>
            <div className="grid gap-4 md:grid-cols-2">
              {activeOrders.map((o) => (
                <OrderCard key={o.id} order={o} />
              ))}
            </div>
            <ProposalApproval proposal={active} cardLabel={card} />
            {active.agentLog.length > 0 && (
              <details className="rounded-xl border border-line bg-paper/50 p-4">
                <summary className="cursor-pointer text-sm font-medium text-ink-2">How the agent shopped ({active.agentLog.filter((e) => e.type === "tool_start").length} tool calls)</summary>
                <div className="mt-4">
                  <AgentTimeline events={active.agentLog} />
                </div>
              </details>
            )}
          </Card>
        </section>
      )}

      {history.length > 0 && (
        <section aria-labelledby="orders" className="space-y-4">
          <SectionTitle id="orders" kicker="PayPal Orders v2" title="Paid orders" aside={<Pill tone="olive">{history.length} paid</Pill>} />
          <div className="grid gap-4 md:grid-cols-2">
            {history.map((o) => (
              <OrderCard key={o.id} order={o} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
