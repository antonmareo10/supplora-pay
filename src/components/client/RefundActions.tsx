"use client";

// After the capture, the kitchen finds goods that arrived damaged. In the public demo the damage report
// is scripted (and says so); the amount on the button was computed on the server by the same code
// that makes the refund.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { fmt } from "@/lib/money";
import { IconRefresh } from "../icons";
import { buttonClass, ErrorNote } from "../ui";
import { errorText, postJson } from "./api";

export function RefundActions({ orderId, reason, amountCents }: { orderId: string; reason: string; amountCents: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refund() {
    setBusy(true);
    setError(null);
    try {
      await postJson(`/api/orders/${orderId}/refund`, {});
      router.refresh();
    } catch (err) {
      setError(errorText(err));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-line px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Something arrived damaged?</p>
      <p className="mt-1 text-xs text-muted">Demo: a scripted damage report ({reason}). Supplora refunds it on the PayPal capture, at the price on the order.</p>
      <div className="mt-2">
        <button type="button" onClick={refund} disabled={busy} className={buttonClass("ghost", "sm")}>
          <IconRefresh size={14} />
          {busy ? "Refunding on PayPal…" : `Report damage · refund ${fmt(amountCents)}`}
        </button>
      </div>
      {error && <ErrorNote className="mt-2">{error}</ErrorNote>}
    </div>
  );
}
