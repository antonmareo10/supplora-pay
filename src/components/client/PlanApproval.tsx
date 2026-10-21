"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { fmtDay } from "@/lib/dates";
import { fmt } from "@/lib/money";
import type { PaymentPlan, PlannedPayment } from "@/lib/types";
import { IconCheck, IconClock, IconShield } from "../icons";
import { buttonClass, cx, ErrorNote, Pill, type Tone } from "../ui";
import { errorText, postJson } from "./api";

const STATUS: Record<PlannedPayment["status"], { label: string; tone: Tone }> = {
  proposed: { label: "Awaiting approval", tone: "muted" },
  sending: { label: "Sending to PayPal…", tone: "ledger" },
  processing: { label: "PayPal processing", tone: "ledger" },
  paid: { label: "Paid", tone: "olive" },
  // PayPal accepted and processed the payout; it waits UNCLAIMED until the supplier claims it.
  unclaimed: { label: "Sent · waiting for supplier to claim", tone: "saffron" },
  failed: { label: "Failed", tone: "terracotta" },
  cancelled: { label: "Cancelled", tone: "muted" },
};

export function PlanApproval({ plan }: { plan: PaymentPlan }) {
  const router = useRouter();
  const approvable = plan.payments.filter((p) => p.status === "proposed" || p.status === "failed");
  const [selected, setSelected] = useState<Set<string>>(() => new Set(approvable.map((p) => p.docId)));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedPayments = approvable.filter((p) => selected.has(p.docId));
  const selectedTotal = selectedPayments.reduce((s, p) => s + p.amountCents, 0);
  const usedPct = Math.min(100, Math.round((plan.totals.payCents / plan.cashCapCents) * 100));

  async function approve(docIds: string[], key: string) {
    setBusy(key);
    setError(null);
    try {
      await postJson(`/api/plans/${plan.id}/approve`, { docIds });
      router.refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <span className="text-ink-2">
            Paying <strong className="num text-ink">{fmt(plan.totals.payCents)}</strong> of your <span className="num">{fmt(plan.cashCapCents)}</span> cap
          </span>
          <span className="num text-xs text-muted">{fmt(plan.totals.headroomCents)} headroom</span>
        </div>
        <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-paper-2" role="img" aria-label={`${usedPct}% of the cash cap used`}>
          <div className="h-full rounded-full bg-ledger" style={{ width: `${usedPct}%` }} />
        </div>
        <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
          <div>
            <dt className="text-xs text-muted">Early-pay discounts</dt>
            <dd className="num font-semibold text-olive">{fmt(plan.totals.discountCents)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Withheld (disputes)</dt>
            <dd className="num font-semibold text-terracotta">{fmt(plan.totals.withheldCents)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Deferred to next run</dt>
            <dd className="num font-semibold text-ink-2">{fmt(plan.totals.deferredCents)}</dd>
          </div>
        </dl>
      </div>

      <ul className="divide-y divide-line rounded-xl border border-line bg-card">
        {plan.payments.map((p) => {
          const canApprove = p.status === "proposed" || p.status === "failed";
          const st = STATUS[p.status];
          return (
            <li key={p.docId} className="flex gap-3 px-4 py-3.5">
              <div className="pt-0.5">
                {canApprove ? (
                  <input
                    type="checkbox"
                    aria-label={`Include ${p.supplierName} in the approval`}
                    checked={selected.has(p.docId)}
                    onChange={(e) =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(p.docId);
                        else next.delete(p.docId);
                        return next;
                      })
                    }
                    className="h-4 w-4 accent-[var(--ledger)]"
                  />
                ) : (
                  <span
                    className={cx(
                      "grid h-4 w-4 place-items-center rounded-full",
                      p.status === "paid" ? "bg-olive text-white" : p.status === "unclaimed" ? "bg-saffron-soft text-saffron ring-1 ring-saffron/40" : "bg-ledger-soft",
                    )}
                  >
                    {p.status === "paid" && <IconCheck size={11} />}
                    {p.status === "unclaimed" && <IconClock size={11} />}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className="font-semibold text-ink">{p.supplierName}</p>
                  <p className="num text-lg font-semibold text-ink">{fmt(p.amountCents)}</p>
                </div>
                <p className="text-xs text-muted">
                  {p.invoiceNumber} · due {fmtDay(p.dueDate)}
                  {p.amountCents !== p.invoiceCents && <> · invoice {fmt(p.invoiceCents)}</>}
                  {p.withheldCents > 0 && <span className="text-terracotta"> · −{fmt(p.withheldCents)} withheld</span>}
                  {p.discountCents > 0 && <span className="text-olive"> · −{fmt(p.discountCents)} early-pay discount</span>}
                </p>
                <p className="mt-1.5 text-[13.5px] leading-snug text-ink-2">{p.reason}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Pill tone={st.tone}>{st.label}</Pill>
                  {p.batchId && <code className="font-mono text-[11px] text-muted">batch {p.batchId}</code>}
                  {p.error && <span className="text-xs text-terracotta">{p.error}</span>}
                  {canApprove && (
                    <button type="button" disabled={!!busy} onClick={() => approve([p.docId], p.docId)} className={cx(buttonClass("ghost", "sm"), "ml-auto")}>
                      {busy === p.docId ? "Sending…" : `Approve only this`}
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {plan.deferred.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Deferred to the next run</p>
          <ul className="space-y-2">
            {plan.deferred.map((d) => (
              <li key={d.docId} className="rounded-xl border border-dashed border-line-2 px-4 py-3 text-sm">
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-medium text-ink">
                    {d.supplierName} <span className="text-xs font-normal text-muted">· {d.invoiceNumber}</span>
                  </span>
                  <span className="num text-ink-2">{fmt(d.amountCents)}</span>
                </div>
                <p className="mt-1 text-[13px] text-ink-2">{d.reason}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {approvable.length > 0 && (
        <div className="perforated rounded-2xl border border-ledger/25 bg-ledger-soft/60 p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <IconShield size={20} className="mt-0.5 shrink-0 text-ledger" />
              <p className="text-sm text-ink-2">
                <strong className="text-ink">Nothing is paid until you approve.</strong> Approved payments go out as one PayPal payout batch from your
                business balance (sandbox) to each supplier&apos;s PayPal account.
              </p>
            </div>
            <button
              type="button"
              disabled={!selectedPayments.length || !!busy}
              onClick={() => approve(selectedPayments.map((p) => p.docId), "all")}
              className={buttonClass("primary", "lg")}
            >
              {busy === "all"
                ? "Sending to PayPal…"
                : `Approve & pay ${selectedPayments.length} · ${fmt(selectedTotal)}`}
            </button>
          </div>
          {error && <ErrorNote className="mt-3">{error}</ErrorNote>}
        </div>
      )}
      {approvable.length === 0 && error && <ErrorNote>{error}</ErrorNote>}
    </div>
  );
}
