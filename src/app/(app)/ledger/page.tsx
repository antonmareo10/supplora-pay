import type { Metadata } from "next";
import { connection } from "next/server";
import { AuditLog } from "@/components/client/AuditLog";
import { PayablesSection } from "@/components/client/PayablesSection";
import { orderStatus } from "@/components/OrderCard";
import { Card, Kpi, Mono, PageHeader, Pill, SectionTitle } from "@/components/ui";
import { supplierById } from "@/data/seed";
import { ledgerStats } from "@/lib/ap";
import { businessToday, fmtDateTime } from "@/lib/dates";
import { fmt } from "@/lib/money";
import { buildPayableRows } from "@/lib/payables-view";
import { readState } from "@/lib/state";

export const metadata: Metadata = { title: "Ledger" };

export default async function LedgerPage() {
  await connection();
  const state = await readState();
  const today = businessToday();
  const s = ledgerStats(state, today);
  const payableRows = buildPayableRows(state);
  const apiCalls = state.audit.filter((a) => a.actor === "paypal").length;

  return (
    <div className="space-y-10">
      <PageHeader kicker="Ledger" title="Every euro, every decision">
        What was paid, held and disputed, the money Supplora saved, and an audit trail of every agent decision and every PayPal API call (method,
        endpoint, status, resource id; never credentials).
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Paid via PayPal" value={fmt(s.paidCents)} hint={`${s.paidCount} supplier payment${s.paidCount === 1 ? "" : "s"}`} />
        <Kpi label="Withheld (disputes)" value={fmt(s.withheldCents)} hint={`${s.disputedCount} invoice${s.disputedCount === 1 ? "" : "s"} paid partially`} tone="terracotta" />
        <Kpi label="Held" value={fmt(s.heldCents)} hint={`${s.heldCount} invoice${s.heldCount === 1 ? "" : "s"} not paid`} tone="terracotta" />
        <Kpi label="Money saved" value={fmt(s.protectedCents)} hint="overcharges + duplicates + discounts" tone="olive" />
      </div>

      <Card className="p-5 sm:p-6">
        <SectionTitle kicker="Savings" title="Where the savings come from" />
        <dl className="grid gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-sm text-muted">Overcharges caught</dt>
            <dd className="num text-xl font-semibold text-terracotta">{fmt(s.overchargesCaughtCents)}</dd>
            <dd className="text-xs text-muted">price rises, short deliveries, wrong totals</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Double payments blocked</dt>
            <dd className="num text-xl font-semibold text-terracotta">{fmt(s.duplicatesBlockedCents)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Early-payment discounts</dt>
            <dd className="num text-xl font-semibold text-olive">{fmt(s.discountsCapturedCents)}</dd>
            {s.discountsAvailableCents > 0 && <dd className="text-xs text-muted">{fmt(s.discountsAvailableCents)} still available</dd>}
          </div>
          <div>
            <dt className="text-sm text-muted">Restock orders paid</dt>
            <dd className="num text-xl font-semibold text-ink">{fmt(s.ordersCents)}</dd>
            <dd className="text-xs text-muted">{s.ordersCount} PayPal order{s.ordersCount === 1 ? "" : "s"}</dd>
          </div>
        </dl>
      </Card>

      <section aria-labelledby="invoices">
        <SectionTitle
          id="invoices"
          kicker="Accounts payable"
          title="Payables"
          aside={<span className="text-xs text-muted">Interactive grid · AG Grid</span>}
        />
        {payableRows.length === 0 ? (
          <Card className="px-6 py-10 text-center text-muted">Nothing reviewed yet. Review the inbox to populate the ledger.</Card>
        ) : (
          <Card className="p-4 sm:p-5">
            <PayablesSection rows={payableRows} today={today} />
          </Card>
        )}
      </section>

      {state.orders.length > 0 && (
        <section aria-labelledby="orders">
          <SectionTitle id="orders" kicker="PayPal Orders v2" title="Store orders" />
          <Card className="table-wrap">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-line bg-paper/60 text-left text-[11px] uppercase tracking-wider text-muted">
                  <th scope="col" className="py-2.5 pl-5 pr-2 font-semibold">Store</th>
                  <th scope="col" className="px-2 py-2.5 font-semibold">Created by</th>
                  <th scope="col" className="px-2 py-2.5 font-semibold">Order · capture</th>
                  <th scope="col" className="px-2 py-2.5 text-right font-semibold">Total</th>
                  <th scope="col" className="py-2.5 pl-2 pr-5 text-right font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {[...state.orders].reverse().map((o) => {
                  const st = orderStatus(o);
                  return (
                    <tr key={o.id} className="border-b border-line last:border-0">
                      <td className="py-2.5 pl-5 pr-2 font-medium">{supplierById(o.supplierId)?.name}</td>
                      <td className="px-2 py-2.5 text-ink-2">
                        {o.source === "agent" ? "Purchasing agent" : "Owner"}
                        <span className="block text-xs text-muted">{fmtDateTime(o.createdAt)}</span>
                      </td>
                      <td className="px-2 py-2.5">
                        <Mono>{o.id}</Mono>
                        {o.captureId && <Mono className="block text-muted">{o.captureId}</Mono>}
                      </td>
                      <td className="num px-2 py-2.5 text-right">{fmt(o.totalCents)}</td>
                      <td className="py-2.5 pl-2 pr-5 text-right">
                        <Pill tone={st.tone}>{o.status}</Pill>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </section>
      )}

      <section aria-labelledby="audit-title" id="audit" className="scroll-mt-24">
        <SectionTitle id="audit-title" kicker={`${state.audit.length} entries · ${apiCalls} PayPal API calls`} title="Audit log" />
        <Card className="p-5 sm:p-6">
          <AuditLog entries={[...state.audit].reverse()} />
        </Card>
      </section>
    </div>
  );
}
