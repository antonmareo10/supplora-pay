import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { AuditLog } from "@/components/client/AuditLog";
import { orderStatus } from "@/components/OrderCard";
import { Card, Kpi, Mono, PageHeader, Pill, SectionTitle } from "@/components/ui";
import { supplierById } from "@/data/seed";
import { effective, ledgerStats } from "@/lib/ap";
import { businessToday, fmtDateTime } from "@/lib/dates";
import { fmt } from "@/lib/money";
import { readState } from "@/lib/state";

export const metadata: Metadata = { title: "Ledger" };

const PAY_TONE = { paid: "olive", unclaimed: "olive", processing: "ledger", scheduled: "ledger", failed: "terracotta", unpaid: "muted", returned: "terracotta" } as const;

export default async function LedgerPage() {
  await connection();
  const state = await readState();
  const today = businessToday();
  const s = ledgerStats(state, today);
  const docs = state.documents.filter((d) => d.review);
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
        <SectionTitle id="invoices" kicker="Accounts payable" title="Invoices" />
        <Card className="table-wrap">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-line bg-paper/60 text-left text-[11px] uppercase tracking-wider text-muted">
                <th scope="col" className="py-2.5 pl-5 pr-2 font-semibold">Supplier · invoice</th>
                <th scope="col" className="px-2 py-2.5 text-right font-semibold">Invoice</th>
                <th scope="col" className="px-2 py-2.5 text-right font-semibold">Withheld</th>
                <th scope="col" className="px-2 py-2.5 text-right font-semibold">Discount</th>
                <th scope="col" className="px-2 py-2.5 text-right font-semibold">Paid</th>
                <th scope="col" className="px-2 py-2.5 font-semibold">PayPal batch · item</th>
                <th scope="col" className="py-2.5 pl-2 pr-5 text-right font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {docs.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted">
                    Nothing reviewed yet. <Link href="/inbox" className="text-ledger hover:underline">Review the inbox</Link>.
                  </td>
                </tr>
              )}
              {docs.map((d) => {
                const r = d.review!;
                const e = effective(d)!;
                const status = e.action === "hold" && d.payment.status === "unpaid" ? "held" : d.payment.status;
                return (
                  <tr key={d.id} className="border-b border-line last:border-0">
                    <td className="py-2.5 pl-5 pr-2">
                      <Link href={`/inbox/${d.id}`} className="font-medium text-ink hover:text-ledger">
                        {supplierById(r.supplierId)?.name ?? r.extraction.supplier_name}
                      </Link>
                      <span className="block text-xs text-muted">{r.extraction.invoice_number}</span>
                    </td>
                    <td className="num px-2 py-2.5 text-right">{fmt(r.invoiceCents)}</td>
                    <td className="num px-2 py-2.5 text-right text-terracotta">{e.withheldCents ? fmt(e.withheldCents) : "—"}</td>
                    <td className="num px-2 py-2.5 text-right text-olive">{d.payment.discountCents ? fmt(d.payment.discountCents) : "—"}</td>
                    <td className="num px-2 py-2.5 text-right font-medium">{d.payment.amountCents != null && d.payment.status !== "failed" ? fmt(d.payment.amountCents) : "—"}</td>
                    <td className="px-2 py-2.5">
                      {d.payment.batchId ? (
                        <>
                          <Mono>{d.payment.batchId}</Mono>
                          {d.payment.payoutItemId && <Mono className="block text-muted">{d.payment.payoutItemId}</Mono>}
                        </>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="py-2.5 pl-2 pr-5 text-right">
                      <Pill tone={status === "held" ? "terracotta" : PAY_TONE[d.payment.status]}>{status}</Pill>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
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
