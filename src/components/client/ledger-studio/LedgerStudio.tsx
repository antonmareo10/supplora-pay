"use client";

// The ledger as an AG Studio report: the owner (or Claude, through the Studio Agent Framework) can
// slice the week's payables by supplier, week, finding or PayPal status, and change the dashboard
// without code. This file wires Studio to the app: data, theme, custom widgets, default report,
// page tabs, view/edit mode and a saved copy of the report in this browser.

import type { AgAiHarnessSetup, AgReportState, AgStudioApi, AgStudioMode } from "ag-studio";
import { AgStudioAiModule, enableStudioDevValidations } from "ag-studio";
import { AgStudio, AgStudioProvider } from "ag-studio-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { cx } from "@/components/ui";
import type { StudioTables } from "@/lib/studio-data";
import { buildStudioData } from "./data";
import { defaultReport, PAGES, REPORT_VERSION } from "./report";
import { supploraStudioTheme } from "./theme";
import { ledgerWidgets } from "./widgets";
import type { LedgerRegistry } from "./widgets/types";

if (process.env.NODE_ENV !== "production") enableStudioDevValidations();

const STORAGE_KEY = `supplora.ledgerStudio.v${REPORT_VERSION}`;

function readSaved(): AgReportState<LedgerRegistry> | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AgReportState<LedgerRegistry>) : null;
  } catch {
    return null;
  }
}

function writeSaved(state: AgReportState<LedgerRegistry> | null): boolean {
  try {
    if (state) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    else window.localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

const pageTitle = (id: string, index: number) => PAGES.find((p) => p.id === id)?.title ?? `Page ${index + 1}`;

const widgetCounts = (s: AgReportState<LedgerRegistry>) => new Map((s.pages ?? []).map((p) => [p.id, Object.keys(p.widgets ?? {}).length]));

export default function LedgerStudio({ tables, licenseKey, ai }: { tables: StudioTables; licenseKey?: string; ai?: AgAiHarnessSetup }) {
  const apiRef = useRef<AgStudioApi<LedgerRegistry> | null>(null);
  const data = useMemo(() => buildStudioData(tables), [tables]);
  // Studio reads initialState once; afterwards the state lives in Studio.
  const [initialState] = useState(() => readSaved() ?? defaultReport());
  const [hasSaved, setHasSaved] = useState(() => readSaved() !== null);
  const [state, setState] = useState<AgReportState<LedgerRegistry>>(initialState);
  const [mode, setMode] = useState<AgStudioMode>("view");
  const [note, setNote] = useState<string | null>(null);

  const flash = useCallback((text: string) => {
    setNote(text);
    window.setTimeout(() => setNote(null), 2600);
  }, []);

  const selectPage = useCallback((pageId: string) => {
    const api = apiRef.current;
    if (api) api.setState({ ...api.getState(), selectedPageId: pageId });
  }, []);

  const save = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    if (writeSaved(api.getState())) {
      setHasSaved(true);
      flash("Saved in this browser");
    } else flash("This browser does not allow saving");
  }, [flash]);

  const reset = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    writeSaved(null);
    setHasSaved(false);
    api.setState(defaultReport());
    api.clearHistory();
    setMode("view");
    flash("Back to the built-in report");
  }, [flash]);

  const askClaude = useCallback(() => {
    setMode("edit");
    // Open the chat panel once Studio has switched to edit mode.
    window.setTimeout(() => {
      const api = apiRef.current;
      if (!api) return;
      const current = api.getState();
      // Chat open, the edit and data panels folded away so the dashboard keeps its width.
      api.setState({ ...current, panels: { ...current.panels, ai: { collapsed: false }, edit: { collapsed: true }, data: { collapsed: true } } });
    }, 50);
  }, []);

  const pages = state.pages ?? [];

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Report pages" className="flex min-w-0 flex-1 flex-wrap gap-1">
          {pages.map((p, i) => {
            const active = p.id === state.selectedPageId;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => selectPage(p.id)}
                aria-current={active ? "page" : undefined}
                className={cx("rounded-full px-3 py-1.5 text-sm transition", active ? "bg-ink text-paper" : "border border-line bg-card text-ink-2 hover:border-line-2 hover:text-ink")}
              >
                {pageTitle(p.id, i)}
              </button>
            );
          })}
        </nav>
        <div className="flex items-center gap-1.5">
          {note && (
            <span role="status" className="text-xs text-muted">
              {note}
            </span>
          )}
          {ai && (
            <button
              type="button"
              onClick={askClaude}
              className="inline-flex items-center gap-1.5 rounded-full bg-ledger px-3.5 py-1.5 text-xs font-semibold text-paper shadow-sm transition hover:bg-ledger-2"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
              </svg>
              Ask Claude
            </button>
          )}
          <div className="inline-flex rounded-full border border-line bg-paper p-0.5 text-xs" role="group" aria-label="Mode">
            {(["view", "edit"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={cx("rounded-full px-3 py-1 font-medium capitalize transition", mode === m ? "bg-ink text-paper" : "text-ink-2 hover:text-ink")}
              >
                {m}
              </button>
            ))}
          </div>
          <button type="button" onClick={save} className="rounded-full border border-line-2 bg-card px-3 py-1.5 text-xs font-medium text-ink hover:border-ink-2/50">
            Save
          </button>
          {(hasSaved || mode === "edit") && (
            <button type="button" onClick={reset} className="rounded-full px-2.5 py-1.5 text-xs text-muted underline-offset-2 hover:text-ink hover:underline">
              Reset
            </button>
          )}
        </div>
      </div>

      <div className="h-[78vh] min-h-[620px] overflow-hidden rounded-2xl border border-line bg-paper">
        <AgStudioProvider licenseKey={licenseKey} modules={ai ? [AgStudioAiModule] : undefined}>
          <AgStudio<LedgerRegistry>
            style={{ height: "100%", width: "100%" }}
            theme={supploraStudioTheme}
            layout={{ widgetBorderEnabled: true }}
            // Studio offers the chat panel in edit mode only; "Ask Claude" switches to it.
            panels={{ view: { left: [], right: ["filters"] }, edit: { left: ["filters"], right: ai ? ["ai", "edit", "data"] : ["edit", "data"] } }}
            data={data}
            widgets={ledgerWidgets}
            initialState={initialState}
            mode={mode}
            ai={ai}
            onApiReady={(e) => {
              apiRef.current = e.api as unknown as AgStudioApi<LedgerRegistry>;
              // Lets the local recording script drive Studio; never in a production build.
              if (process.env.NODE_ENV !== "production") (window as unknown as { __ledgerStudioApi?: unknown }).__ledgerStudioApi = e.api;
            }}
            onStudioReady={(e) => setState(e.api.getState() as unknown as AgReportState<LedgerRegistry>)}
            onStateUpdated={(e) => {
              const next = e.state as unknown as AgReportState<LedgerRegistry>;
              // When Claude adds widgets to another page, follow it there so the owner sees them appear.
              const before = widgetCounts(state);
              const grown = (next.pages ?? []).find((p) => p.id !== next.selectedPageId && Object.keys(p.widgets ?? {}).length > (before.get(p.id) ?? 0));
              setState(next);
              if (grown) window.setTimeout(() => selectPage(grown.id), 0);
            }}
          />
        </AgStudioProvider>
      </div>
    </div>
  );
}
