"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { PayAction } from "@/lib/types";
import { IconSpark, IconX, IconZoom } from "../icons";
import { buttonClass, cx, ErrorNote } from "../ui";
import { errorText, postJson } from "./api";

export function ReviewButton({ docId, label = "Review with Claude", variant = "primary", disabled }: { docId: string; label?: string; variant?: "primary" | "ghost"; disabled?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 500);
    return () => clearInterval(t);
  }, [busy]);

  const phase = elapsed < 3 ? "Sending the image to Claude…" : elapsed < 25 ? "Claude is reading every line…" : "Still reading (long documents take up to a minute)…";

  return (
    <div className="space-y-3">
      <button
        type="button"
        disabled={busy || disabled}
        onClick={async () => {
          setBusy(true);
          setError(null);
          setElapsed(0);
          try {
            await postJson(`/api/documents/${docId}/review`);
            router.refresh();
          } catch (err) {
            setError(errorText(err));
          } finally {
            setBusy(false);
          }
        }}
        className={buttonClass(variant, variant === "primary" ? "lg" : "sm")}
      >
        <IconSpark size={16} className={busy ? "pulse-dot" : undefined} />
        {busy ? `Reading… ${elapsed}s` : label}
      </button>
      {busy && (
        <div role="status" aria-live="polite" className="space-y-2">
          <div className="sweep relative h-1.5 overflow-hidden rounded-full bg-paper-2" />
          <p className="text-sm text-ink-2">{phase}</p>
        </div>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  );
}

const OPTIONS: { value: PayAction; label: string; hint: string }[] = [
  { value: "pay_full", label: "Pay in full", hint: "Pay the whole invoice" },
  { value: "pay_partial", label: "Pay partial", hint: "Withhold the disputed amount" },
  { value: "hold", label: "Hold", hint: "Pay nothing for now" },
];

export function DecisionControl({
  docId,
  recommended,
  current,
  locked,
  partialAvailable,
}: {
  docId: string;
  recommended: PayAction;
  current: PayAction;
  locked: boolean;
  partialAvailable: boolean;
}) {
  const router = useRouter();
  const [choice, setChoice] = useState<PayAction>(current);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = choice !== current;

  return (
    <fieldset disabled={locked || busy} className="space-y-3">
      <legend className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Your decision</legend>
      <div role="radiogroup" aria-label="Payment decision" className="grid grid-cols-3 gap-1 rounded-full border border-line bg-paper p-1">
        {OPTIONS.map((o) => {
          const unavailable = o.value === "pay_partial" && !partialAvailable;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={choice === o.value}
              disabled={unavailable}
              title={unavailable ? "Nothing to withhold on this invoice" : o.hint}
              onClick={() => setChoice(o.value)}
              className={cx(
                "relative rounded-full px-2 py-2 text-xs font-medium transition sm:text-sm",
                choice === o.value ? "bg-ink text-paper shadow" : "text-ink-2 hover:bg-paper-2",
                unavailable && "cursor-not-allowed opacity-40",
              )}
            >
              {o.label}
              {o.value === recommended && (
                <span className={cx("ml-1 align-middle text-[10px] uppercase tracking-wider", choice === o.value ? "text-paper/70" : "text-olive")}>· rec.</span>
              )}
            </button>
          );
        })}
      </div>
      {dirty && (
        <div className="rise space-y-2">
          {choice !== recommended && (
            <label className="block">
              <span className="text-xs text-ink-2">Why are you overriding the recommendation? (optional, kept in the audit log)</span>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={300}
                placeholder={choice === "pay_full" ? "e.g. price rise agreed by phone with Rocío" : "e.g. waiting for the supplier to call back"}
                className="mt-1 w-full rounded-lg border border-line-2 bg-card px-3 py-2 text-sm placeholder:text-muted/70"
              />
            </label>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              className={buttonClass("ink", "sm")}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await postJson(`/api/documents/${docId}/decision`, { action: choice, note: note || undefined });
                  setNote("");
                  router.refresh();
                } catch (err) {
                  setError(errorText(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Saving…" : "Save decision"}
            </button>
            <button type="button" className={buttonClass("quiet", "sm")} onClick={() => setChoice(current)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {locked && <p className="text-xs text-muted">This invoice is paid or being paid; the decision can no longer change.</p>}
      {error && <ErrorNote>{error}</ErrorNote>}
    </fieldset>
  );
}

export function DocumentViewer({ url, mimeType, title }: { url: string; mimeType: string; title: string }) {
  const [zoom, setZoom] = useState(false);
  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setZoom(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);
  if (mimeType === "application/pdf") {
    return (
      <object data={url} type="application/pdf" className="h-[78vh] w-full rounded-xl border border-line bg-white" aria-label={title}>
        <a href={url} className="text-ledger underline">
          Open the PDF
        </a>
      </object>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setZoom(true)}
        className="group relative block w-full overflow-hidden rounded-xl border border-line bg-white shadow-[0_12px_30px_-18px_rgba(60,45,20,0.45)]"
        aria-label={`Enlarge ${title}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- original document, shown as-is */}
        <img src={url} alt={title} className="block w-full" />
        <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-ink/80 px-2.5 py-1 text-xs text-paper opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
          <IconZoom size={14} /> Enlarge
        </span>
      </button>
      {zoom && (
        <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 overflow-auto bg-ink/80 p-4 sm:p-10" onClick={() => setZoom(false)}>
          <button
            type="button"
            autoFocus
            onClick={() => setZoom(false)}
            className="fixed right-4 top-4 inline-flex items-center gap-1 rounded-full bg-paper px-3 py-1.5 text-sm text-ink"
          >
            <IconX size={15} /> Close
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element -- original document, shown as-is */}
          <img src={url} alt={title} className="mx-auto block w-full max-w-4xl rounded-lg bg-white" />
        </div>
      )}
    </>
  );
}
