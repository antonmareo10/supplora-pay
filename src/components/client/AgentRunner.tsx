"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import { readNdjson } from "@/lib/ndjson";
import type { AgentEvent } from "@/lib/types";
import { AgentTimeline } from "../AgentTimeline";
import { IconSpark } from "../icons";
import { buttonClass, ErrorNote } from "../ui";

/**
 * Starts an agent route and streams its NDJSON events into a timeline.
 * `fields` renders the owner's inputs (cash cap, spending limit) next to the button;
 * their values are posted as the JSON body, keyed by input name.
 */
export function AgentRunner({
  endpoint,
  buttonLabel,
  runningLabel,
  disabled,
  disabledReason,
  fields,
  intro,
  replay,
}: {
  endpoint: string;
  buttonLabel: string;
  runningLabel: string;
  disabled?: boolean;
  disabledReason?: string;
  fields?: ReactNode;
  intro?: ReactNode;
  /** Public demo: the run is a replay of a recorded Claude run. */
  replay?: boolean;
}) {
  const router = useRouter();
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  async function start() {
    const body = formRef.current ? Object.fromEntries(new FormData(formRef.current).entries()) : {};
    setRunning(true);
    setError(null);
    setEvents([]);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok || !res.body) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? `The agent could not start (${res.status}).`);
      }
      for await (const e of readNdjson<AgentEvent>(res.body)) {
        setEvents((prev) => [...prev, e]);
        if (e.type === "result") router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "The agent stopped unexpectedly.");
    } finally {
      setRunning(false);
      router.refresh();
    }
  }

  return (
    <div className="space-y-4">
      {intro}
      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          if (formRef.current?.reportValidity()) void start();
        }}
        className="flex flex-wrap items-end gap-3"
      >
        {fields}
        <button type="submit" disabled={running || disabled} className={buttonClass("primary", "lg")}>
          <IconSpark size={16} className={running ? "pulse-dot" : undefined} />
          {running ? runningLabel : buttonLabel}
        </button>
      </form>
      {disabled && disabledReason && <p className="text-sm text-muted">{disabledReason}</p>}
      {error && <ErrorNote>{error}</ErrorNote>}
      {(running || events.length > 0) && (
        <div className="rounded-xl border border-line bg-paper/60 p-4">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
            Agent log · {events.some((e) => e.type === "info" && e.tone === "replay") ? "demo replay" : events.some((e) => e.type === "info") ? "demo fallback" : "live"}
          </p>
          <AgentTimeline events={events} running={running} replay={replay} />
        </div>
      )}
    </div>
  );
}

export function EuroField({
  name,
  label,
  defaultValue,
  min,
  max,
  hint,
}: {
  name: string;
  label: string;
  defaultValue: number;
  min: number;
  max: number;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{label}</span>
      <span className="mt-1 flex h-12 items-center rounded-full border border-line-2 bg-card pl-4 pr-2 focus-within:border-ledger focus-within:ring-2 focus-within:ring-ledger/20">
        <span className="text-ink-2" aria-hidden="true">
          €
        </span>
        <input
          name={name}
          type="number"
          inputMode="decimal"
          step="0.01"
          min={min}
          max={max}
          required
          defaultValue={defaultValue}
          className="num w-28 bg-transparent px-1.5 text-lg font-semibold text-ink outline-none"
          aria-describedby={hint ? `${name}-hint` : undefined}
        />
      </span>
      {hint && (
        <span id={`${name}-hint`} className="mt-1 block text-xs text-muted">
          {hint}
        </span>
      )}
    </label>
  );
}
