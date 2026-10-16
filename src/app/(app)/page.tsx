import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { ActivityList } from "@/components/Activity";
import { IconArrowRight, IconCheck, IconShield } from "@/components/icons";
import { buttonClass, Card, cx, Money, SectionTitle, SeverityIcon } from "@/components/ui";
import { RESTAURANT, supplierById } from "@/data/seed";
import { effective, isSettled, ledgerStats, lowStock } from "@/lib/ap";
import { businessToday, fmtDay, fmtDayLong } from "@/lib/dates";
import { needsDispute } from "@/lib/disputes";
import { fmt } from "@/lib/money";
import { readState } from "@/lib/state";

export default async function OverviewPage() {
  await connection();
  const state = await readState();
  const today = businessToday();
  const s = ledgerStats(state, today);
  const activePlan = [...state.plans].reverse().find((p) => p.status === "awaiting_approval" || p.status === "partially_paid");
  const anyPlan = state.plans.some((p) => p.status !== "superseded");
  const proposed = activePlan?.payments.filter((p) => p.status === "proposed") ?? [];
  const disputes = state.documents.filter(needsDispute);
  const disputesOpen = disputes.filter((d) => d.dispute?.status !== "sent");
  const low = lowStock(state);
  const restockDone = state.proposals.some((p) => p.status === "completed");
  const allReviewed = s.reviewed === s.documents;
  const lastBatch = state.batches[state.batches.length - 1];

  const attention = state.documents
    .filter((d) => d.review && !isSettled(d))
    .flatMap((d) =>
      d.review!.findings
        .filter((f) => f.severity === "high" || f.severity === "opportunity")
        .map((f) => ({ doc: d, f, supplier: supplierById(d.review!.supplierId)?.name ?? d.review!.extraction.supplier_name })),
    )
    .slice(0, 6);

  const steps: { title: string; status: ReactNode; done: boolean; href: string; cta: string }[] = [
    {
      title: "Claude reviews every document",
      status: allReviewed ? `All ${s.documents} documents reviewed` : `${s.reviewed} of ${s.documents} reviewed`,
      done: allReviewed,
      href: "/inbox",
      cta: allReviewed ? "See inbox" : "Review inbox",
    },
    {
      title: "The agent plans the payment run",
      status: activePlan ? (
        <>
          Plan ready: <Money cents={activePlan.totals.payCents} /> to {activePlan.payments.length} suppliers
        </>
      ) : anyPlan ? (
        "Plan approved"
      ) : (
        `Cash cap ${fmt(state.settings.cashCapCents)}`
      ),
      done: anyPlan,
      href: "/payments",
      cta: anyPlan ? "Open plan" : "Plan payments",
    },
    {
      title: "You approve; PayPal pays",
      status:
        s.paidCount > 0 ? (
          <>
            <Money cents={s.paidCents} /> sent in {state.batches.length} payout batch{state.batches.length === 1 ? "" : "es"}
          </>
        ) : proposed.length ? (
          `${proposed.length} payments waiting for you`
        ) : (
          "Nothing approved yet"
        ),
      done: s.paidCount > 0 && proposed.length === 0,
      href: "/payments",
      cta: proposed.length ? "Approve" : "Payments",
    },
    {
      title: "Credit notes requested",
      status: disputes.length ? `${disputes.length - disputesOpen.length} of ${disputes.length} emails sent` : "Nothing to dispute yet",
      done: disputes.length > 0 && disputesOpen.length === 0,
      href: "/disputes",
      cta: "Disputes",
    },
    {
      title: "Restock within your limit",
      status: restockDone ? `${s.ordersCount} order${s.ordersCount === 1 ? "" : "s"} paid via PayPal` : `${low.length} items below par`,
      done: restockDone,
      href: "/reorder",
      cta: "Reorder",
    },
  ];

  return (
    <div className="space-y-10">
      <header className="rise">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">{fmtDayLong(today)}</p>
        <h1 className="font-display mt-1 text-5xl leading-[1.02] text-ink sm:text-6xl">
          Hola, {RESTAURANT.ownerFirstName}.
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink-2">
          {s.documents} supplier documents arrived this week. Supplora Pay reads each one with Claude, checks it against the signed delivery note
          and what you usually pay, plans the payments, and pays your suppliers through PayPal once you approve.
        </p>
      </header>

      <Card className="ruled relative overflow-hidden px-5 py-6 sm:px-8 sm:py-8">
        <div className="grid gap-8 md:grid-cols-[1.3fr_1fr]">
          <div>
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-olive">
              <IconShield size={15} /> Protected this week
            </p>
            <p className="num font-display mt-2 text-6xl leading-none text-ink sm:text-7xl">{fmt(s.protectedCents)}</p>
            <p className="mt-3 max-w-md text-sm text-ink-2">
              {s.protectedCents > 0
                ? "Overcharges caught, a double payment blocked and early-payment discounts captured, each backed by the exact numbers."
                : "Review the inbox and this fills up with every overcharge, duplicate and discount Supplora finds."}
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 self-end text-sm">
            <div>
              <dt className="text-muted">Overcharges caught</dt>
              <dd className="num text-lg font-semibold text-terracotta">{fmt(s.overchargesCaughtCents)}</dd>
            </div>
            <div>
              <dt className="text-muted">Duplicates blocked</dt>
              <dd className="num text-lg font-semibold text-terracotta">{fmt(s.duplicatesBlockedCents)}</dd>
            </div>
            <div>
              <dt className="text-muted">Discounts captured</dt>
              <dd className="num text-lg font-semibold text-olive">{fmt(s.discountsCapturedCents)}</dd>
              {s.discountsAvailableCents > 0 && <dd className="text-xs text-muted">{fmt(s.discountsAvailableCents)} still available</dd>}
            </div>
            <div>
              <dt className="text-muted">Paid via PayPal</dt>
              <dd className="num text-lg font-semibold text-ink">{fmt(s.paidCents)}</dd>
              {s.openPayableCents > 0 && <dd className="text-xs text-muted">{fmt(s.openPayableCents)} still open</dd>}
            </div>
          </dl>
        </div>
      </Card>

      <section aria-labelledby="week">
        <SectionTitle id="week" kicker="This week's run" title="From inbox to paid, with you in control" />
        <ol className="grid gap-3 md:grid-cols-5">
          {steps.map((step, i) => (
            <li key={step.title} className={cx("flex flex-col rounded-2xl border bg-card p-4", step.done ? "border-olive/30" : "border-line")}>
              <div className="flex items-center gap-2">
                <span
                  className={cx(
                    "num grid h-7 w-7 place-items-center rounded-full text-xs font-semibold",
                    step.done ? "bg-olive text-white" : "border border-line-2 text-ink-2",
                  )}
                  aria-hidden="true"
                >
                  {step.done ? <IconCheck size={14} /> : i + 1}
                </span>
                <span className="sr-only">{step.done ? "Done:" : `Step ${i + 1}:`}</span>
              </div>
              <h3 className="mt-3 text-sm font-semibold leading-snug text-ink">{step.title}</h3>
              <p className="mt-1 flex-1 text-[13px] text-ink-2">{step.status}</p>
              <Link href={step.href} className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-ledger hover:underline">
                {step.cta} <IconArrowRight size={14} />
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <Card className="p-5 sm:p-6">
          <SectionTitle kicker="Needs your eye" title="What Supplora found" />
          {attention.length === 0 ? (
            <p className="py-6 text-sm text-muted">
              {s.reviewed === 0 ? (
                <>
                  Nothing reviewed yet.{" "}
                  <Link href="/inbox" className="font-medium text-ledger hover:underline">
                    Review the inbox
                  </Link>{" "}
                  to see price rises, short deliveries and duplicates.
                </>
              ) : (
                "No open issues. Everything reviewed so far is clean or already handled."
              )}
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {attention.map(({ doc, f, supplier }) => {
                const e = effective(doc)!;
                return (
                  <li key={`${doc.id}-${f.id}`}>
                    <Link href={`/inbox/${doc.id}`} className="group flex gap-3 py-3">
                      <SeverityIcon severity={f.severity} size={17} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-ink group-hover:text-ledger">{f.title}</p>
                        <p className="text-xs text-muted">
                          {supplier} · {doc.review!.extraction.invoice_number}
                          {doc.review!.dueDate && <> · due {fmtDay(doc.review!.dueDate)}</>}
                        </p>
                      </div>
                      <span className={cx("num shrink-0 text-sm font-semibold", f.severity === "opportunity" ? "text-olive" : "text-terracotta")}>
                        {f.severity === "opportunity" ? "−" : ""}
                        {fmt(f.impactCents || e.withheldCents)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card className="p-5 sm:p-6">
          <SectionTitle
            kicker="Audit trail"
            title="Recent activity"
            aside={
              <Link href="/ledger#audit" className="text-[13px] font-medium text-ledger hover:underline">
                Full log
              </Link>
            }
          />
          <ActivityList entries={[...state.audit].reverse().slice(0, 7)} compact />
          {lastBatch && (
            <p className="mt-3 text-xs text-muted">
              Last PayPal payout batch <code className="font-mono">{lastBatch.id}</code> · {lastBatch.status}
            </p>
          )}
        </Card>
      </div>

      {!allReviewed && (
        <div className="flex justify-center">
          <Link href="/inbox" className={buttonClass("primary", "lg")}>
            Start with the inbox <IconArrowRight size={16} />
          </Link>
        </div>
      )}
    </div>
  );
}
