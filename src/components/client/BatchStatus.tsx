"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { fmtDateTime } from "@/lib/dates";
import { fmt } from "@/lib/money";
import type { PayoutBatchRecord } from "@/lib/types";
import { Mono, Pill, Stamp, type Tone } from "../ui";
import { errorText, getJson } from "./api";

const TERMINAL = ["SUCCESS", "DENIED", "CANCELED", "FAILED"];
const PENDING_ITEM = ["PENDING", "ONHOLD", "NEW"];

function isFinal(b: PayoutBatchRecord) {
  return TERMINAL.includes(b.status) && b.items.every((i) => !PENDING_ITEM.includes(i.transactionStatus));
}

function itemTone(s: string): Tone {
  if (s === "SUCCESS") return "olive";
  if (s === "UNCLAIMED") return "saffron";
  if (PENDING_ITEM.includes(s)) return "ledger";
  return "terracotta";
}

function batchTone(s: string): Tone {
  if (s === "SUCCESS") return "olive";
  if (s === "PENDING" || s === "PROCESSING") return "ledger";
  return "terracotta";
}

export function BatchStatus({ initial, names, demo }: { initial: PayoutBatchRecord; names: Record<string, string>; demo?: boolean }) {
  const router = useRouter();
  const [batch, setBatch] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [polls, setPolls] = useState(0);
  const wasFinal = useRef(isFinal(initial));

  useEffect(() => {
    if (isFinal(batch)) return;
    const t = setTimeout(async () => {
      try {
        const res = await getJson<{ batch: PayoutBatchRecord }>(`/api/payouts/${batch.id}`);
        setBatch(res.batch);
        setError(null);
        if (isFinal(res.batch) && !wasFinal.current) {
          wasFinal.current = true;
          router.refresh();
        }
      } catch (err) {
        setError(errorText(err));
      } finally {
        setPolls((n) => n + 1);
      }
    }, polls === 0 ? 1500 : 4000);
    return () => clearTimeout(t);
  }, [batch, polls, router]);

  const final = isFinal(batch);
  const unclaimed = batch.items.some((i) => i.transactionStatus === "UNCLAIMED");

  return (
    <article className="overflow-hidden rounded-2xl border border-line bg-card">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-paper/60 px-4 py-3 sm:px-5">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">PayPal payout batch</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-2">
            <Mono className="text-[13px] text-ink">{batch.id}</Mono>
            <span className="text-xs text-muted">sender_batch_id {batch.senderBatchId}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="num text-right text-sm">
            <span className="block font-semibold text-ink">{fmt(batch.totalCents)}</span>
            {batch.feesCents != null && <span className="block text-xs text-muted">fees {fmt(batch.feesCents)}</span>}
          </span>
          <Stamp tone={batchTone(batch.status)} className={!final ? "pulse-dot" : undefined}>
            Batch {batch.status}
          </Stamp>
        </div>
      </header>
      {/* Phones: one row per payout item, status visible without scrolling sideways. */}
      <ul className="divide-y divide-line sm:hidden">
        {batch.items.map((i) => (
          <li key={i.senderItemId} className="px-4 py-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 font-medium text-ink">{names[i.docId] ?? i.docId}</p>
              <span className="num shrink-0 font-medium">{fmt(i.amountCents)}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <Pill tone={itemTone(i.transactionStatus)}>{i.transactionStatus}</Pill>
              {i.payoutItemId ? <Mono className="text-[11px]">item {i.payoutItemId}</Mono> : <span className="text-xs text-muted">assigning…</span>}
              {i.errorName && i.errorName !== "RECEIVER_UNREGISTERED" && <span className="text-[11px] text-terracotta">{i.errorName}</span>}
            </div>
            <Mono className="mt-0.5 block break-all text-[11px] text-muted">{i.receiver}</Mono>
          </li>
        ))}
      </ul>
      <div className="table-wrap hidden sm:block">
        <table className="w-full min-w-[620px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted">
              <th scope="col" className="py-2 pl-4 pr-2 font-semibold sm:pl-5">
                Supplier
              </th>
              <th scope="col" className="px-2 py-2 font-semibold">
                Receiver
              </th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">
                Amount
              </th>
              <th scope="col" className="px-2 py-2 font-semibold">
                Payout item
              </th>
              <th scope="col" className="py-2 pl-2 pr-4 text-right font-semibold sm:pr-5">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {batch.items.map((i) => (
              <tr key={i.senderItemId} className="border-b border-line last:border-0">
                <td className="py-2.5 pl-4 pr-2 font-medium text-ink sm:pl-5">{names[i.docId] ?? i.docId}</td>
                <td className="px-2 py-2.5">
                  <Mono>{i.receiver}</Mono>
                </td>
                <td className="num px-2 py-2.5 text-right">{fmt(i.amountCents)}</td>
                <td className="px-2 py-2.5">
                  {i.payoutItemId ? <Mono>{i.payoutItemId}</Mono> : <span className="text-xs text-muted">assigning…</span>}
                  {i.transactionId && <span className="block text-[11px] text-muted">txn {i.transactionId}</span>}
                </td>
                <td className="py-2.5 pl-2 pr-4 text-right sm:pr-5">
                  <Pill tone={itemTone(i.transactionStatus)}>{i.transactionStatus}</Pill>
                  {i.errorName && i.errorName !== "RECEIVER_UNREGISTERED" && <span className="block text-[11px] text-terracotta">{i.errorName}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <footer className="space-y-1 border-t border-line px-4 py-2.5 text-xs text-muted sm:px-5">
        <p aria-live="polite">
          Created {fmtDateTime(batch.createdAt)}
          {final ? (batch.completedAt ? ` · completed ${fmtDateTime(batch.completedAt)}` : "") : " · checking PayPal for updates…"}
          {polls > 0 && ` · ${polls} status check${polls === 1 ? "" : "s"}`}
        </p>
        {unclaimed && (
          <p>
            PayPal accepted and processed the batch{batch.status === "SUCCESS" ? " (batch SUCCESS)" : ""}. With the demo&apos;s placeholder payees each
            item waits <strong className="text-ink-2">UNCLAIMED</strong>, as a real supplier&apos;s payout would until they claim it with a PayPal
            account: PayPal holds the money meanwhile and returns it after 30 days if nobody claims it. Point the receivers at a sandbox account of
            your own (<code className="font-mono">PAYPAL_PAYOUT_RECEIVER_OVERRIDE</code>) to see items reach SUCCESS.
            {demo && " In this public demo, unclaimed payouts are cancelled after about 20 minutes so the sandbox money goes back for the next visitor."}
          </p>
        )}
        {error && <p className="text-terracotta">{error}</p>}
      </footer>
    </article>
  );
}
