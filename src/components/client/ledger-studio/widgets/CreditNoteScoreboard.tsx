"use client";

// Custom AG Studio widget: who owes the restaurant a credit note, as a friendly scoreboard rather than
// a collections report. Rows come from Studio's data engine (so page filters and other widgets'
// cross-filters apply), a click cross-filters the rest of the page to that supplier while the board
// keeps every row and highlights the pick, and each row links to the drafted request on /disputes.

import type { AgWidgetParams } from "ag-studio";
import Link from "next/link";
import type { MouseEvent } from "react";
import { useEffect, useRef, useState } from "react";
import type { ScoreboardDef } from "./types";

interface Row {
  value: unknown;
  label: string;
  amount: number;
  display: string;
}

export default function CreditNoteScoreboard(params: AgWidgetParams<ScoreboardDef>) {
  const { dataMapping, widgetApi } = params;
  const [rows, setRows] = useState<Row[]>([]);
  const loaded = useRef(false);
  const selections = widgetApi.getCrossFilterSelections();
  const selected = new Set<unknown>();
  selections?.forEach((s) => {
    if (s.type === "value") s.values.forEach((v) => selected.add(v));
  });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const category = dataMapping.category?.at(0);
      const value = dataMapping.value?.at(0);
      if (!category || !value) {
        widgetApi.setDisplayState("incompleteDataMapping");
        setRows([]);
        return;
      }
      widgetApi.setDisplayState("loading", { prominent: !loaded.current });
      const response = await widgetApi.getData({ fields: [category, value], sort: [{ field: value, direction: "desc" }] });
      if (cancelled) return;
      const next = response.results.rows
        .map((r) => ({
          value: r[category.key],
          label: widgetApi.formatFieldValue(category, r[category.key]),
          amount: Number(r[value.key]) || 0,
          display: widgetApi.formatFieldValue(value, r[value.key]),
        }))
        .filter((r) => r.amount > 0);
      loaded.current = next.length > 0;
      setRows(next);
      widgetApi.setDisplayState(next.length > 0 ? "displayed" : "noData");
    };
    load().catch(() => {
      if (!cancelled) widgetApi.setDisplayState("noData");
    });
    return () => {
      cancelled = true;
    };
  }, [params, dataMapping, widgetApi]);

  const category = dataMapping.category?.at(0);
  const max = Math.max(1, ...rows.map((r) => r.amount));
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const value = dataMapping.value?.at(0);

  const pick = (row: Row) => (e: MouseEvent) => {
    if (!category) return;
    widgetApi.toggleCrossFilter({ type: "value", value: row.value, field: category, group: 0, reset: !(e.metaKey || e.ctrlKey) });
    e.stopPropagation();
  };

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-2 overflow-auto px-1 pb-1"
      // A click on the empty background clears this widget's selection, like Studio's own charts.
      onClick={(e) => {
        if (e.target === e.currentTarget) widgetApi.resetCrossFilter();
      }}
    >
      <ol className="space-y-1.5">
        {rows.map((row, i) => {
          const on = selected.has(row.value);
          return (
            <li
              key={String(row.value)}
              className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 transition ${on ? "border-saffron bg-saffron-soft" : "border-line bg-paper/60"} ${selected.size > 0 && !on ? "opacity-55" : ""}`}
            >
              <span className="num grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ink text-[12px] font-semibold text-paper" aria-hidden>
                {i + 1}
              </span>
              <button type="button" onClick={pick(row)} aria-pressed={on} className="min-w-0 flex-1 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ledger-2">
                <span className="block truncate text-sm font-medium text-ink">{row.label}</span>
                <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-saffron-soft" aria-hidden>
                  <span className="block h-full rounded-full bg-saffron" style={{ width: `${Math.max(6, Math.round((row.amount / max) * 100))}%` }} />
                </span>
              </button>
              <span className="num shrink-0 text-right">
                <span className="block text-lg font-semibold leading-none text-[#8a5a0c]">{row.display}</span>
                <span className="block text-[10.5px] text-muted">owed back</span>
              </span>
              <Link href="/disputes" className="shrink-0 rounded-full border border-line-2 bg-card px-2.5 py-1 text-xs font-medium text-ink hover:border-ink-2/50" onClick={(e) => e.stopPropagation()}>
                Ask for it
              </Link>
            </li>
          );
        })}
      </ol>
      {rows.length > 1 && value && (
        <p className="mt-auto text-right text-xs text-muted">
          {rows.length} suppliers · <span className="num font-medium text-ink">{widgetApi.formatFieldValue(value, total)}</span> to come back as credit notes
        </p>
      )}
    </div>
  );
}
