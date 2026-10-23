// The ledger's two custom widgets, added to Studio's own catalogue under "Accounts payable".

import type { AgWidgetFormParams, AgWidgetsConfig, AgDefaultRegistry } from "ag-studio";
import { createWidgets } from "ag-studio-react";
import CreditNoteScoreboard from "./CreditNoteScoreboard";
import EvidenceList from "./EvidenceList";
import type { EvidenceDef, LedgerRegistry, ScoreboardDef } from "./types";

// Inline SVG icons for the widget menu (no external URLs).
const ICON_SCOREBOARD =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>';
const ICON_EVIDENCE =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/></svg>';

export function ledgerWidgets(defaults: AgWidgetsConfig<AgDefaultRegistry>): AgWidgetsConfig<LedgerRegistry> {
  return createWidgets<LedgerRegistry>({
    additionalTypes: [
      {
        id: "credit-note-scoreboard",
        label: "Credit-note scoreboard",
        icon: ICON_SCOREBOARD,
        dataMapping: {
          category: { type: "field", supportedRoles: ["category"], requires: { cardinality: "many" }, required: true, aiDescription: "Who owes money back, usually suppliers.name." },
          value: {
            type: "field",
            supportedRoles: ["numeric"],
            requires: { per: "dataMapping.category", cardinality: "one" },
            required: true,
            aiDescription: "Amount owed back, usually sum of invoices.withheld.",
          },
        },
        form: (params: AgWidgetFormParams<ScoreboardDef>) =>
          params.createDefaults({
            dataMappingItems: [
              { key: "category", label: "Who" },
              { key: "value", label: "Amount owed back" },
            ],
          }),
        comp: CreditNoteScoreboard,
        defaultSize: { width: 420, height: 320 },
        minSize: { width: 280, height: 160 },
        // Its own selection highlights a row instead of filtering the list away.
        featureConfig: { crossFilter: { supportsHighlight: true } },
        ai: {
          label: "Credit-note scoreboard",
          description: "Ranks who owes the restaurant a credit note (money withheld on partial payments), with a link to request it.",
          usage: "Use it to show which suppliers owe money back. Map category to suppliers.name and value to the sum of invoices.withheld.",
        },
      },
      {
        id: "evidence-list",
        label: "Evidence",
        icon: ICON_EVIDENCE,
        dataMapping: {},
        form: (params: AgWidgetFormParams<EvidenceDef>) => params.createDefaults({ dataMappingItems: [] }),
        comp: EvidenceList,
        defaultSize: { width: 480, height: 420 },
        minSize: { width: 280, height: 200 },
        ai: {
          label: "Evidence",
          description: "Cards with every finding behind the decisions (price rises, short deliveries, duplicates, changed payment details), with the evidence and a link to each invoice. Follows the page filters and cross-filters.",
          usage: "Use it next to charts so a click on a supplier or a finding type shows the evidence behind it. It needs no field mapping.",
        },
      },
    ],
    menu: [{ label: "Accounts payable", widgetIds: ["credit-note-scoreboard", "evidence-list"] }, ...defaults.menu],
  });
}
