import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { ActivityList } from "@/components/Activity";
import { CountUpMoney } from "@/components/client/CountUp";
import { IconArrowRight, IconCheck, IconShield } from "@/components/icons";
import { buttonClass, Card, cx, Money, SectionTitle, SeverityIcon } from "@/components/ui";
import { RESTAURANT, supplierById } from "@/data/seed";
import { effective, isPaidOrSent, ledgerStats, lowStock } from "@/lib/ap";
import { businessToday, fmtDay, fmtDayLong } from "@/lib/dates";
import { needsDispute } from "@/lib/disputes";
import { fmt } from "@/lib/money";
import { previewReviewedState } from "@/lib/review";
import { readState } from "@/lib/state";

export default async function OverviewPage() {
  await connection();
  const state = await readState();
  const today = businessToday();
  const s = ledgerStats(state, today);
  // Before the owner has opened the inbox, land the hero on the real "protected this week" total by
  // previewing the deterministic review of the seven sample documents (recorded Claude readings run
  // through the same rules), instead of a row of zeros. The step tracker and activity below stay on the
  // live session, so "Review 7 with Claude" is still the owner's next action; once reviewed, the figure
  // is identical because nothing is paid yet.
  const previewState = s.reviewed === 0 ? previewReviewedState() : null;
  const previewing = previewState !== null;
  const hero = previewing ? ledgerStats(previewState, today) : s;
  const findingsSource = previewing ? previewState : state;
  const activePlan = [...state.plans].reverse().find((p) => p.status === "awaiting_approval" || p.status === "partially_paid");
  const anyPlan = state.plans.some((p) => p.status !== "superseded");
  const proposed = activePlan?.payments.filter((p) => p.status === "proposed") ?? [];
  const disputes = state.documents.filter(needsDispute);
  const disputesOpen = disputes.filter((d) => d.dispute?.status !== "sent");
  const low = lowStock(state);
  const restockDone = state.proposals.some((p) => p.status === "completed");
  const allReviewed = s.reviewed === s.documents;
  const lastBatch = state.batches[state.batches.length - 1];

  // Every finding behind the money above: high-severity flags, discounts, and every line that withholds
  // euros (whatever its severity), including invoices already sent with an amount still withheld,
  // so the list adds up to the "Overcharges withheld" figure.
  const attention = findingsSource.documents
    .filter((d) => d.review && (!isPaidOrSent(d) || effective(d)!.action !== "pay_full"))
    .flatMap((d) =>
      d.review!.findings
        .filter((f) => f.severity === "high" || f.severity === "opportunity" || f.withholdCents > 0)
        .map((f) => ({ doc: d, f, supplier: supplierById(d.review!.supplierId)?.name ?? d.review!.extraction.supplier_name })),
    )
    .slice(0, 10);

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
        s.sentCount > 0 ? (
          <>
            <Money cents={s.sentCents} /> sent in {state.batches.length} payout batch{state.batches.length === 1 ? "" : "es"}
            {s.awaitingClaimCount > 0 && <>; {s.awaitingClaimCount} awaiting the supplier&apos;s claim</>}
          </>
        ) : proposed.length ? (
          `${proposed.length} payments waiting for you`
        ) : (
          "Nothing approved yet"
        ),
      done: s.sentCount > 0 && proposed.length === 0,
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
      title: "Restock, pay only for what arrives",
      status:
        s.ordersHeldCents > 0
          ? `${fmt(s.ordersHeldCents)} authorized · waiting for the delivery note`
          : s.ordersCount > 0
            ? `${fmt(s.ordersCents)} captured for what arrived${s.ordersReleasedCents ? ` · ${fmt(s.ordersReleasedCents)} released` : ""}`
            : restockDone
              ? "Approved"
              : `${low.length} items below par`,
      done: restockDone && s.ordersHeldCents === 0,
      href: "/reorder",
      cta: "Reorder",
    },
  ];

  return (
    <div className="space-y-10">
      <header className="rise">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
          {fmtDayLong(today)}
          <span className="ml-2 font-normal normal-case tracking-normal">
            · business date pinned to the sample invoices&apos; week; activity times are real
          </span>
        </p>
        <h1 className="font-display mt-1 text-5xl leading-[1.02] text-ink sm:text-6xl">
          Hola, {RESTAURANT.ownerFirstName}.
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink-2">
          {s.documents} supplier documents arrived this week. Supplora Pay reads each one with Claude, checks it against the signed delivery note
          and what you usually pay, plans the payments, and pays your suppliers through PayPal once you approve.
        </p>
      </header>

      <Card className="ruled rise relative overflow-hidden px-5 py-6 sm:px-8 sm:py-8" style={{ animationDelay: "40ms" }}>
        <div className="grid gap-8 md:grid-cols-[1.3fr_1fr]">
          <div>
            <p className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-olive">
              <IconShield size={15} /> Protected this week
              {previewing && (
                <span className="rounded-full border border-line-2 bg-paper px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-muted">
                  Projected
                </span>
              )}
            </p>
            <p className="num font-display mt-2 text-6xl leading-none text-ink sm:text-7xl">
              <CountUpMoney cents={hero.protectedCents} />
            </p>
            <p className="mt-3 max-w-md text-sm text-ink-2">
              {previewing
                ? `What Supplora will protect once you review the ${s.documents} documents in your inbox — overcharges withheld and a double payment held — from Claude's recorded readings run through the rules${
                    hero.discountsAvailableCents > 0 ? `, plus ${fmt(hero.discountsAvailableCents)} of early-payment discount to capture` : ""
                  }. Review the inbox to lock it in.`
                : hero.protectedCents > 0
                  ? "Overcharges withheld until the supplier sends a credit note, a double payment held, and early-payment discounts captured, each backed by the exact numbers."
                  : "Review the inbox and this fills up with every overcharge, duplicate and discount Supplora finds."}
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 self-end text-sm">
            <div>
              <dt className="text-muted">Overcharges withheld</dt>
              <dd className="num text-lg font-semibold text-terracotta">
                <CountUpMoney cents={hero.overchargesCaughtCents} durationMs={900} />
              </dd>
            </div>
            <div>
              <dt className="text-muted">Duplicates held</dt>
              <dd className="num text-lg font-semibold text-terracotta">
                <CountUpMoney cents={hero.duplicatesBlockedCents} durationMs={900} />
              </dd>
            </div>
            <div>
              <dt className="text-muted">Discounts captured</dt>
              <dd className="num text-lg font-semibold text-olive">
                <CountUpMoney cents={hero.discountsCapturedCents} durationMs={900} />
              </dd>
              {hero.discountsAvailableCents > 0 && (
                <dd className="text-xs text-muted">
                  {fmt(hero.discountsAvailableCents)} {previewing ? "to capture" : "still available"}
                </dd>
              )}
            </div>
            <div>
              <dt className="text-muted">Sent via PayPal</dt>
              <dd className="num text-lg font-semibold text-ink">
                <CountUpMoney cents={hero.sentCents} durationMs={900} />
              </dd>
              {hero.awaitingClaimCents > 0 && <dd className="text-xs text-[#8a5a0c]">{fmt(hero.awaitingClaimCents)} awaiting supplier claim</dd>}
              {hero.openPayableCents > 0 && (
                <dd className="text-xs text-muted">
                  {fmt(hero.openPayableCents)} {previewing ? "ready to pay" : "still open"}
                </dd>
              )}
            </div>
          </dl>
        </div>
      </Card>

      <section aria-labelledby="week">
        <SectionTitle id="week" kicker="This week's run" title="From inbox to paid, with you in control" />
        <ol className="grid gap-3 md:grid-cols-5">
          {steps.map((step, i) => (
            <li
              key={step.title}
              style={{ animationDelay: `${120 + i * 70}ms` }}
              className={cx("rise flex flex-col rounded-2xl border bg-card p-4", step.done ? "border-olive/30" : "border-line")}
            >
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
          <SectionTitle kicker={previewing ? "Needs your eye · projected" : "Needs your eye"} title={previewing ? "What Supplora will flag" : "What Supplora found"} />
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
              {attention.map(({ doc, f, supplier }, i) => {
                const e = effective(doc)!;
                return (
                  <li key={`${doc.id}-${f.id}`} className="rise" style={{ animationDelay: `${i * 55}ms` }}>
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
                        {fmt(f.withholdCents > 0 ? f.withholdCents : f.impactCents || e.withheldCents)}
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
