import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { AgentTimeline } from "@/components/AgentTimeline";
import { AgentRunner, EuroField } from "@/components/client/AgentRunner";
import { BatchStatus } from "@/components/client/BatchStatus";
import { PlanApproval } from "@/components/client/PlanApproval";
import { IconSpark } from "@/components/icons";
import { Card, Empty, PageHeader, Pill, SectionTitle } from "@/components/ui";
import { RESTAURANT, supplierById } from "@/data/seed";
import { claudeConfigured } from "@/lib/claude";
import { businessToday, fmtDateTime, fmtDay } from "@/lib/dates";
import { fmt } from "@/lib/money";
import { paypalConfigured } from "@/lib/paypal";
import { openInvoices } from "@/lib/planner";
import { readState } from "@/lib/state";

export const metadata: Metadata = { title: "Payment run" };

export default async function PaymentsPage() {
  await connection();
  const state = await readState();
  const today = businessToday();
  const { open, held, unreviewed } = openInvoices(state, today);
  const openTotal = open.reduce((s, o) => s + o.payableCents, 0);
  const active = [...state.plans].reverse().find((p) => p.status === "awaiting_approval" || p.status === "partially_paid");
  const latest = [...state.plans].reverse().find((p) => p.status !== "superseded");
  const shown = active ?? latest;
  const older = [...state.plans].reverse().filter((p) => p.id !== shown?.id);
  const names: Record<string, string> = {};
  for (const d of state.documents) if (d.review) names[d.id] = supplierById(d.review.supplierId)?.name ?? d.review.extraction.supplier_name;
  const batches = [...state.batches].reverse();
  const canRun = claudeConfigured() && open.length > 0;

  return (
    <div className="space-y-10">
      <PageHeader kicker="Payment run" title="The agent plans. You approve. PayPal pays.">
        Claude works through your reviewed invoices with tools: due dates, early-payment discounts, held invoices and the cash cap you set. It
        can only propose; money moves when you approve, as one PayPal payout batch.
      </PageHeader>

      <Card className="p-5 sm:p-6">
        <div className="mb-5 flex flex-wrap gap-2 text-sm">
          <Pill tone="ledger">
            {open.length} payable · {fmt(openTotal)}
          </Pill>
          {held.length > 0 && <Pill tone="terracotta">{held.length} held, never paid by the agent</Pill>}
          {unreviewed > 0 && (
            <Link href="/inbox">
              <Pill tone="saffron">{unreviewed} not reviewed yet, review first</Pill>
            </Link>
          )}
        </div>
        <AgentRunner
          endpoint="/api/payment-run"
          buttonLabel={active ? "Re-plan this week" : "Plan this week's payments"}
          runningLabel="Planning with Claude…"
          disabled={!canRun}
          disabledReason={
            !claudeConfigured()
              ? "Add ANTHROPIC_API_KEY to .env.local to run the agent."
              : open.length === 0
                ? "No reviewed, unpaid invoices to plan. Review the inbox first."
                : undefined
          }
          fields={
            <EuroField
              name="cashCapEur"
              label="Cash cap for this run"
              defaultValue={state.settings.cashCapCents / 100}
              min={1}
              max={100000}
              hint="The most you want to pay out this week."
            />
          }
        />
        {!paypalConfigured() && <p className="mt-3 text-sm text-terracotta">PayPal is not configured: approvals will fail until the sandbox credentials are in .env.local.</p>}
      </Card>

      {shown ? (
        <section aria-labelledby="plan" className="space-y-5">
          <SectionTitle
            id="plan"
            kicker={shown.status === "awaiting_approval" ? "Waiting for your approval" : shown.status === "partially_paid" ? "Partly approved" : "Approved"}
            title={`Plan for the week of ${fmtDay(today)}`}
            aside={<span className="text-xs text-muted">Proposed {fmtDateTime(shown.createdAt)}</span>}
          />
          <Card className="p-5 sm:p-6">
            <figure className="mb-6 flex gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ledger text-white" aria-hidden="true">
                <IconSpark size={16} />
              </span>
              <div>
                <blockquote className="font-display text-[22px] leading-snug text-ink">“{shown.messageToOwner}”</blockquote>
                <figcaption className="mt-1 text-xs text-muted">
                  Payment agent (Claude) to {RESTAURANT.ownerFirstName}
                </figcaption>
              </div>
            </figure>
            <PlanApproval key={`${shown.id}-${shown.status}`} plan={shown} />
            {shown.agentLog.length > 0 && (
              <details className="mt-6 rounded-xl border border-line bg-paper/50 p-4">
                <summary className="cursor-pointer text-sm font-medium text-ink-2">How the agent got here ({shown.agentLog.filter((e) => e.type === "tool_start").length} tool calls)</summary>
                <div className="mt-4">
                  <AgentTimeline events={shown.agentLog} />
                </div>
              </details>
            )}
          </Card>
        </section>
      ) : (
        <Empty title="No plan yet">
          Review your inbox, set the cash cap and let the agent propose this week&apos;s payments. You will see every payment, its reason and the total
          before anything is paid.
        </Empty>
      )}

      {batches.length > 0 && (
        <section aria-labelledby="batches" className="space-y-4">
          <SectionTitle id="batches" kicker="PayPal Payouts API" title="Payout batches" />
          {batches.map((b) => (
            <BatchStatus key={b.id} initial={b} names={names} />
          ))}
        </section>
      )}

      {older.length > 0 && (
        <section aria-labelledby="older">
          <SectionTitle id="older" kicker="History" title="Earlier plans" />
          <ul className="divide-y divide-line rounded-2xl border border-line bg-card text-sm">
            {older.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span>
                  {fmtDateTime(p.createdAt)} · {p.payments.length} payments · <span className="num">{fmt(p.totals.payCents)}</span>
                </span>
                <Pill tone={p.status === "superseded" ? "muted" : "olive"}>{p.status.replace("_", " ")}</Pill>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
