"use client";

// "Reconcile with PayPal": read-only comparison of the ledger with PayPal (see lib/reconcile.ts).

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { fmtDateTime } from "@/lib/dates";
import type { Reconciliation } from "@/lib/types";
import { IconRefresh } from "../icons";
import { buttonClass, ErrorNote } from "../ui";
import { errorText, postJson } from "./api";

const ReconcileGrid = dynamic(() => import("./ReconcileGrid"), {
  ssr: false,
  loading: () => <div className="h-[200px] animate-pulse rounded-2xl border border-line bg-paper-2/60" aria-busy="true" />,
});

export function ReconcilePanel({ last, hasPayments }: { last: Reconciliation | null; hasPayments: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await postJson("/api/reconcile");
      router.refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="max-w-2xl text-sm leading-relaxed text-ink-2">
          Read-only check of every euro against PayPal: each store order is re-read with <strong className="font-semibold text-ink">get_order</strong> and the
          account&rsquo;s history with <strong className="font-semibold text-ink">list_transactions</strong>, both through the official{" "}
          <strong className="font-semibold text-ink">PayPal Agent Toolkit</strong> (MCP); payout batches through the REST Payouts API, which the toolkit does
          not cover. Mismatches are reported, never &ldquo;fixed&rdquo;.
        </p>
        <button type="button" onClick={run} disabled={busy || !hasPayments} className={buttonClass("ghost")}>
          <IconRefresh size={15} className={busy ? "animate-spin" : undefined} />
          {busy ? "Asking PayPal…" : last ? "Reconcile again" : "Reconcile with PayPal"}
        </button>
      </div>
      {!hasPayments && <p className="text-sm text-muted">Nothing has been paid through PayPal yet: approve a payment run or a restock first.</p>}
      {error && <ErrorNote>{error}</ErrorNote>}
      {last && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full border border-olive/25 bg-olive-soft px-2.5 py-0.5 font-medium text-olive">{last.totals.match} match</span>
            {last.totals.pending > 0 && <span className="rounded-full border border-saffron/30 bg-saffron-soft px-2.5 py-0.5 font-medium text-[#8a5a0c]">{last.totals.pending} PayPal ahead</span>}
            {last.totals.mismatch > 0 && <span className="rounded-full border border-terracotta/25 bg-terracotta-soft px-2.5 py-0.5 font-medium text-terracotta">{last.totals.mismatch} mismatch</span>}
            <span className="text-muted">checked {fmtDateTime(last.at)}</span>
          </div>
          <p className={last.transactionSearch.ok ? "text-xs text-muted" : "rounded-lg border border-saffron/30 bg-saffron-soft px-3 py-2 text-xs text-[#8a5a0c]"}>
            <span className="font-semibold">Account transaction list (toolkit list_transactions):</span>{" "}
            {last.transactionSearch.ok ? `${last.transactionSearch.count} transactions between ${last.transactionSearch.start.slice(0, 10)} and ${last.transactionSearch.end.slice(0, 10)}.` : last.transactionSearch.error}
          </p>
          <ReconcileGrid rows={last.rows} />
        </>
      )}
    </div>
  );
}
