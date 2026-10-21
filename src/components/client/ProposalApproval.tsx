"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { fmt } from "@/lib/money";
import type { RestockProposal } from "@/lib/types";
import { IconCard, IconShield } from "../icons";
import { buttonClass, ErrorNote } from "../ui";
import { errorText, postJson } from "./api";

export function ProposalApproval({ proposal, cardLabel }: { proposal: RestockProposal; cardLabel: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(proposal.status === "failed" ? proposal.error ?? null : null);

  async function act(action: "approve" | "decline") {
    setBusy(action);
    setError(null);
    try {
      await postJson(`/api/restock/${proposal.id}`, { action });
      router.refresh();
    } catch (err) {
      setError(errorText(err));
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="perforated rounded-2xl border border-ledger/25 bg-ledger-soft/60 p-4 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <IconShield size={20} className="mt-0.5 shrink-0 text-ledger" />
          <p className="text-sm text-ink-2">
            <strong className="text-ink">The agent created the checkouts but cannot pay.</strong> Approving confirms each PayPal order with the
            restaurant&apos;s card on file ({cardLabel ?? "a sandbox test card, stored in PayPal Vault on first use"}) and authorizes it: the money is
            held, not taken. PayPal captures only what the signed delivery note confirms and releases the rest.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button type="button" onClick={() => act("decline")} disabled={!!busy || proposal.status !== "awaiting_approval"} className={buttonClass("ghost", "lg")}>
            {busy === "decline" ? "Declining…" : "Decline"}
          </button>
          <button type="button" onClick={() => act("approve")} disabled={!!busy} className={buttonClass("primary", "lg")}>
            <IconCard size={16} />
            {busy === "approve" ? "Authorizing with PayPal…" : proposal.status === "failed" ? `Retry · ${fmt(proposal.totalCents)}` : `Approve & authorize ${fmt(proposal.totalCents)}`}
          </button>
        </div>
      </div>
      {error && <ErrorNote className="mt-3">{error}</ErrorNote>}
    </div>
  );
}
