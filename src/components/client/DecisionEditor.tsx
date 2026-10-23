"use client";

// AG Grid popup cell editor for the payables grid: change an invoice's decision (pay in full, pay
// partial, hold) with a reason, right in the ledger. It saves through the same route as the review
// page (/api/documents/[id]/decision), so the server's rules apply unchanged: nothing paid or sent
// can change, a partial payment needs something to withhold, and the change goes to the audit log.

import type { CustomCellEditorProps } from "ag-grid-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { ACTION_LABEL } from "@/lib/payables-status";
import type { PayableRow } from "@/lib/payables-view";
import type { PayAction } from "@/lib/types";
import { cx } from "../ui";
import { errorText, postJson } from "./api";

const OPTIONS: { value: PayAction; hint: string }[] = [
  { value: "pay_full", hint: "Pay the whole invoice" },
  { value: "pay_partial", hint: "Withhold the flagged lines until a credit note arrives" },
  { value: "hold", hint: "Pay nothing for now" },
];

export function DecisionEditor(props: CustomCellEditorProps<PayableRow>) {
  const row = props.data;
  const router = useRouter();
  const id = useId();
  const [choice, setChoice] = useState<PayAction>(row.recommendation);
  const [note, setNote] = useState(row.ownerNote ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
  }, []);

  const overriding = choice !== row.recommended;
  const needsNote = overriding && note.trim().length === 0;
  const unchanged = choice === row.recommendation && (note.trim() === (row.ownerNote ?? "") || !overriding);

  const save = async () => {
    if (needsNote) {
      setError("Add a short reason: it goes to the audit log with the change.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await postJson(`/api/documents/${row.id}/decision`, { action: choice, note: overriding ? note.trim() : undefined });
      props.stopEditing();
      router.refresh();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-labelledby={`${id}-title`}
      className="w-[300px] space-y-3 rounded-xl border border-line bg-card p-3.5 text-sm text-ink shadow-[0_16px_40px_-16px_rgba(40,30,10,0.45)]"
      onKeyDown={(e) => {
        if (e.key === "Escape") props.stopEditing(true);
      }}
    >
      <p id={`${id}-title`} className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
        Decision · <span className="font-mono normal-case tracking-tight">{row.invoiceNumber}</span>
      </p>
      <fieldset className="space-y-1.5">
        <legend className="sr-only">Payment decision</legend>
        {OPTIONS.map((o, i) => {
          const disabled = o.value === "pay_partial" && !row.partialAvailable;
          return (
            <label
              key={o.value}
              className={cx(
                "flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-1.5",
                choice === o.value ? "border-ledger-2 bg-ledger-soft" : "border-line",
                disabled && "cursor-not-allowed opacity-50",
              )}
            >
              <input
                ref={i === 0 ? first : undefined}
                type="radio"
                name={`${id}-choice`}
                value={o.value}
                checked={choice === o.value}
                disabled={disabled || busy}
                onChange={() => setChoice(o.value)}
                className="mt-1 accent-[var(--ledger-2)]"
              />
              <span>
                <span className="block font-medium">
                  {ACTION_LABEL[o.value]}
                  {o.value === row.recommended && <span className="ml-1.5 text-[11px] font-normal text-muted">recommended</span>}
                </span>
                <span className="block text-xs text-muted">{disabled ? "Nothing to withhold on this invoice" : o.hint}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
      {row.fraudHold && choice !== "hold" && (
        <p className="rounded-lg border border-terracotta/30 bg-terracotta-soft px-2.5 py-2 text-xs text-terracotta">
          Held for possible fraud. Call the supplier on the number on file before paying; never use the details printed on this invoice.
        </p>
      )}
      {overriding && (
        <label className="block">
          <span className="text-xs font-medium text-ink-2">Reason (kept in the audit log)</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
            rows={2}
            disabled={busy}
            className="mt-1 w-full resize-none rounded-lg border border-line-2 bg-paper px-2 py-1.5 text-sm focus:border-ledger-2 focus:outline-none"
            placeholder="e.g. Agreed by phone with the supplier"
          />
        </label>
      )}
      {error && (
        <p role="alert" className="text-xs text-terracotta">
          {error}
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={() => props.stopEditing(true)} className="rounded-full px-3 py-1.5 text-xs text-ink-2 hover:text-ink">
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={busy || unchanged}
          className="rounded-full bg-ink px-3.5 py-1.5 text-xs font-semibold text-paper transition hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save decision"}
        </button>
      </div>
    </div>
  );
}
