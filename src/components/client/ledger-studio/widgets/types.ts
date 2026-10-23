// Registry of the ledger's custom AG Studio widgets, so report state and createWidgets() are typed.

import type { AgBaseRegistry, AgBaseWidgetDefinition, AgDefaultWidgetDefinition, AgWidgetData, AgWidgetDataFormat, AgWidgetFieldReference } from "ag-studio";

export interface ScoreboardDef extends AgWidgetData<{ category: AgWidgetFieldReference[]; value: AgWidgetFieldReference[] }, AgWidgetDataFormat<unknown>> {
  type: "credit-note-scoreboard";
}

export interface EvidenceDef extends AgWidgetData<Record<string, never>, AgWidgetDataFormat<unknown>> {
  type: "evidence-list";
}

export interface LedgerRegistry extends AgBaseRegistry {
  widgets: readonly (
    | AgDefaultWidgetDefinition
    | AgBaseWidgetDefinition<"credit-note-scoreboard", ScoreboardDef>
    | AgBaseWidgetDefinition<"evidence-list", EvidenceDef>
  )[];
}
