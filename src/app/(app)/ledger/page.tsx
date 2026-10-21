import type { Metadata } from "next";
import { connection } from "next/server";
import { AuditLog } from "@/components/client/AuditLog";
import { PayablesSection } from "@/components/client/PayablesSection";
import { ReconcilePanel } from "@/components/client/ReconcilePanel";
import { orderStatus } from "@/components/OrderCard";
import { Card, Kpi, Mono, PageHeader, Pill, SectionTitle } from "@/components/ui";
import { supplierById } from "@/data/seed";
import { ledgerStats } from "@/lib/ap";
import { businessToday, fmtDateTime } from "@/lib/dates";
import { fmt } from "@/lib/money";
import { buildPayableRows } from "@/lib/payables-view";
import { orderPaidCents } from "@/lib/settlement";
import { readState } from "@/lib/state";
import { updatedByLabel, webhookSeenLabel } from "@/lib/webhook-events";

export const metadata: Metadata = { title: "Ledger" };

export default async function LedgerPage() {
  await connection();
  const state = await readState();
  const today = businessToday();
  const s = ledgerStats(state, today);
  const payableRows = buildPayableRows(state);
  const apiCalls = state.audit.filter((a) => a.actor === "paypal").length;
  const sentHint =
    s.sentCount === 0
      ? "nothing sent yet"
      : s.awaitingClaimCount > 0
        ? `${s.sentCount} payout${s.sentCount === 1 ? "" : "s"}; ${s.awaitingClaimCount} awaiting the supplier's claim (${fmt(s.awaitingClaimCents)})`
        : `${s.sentCount} payout${s.sentCount === 1 ? "" : "s"}, claimed by the supplier`;

  return (
    <div className="space-y-10">
      <PageHeader kicker="Ledger" title="Every euro, every decision">
        What was sent through PayPal, withheld and held, the discounts captured, and an audit trail of every agent decision and every PayPal API
        call (method, endpoint, status, resource id; never credentials).
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Sent via PayPal" value={fmt(s.sentCents)} hint={sentHint} />
        <Kpi
          label="Withheld (credit notes)"
          value={fmt(s.withheldCents)}
          hint={`${s.disputedCount} invoice${s.disputedCount === 1 ? "" : "s"}, until the supplier sends a credit note`}
          tone="terracotta"
        />
        <Kpi label="Held" value={fmt(s.heldCents)} hint={`${s.heldCount} invoice${s.heldCount === 1 ? "" : "s"} not paid`} tone="terracotta" />
        <Kpi
          label="Discounts captured"
          value={fmt(s.discountsCapturedCents)}
          hint={s.discountsAvailableCents > 0 ? `${fmt(s.discountsAvailableCents)} still available` : "early-payment discounts taken"}
          tone="olive"
        />
      </div>

      <Card className="p-5 sm:p-6">
        <SectionTitle kicker="Kept back or saved" title="What the checks held back, and what was saved" />
        <dl className="grid gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-sm text-muted">Overcharges withheld</dt>
            <dd className="num text-xl font-semibold text-terracotta">{fmt(s.overchargesCaughtCents)}</dd>
            <dd className="text-xs text-muted">price rises, short deliveries, wrong totals; recovered once the supplier sends the credit note</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Double payments held</dt>
            <dd className="num text-xl font-semibold text-terracotta">{fmt(s.duplicatesBlockedCents)}</dd>
            <dd className="text-xs text-muted">invoices already paid, not paid again</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Early-payment discounts captured</dt>
            <dd className="num text-xl font-semibold text-olive">{fmt(s.discountsCapturedCents)}</dd>
            {s.discountsAvailableCents > 0 && <dd className="text-xs text-muted">{fmt(s.discountsAvailableCents)} still available</dd>}
          </div>
          <div>
            <dt className="text-sm text-muted">Restock orders captured</dt>
            <dd className="num text-xl font-semibold text-ink">{fmt(s.ordersCents)}</dd>
            <dd className="text-xs text-muted">
              {s.ordersCount} PayPal order{s.ordersCount === 1 ? "" : "s"}
              {s.ordersReleasedCents > 0 && ` · ${fmt(s.ordersReleasedCents)} released (did not arrive)`}
              {s.ordersHeldCents > 0 && ` · ${fmt(s.ordersHeldCents)} authorized, awaiting delivery`}
            </dd>
          </div>
        </dl>
      </Card>

      <section aria-labelledby="invoices">
        <SectionTitle
          id="invoices"
          kicker="Accounts payable"
          title="Payables"
          aside={<span className="text-xs text-muted">AG Grid + AG Charts (Community) · cross-filtered</span>}
        />
        {payableRows.length === 0 ? (
          <Card className="px-6 py-10 text-center text-muted">Nothing reviewed yet. Review the inbox to populate the ledger.</Card>
        ) : (
          <Card className="p-4 sm:p-5">
            <PayablesSection rows={payableRows} today={today} />
          </Card>
        )}
      </section>

      <section aria-labelledby="reconcile-title">
        <SectionTitle id="reconcile-title" kicker="PayPal Agent Toolkit · REST Payouts" title="Reconcile with PayPal" />
        <Card className="p-5 sm:p-6">
          <ReconcilePanel last={state.reconciliation ?? null} hasPayments={state.batches.length > 0 || state.orders.length > 0} />
        </Card>
      </section>

      {state.orders.length > 0 && (
        <section aria-labelledby="orders">
          <SectionTitle
            id="orders"
            kicker="PayPal Orders v2 · Payments v2"
            title="Store orders"
            aside={<span className="text-xs text-muted">Agent restocks: authorized at approval, captured for what the delivery note confirms</span>}
          />
          <Card className="table-wrap">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-line bg-paper/60 text-left text-[11px] uppercase tracking-wider text-muted">
                  <th scope="col" className="py-2.5 pl-5 pr-2 font-semibold">Store</th>
                  <th scope="col" className="px-2 py-2.5 font-semibold">PayPal ids</th>
                  <th scope="col" className="px-2 py-2.5 text-right font-semibold">Authorized</th>
                  <th scope="col" className="px-2 py-2.5 text-right font-semibold">Captured</th>
                  <th scope="col" className="px-2 py-2.5 text-right font-semibold">Released</th>
                  <th scope="col" className="px-2 py-2.5 font-semibold">Status</th>
                  <th scope="col" className="py-2.5 pl-2 pr-5 font-semibold">Last PayPal update</th>
                </tr>
              </thead>
              <tbody>
                {[...state.orders].reverse().map((o) => {
                  const st = orderStatus(o);
                  const authorize = o.intent === "AUTHORIZE";
                  const paid = orderPaidCents(o);
                  return (
                    <tr key={o.id} className="border-b border-line align-top last:border-0">
                      <td className="py-2.5 pl-5 pr-2">
                        <span className="font-medium">{supplierById(o.supplierId)?.name}</span>
                        <span className="block text-xs text-muted">
                          {o.source === "agent" ? "Purchasing agent" : "Owner"} · {fmtDateTime(o.createdAt)}
                        </span>
                      </td>
                      <td className="px-2 py-2.5">
                        <Mono>{o.id}</Mono>
                        {o.authorization && <Mono className="block text-muted">auth {o.authorization.id}</Mono>}
                        {o.captureId && <Mono className="block text-muted">capture {o.captureId}</Mono>}
                        {o.delivery && <span className="block text-xs text-muted">delivery note {o.delivery.noteNumber}</span>}
                      </td>
                      <td className="num px-2 py-2.5 text-right">{authorize ? fmt(o.authorization?.amountCents ?? null) : "—"}</td>
                      <td className="num px-2 py-2.5 text-right font-medium">{paid > 0 ? fmt(paid) : authorize && o.capturedCents === 0 ? fmt(0) : "—"}</td>
                      <td className="num px-2 py-2.5 text-right text-ink-2">{authorize && o.releasedCents != null ? fmt(o.releasedCents) : "—"}</td>
                      <td className="px-2 py-2.5">
                        <Pill tone={st.tone}>{st.label}</Pill>
                      </td>
                      <td className="py-2.5 pl-2 pr-5 text-xs text-ink-2">
                        {updatedByLabel(o.updatedBy) ?? "—"}
                        {o.updatedBy?.at && <span className="block text-muted">{fmtDateTime(o.updatedBy.at)}</span>}
                        {o.lastWebhook && o.updatedBy?.eventId !== o.lastWebhook.eventId && (
                          <span className="block text-muted">{webhookSeenLabel(o.lastWebhook)} received</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </section>
      )}

      <section aria-labelledby="audit-title" id="audit">
        <SectionTitle id="audit-title" kicker={`${state.audit.length} entries · ${apiCalls} PayPal API calls`} title="Audit log" />
        <Card className="p-5 sm:p-6">
          <AuditLog entries={[...state.audit].reverse()} />
        </Card>
      </section>
    </div>
  );
}
