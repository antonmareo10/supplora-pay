"use client";

// Connects the Studio Agent Framework to the ledger: live Claude turns through /api/studio/llm, or
// the public demo's replays of recorded runs. With ?record=1 on a local dev server (RECORD_DEMO=1),
// live runs of the suggested prompts can be saved as those replays.

import type { AgAiPromptStarter } from "ag-studio";
import { useEffect, useMemo, useState } from "react";
import recordings from "@/data/recorded/studio-runs.json";
import type { StudioTables } from "@/lib/studio-data";
import { claudeAdapter, replayAdapter, RunRecorder, type RecordedRun } from "./ai/adapter";
import { buildHarness, PROMPT_STARTERS } from "./ai/agents";
import type { StudioAiConfig } from "./ai/config";
import LedgerStudio from "./LedgerStudio";

const RECORDED = (recordings as unknown as { runs: RecordedRun[] }).runs;

export default function LedgerStudioWithAi({ tables, licenseKey, ai }: { tables: StudioTables; licenseKey?: string; ai: StudioAiConfig }) {
  const [recorder] = useState(() =>
    ai.mode === "live" && process.env.NODE_ENV !== "production" && typeof window !== "undefined" && new URLSearchParams(window.location.search).has("record")
      ? new RunRecorder(PROMPT_STARTERS)
      : undefined,
  );
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => {
    // Lets the local recording script read the runs; only exists with ?record=1 on a dev server.
    if (recorder) (window as unknown as { __studioRecorder?: RunRecorder }).__studioRecorder = recorder;
  }, [recorder]);

  const harness = useMemo(() => {
    if (ai.mode === "off") return undefined;
    if (ai.mode === "live") return buildHarness({ adapter: claudeAdapter({ endpoint: "/api/studio/llm", recorder }), tables, model: ai.model });
    // Replay: offer only the prompts that have a recording.
    const starters: AgAiPromptStarter[] = RECORDED.map((r) => ({ label: r.label, prompt: r.prompt }));
    return buildHarness({ adapter: replayAdapter(RECORDED), tables, model: ai.model, starters });
  }, [ai.mode, ai.model, tables, recorder]);

  return (
    <div className="space-y-2">
      {ai.mode === "replay" && (
        <p className="rounded-xl border border-ledger/20 bg-ledger-soft/60 px-3.5 py-2 text-xs leading-relaxed text-ink-2">
          <span className="font-semibold text-ledger">Ask Claude</span> opens the chat. This public demo has no API key: the suggested prompts replay
          recordings of real Claude runs on the Studio Agent Framework, and Studio carries out the recorded steps on your dashboard. Run the app locally
          with an Anthropic key to ask anything.
        </p>
      )}
      {recorder && (
        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            className="rounded-full border border-terracotta/40 bg-terracotta-soft px-3 py-1 font-medium text-terracotta"
            onClick={async () => {
              const res = await fetch("/api/studio/recordings", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ model: ai.model, runs: recorder.runs }),
              });
              const body = (await res.json().catch(() => ({}))) as { saved?: number; error?: string };
              setSaved(res.ok ? `Saved ${body.saved} recorded run(s)` : (body.error ?? `Failed (${res.status})`));
            }}
          >
            Save recorded runs ({recorder.runs.length})
          </button>
          {saved && <span role="status">{saved}</span>}
        </div>
      )}
      <LedgerStudio tables={tables} licenseKey={licenseKey} ai={harness} />
    </div>
  );
}
