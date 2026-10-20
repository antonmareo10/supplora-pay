"use client";

// Client boundary for the AG Grid payables dashboard. AG Grid is a client-only
// library, so the grid is loaded with next/dynamic({ ssr: false }) to keep it out
// of the server render and avoid any hydration mismatch. The server page (/ledger)
// stays a Server Component and just hands this the pre-computed, serializable rows.

import dynamic from "next/dynamic";
import type { PayableRow } from "@/lib/payables-view";

const PayablesGrid = dynamic(() => import("./PayablesGrid"), {
  ssr: false,
  loading: () => (
    <div className="space-y-3" aria-busy="true" aria-label="Loading payables grid">
      <div className="flex flex-wrap gap-2">
        <div className="h-9 flex-1 min-w-[200px] animate-pulse rounded-full bg-paper-2" />
        <div className="h-9 w-48 animate-pulse rounded-full bg-paper-2" />
        <div className="h-9 w-32 animate-pulse rounded-full bg-paper-2" />
      </div>
      <div className="h-[560px] animate-pulse rounded-2xl border border-line bg-paper-2/60" />
    </div>
  ),
});

export function PayablesSection({ rows, today }: { rows: PayableRow[]; today: string }) {
  return <PayablesGrid rows={rows} today={today} />;
}
