"use client";

// The signed delivery note for an authorized restock order comes back. In the public demo the note
// is scripted (and says so): everything arrives except one unit of the largest line. The amounts on
// the buttons were computed on the server by the same code that settles the order.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { fmt } from "@/lib/money";
import { IconTruck, IconX } from "../icons";
import { buttonClass, ErrorNote } from "../ui";
import { errorText, postJson } from "./api";

export function DeliveryActions({
  orderId,
  authorizedCents,
  captureCents,
  releaseCents,
  shortages,
}: {
  orderId: string;
  authorizedCents: number;
  captureCents: number;
  releaseCents: number;
  shortages: string[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"scripted" | "nothing" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function settle(outcome: "scripted" | "nothing") {
    setBusy(outcome);
    setError(null);
    try {
      await postJson(`/api/orders/${orderId}/delivery`, { outcome });
      router.refresh();
    } catch (err) {
      setError(errorText(err));
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="border-t border-line bg-saffron-soft/40 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8a5a0c]">Pay only for what arrived</p>
      <p className="mt-1 text-sm text-ink-2">
        <strong className="text-ink">{fmt(authorizedCents)}</strong> is on hold on the card; nothing is captured yet. When the signed delivery note is in,
        Supplora captures what it confirms and PayPal releases the rest.
      </p>
      <p className="mt-1 text-xs text-muted">
        Demo: a scripted delivery note{shortages.length ? ` (${shortages.join("; ")} arrive)` : ""}. In production Supplora captures the signed note at the
        kitchen door.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => settle("scripted")} disabled={!!busy} className={buttonClass("primary", "sm")}>
          <IconTruck size={14} />
          {busy === "scripted" ? "Capturing on PayPal…" : `Delivery note in · capture ${fmt(captureCents)}, release ${fmt(releaseCents)}`}
        </button>
        <button type="button" onClick={() => settle("nothing")} disabled={!!busy} className={buttonClass("ghost", "sm")}>
          <IconX size={14} />
          {busy === "nothing" ? "Voiding…" : "Nothing arrived · void"}
        </button>
      </div>
      {error && <ErrorNote className="mt-2">{error}</ErrorNote>}
    </div>
  );
}
