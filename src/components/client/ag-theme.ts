// Shared AG Grid (Community) setup for the ledger's grids: module registration and the
// Supplora theme. Client-only (imported by grids loaded with next/dynamic, ssr: false).

import { AllCommunityModule, ModuleRegistry, themeQuartz } from "ag-grid-community";
import type { PayableStatus } from "@/lib/payables-status";

// Community modules only (sorting, filters, quick filter, CSV export, pinned rows, tooltips,
// column groups, cell-change flashing). Nothing Enterprise, so no licence key and no watermark.
ModuleRegistry.registerModules([AllCommunityModule]);

/** Palette tokens from globals.css, for the grid and AG Charts (which can't read CSS vars). */
export const PALETTE = {
  paper: "#f4efe4",
  paper2: "#ebe3d2",
  card: "#fffcf6",
  ink: "#1b1914",
  ink2: "#4a4437",
  muted: "#7d7463",
  line: "#ddd2bd",
  olive: "#2f4a35",
  olive2: "#46684d",
  terracotta: "#b0452a",
  saffron: "#b97a12",
  ledger: "#1e3a5c",
  ledger2: "#2c5282",
  ledgerSoft: "#e3e9f1",
  paypal: "#003087",
} as const;

// Quartz, re-skinned to the "ledger on warm paper" look of the rest of the app. The app is
// light-only (`color-scheme: light`), so the grid is too.
export const supploraTheme = themeQuartz.withParams({
  accentColor: PALETTE.ledger,
  backgroundColor: PALETTE.card,
  foregroundColor: PALETTE.ink,
  textColor: PALETTE.ink,
  borderColor: PALETTE.line,
  chromeBackgroundColor: PALETTE.paper,
  headerBackgroundColor: PALETTE.paper2,
  headerTextColor: PALETTE.ink2,
  headerFontWeight: 600,
  oddRowBackgroundColor: "#fbf8f0",
  rowHoverColor: "#f1ead9",
  selectedRowBackgroundColor: PALETTE.ledgerSoft,
  rangeSelectionBorderColor: PALETTE.ledger,
  fontFamily: "var(--font-inter), ui-sans-serif, system-ui, sans-serif",
  headerFontFamily: "var(--font-inter), ui-sans-serif, system-ui, sans-serif",
  fontSize: 13,
  headerHeight: 42,
  rowHeight: 52,
  borderRadius: 10,
  wrapperBorderRadius: 14,
  cellHorizontalPadding: 16,
  columnBorder: false,
  headerColumnBorder: false,
  wrapperBorder: false,
  // Flash of a cell whose value changed (e.g. a payout moving from Paying to Paid).
  valueChangeValueHighlightBackgroundColor: "#f7ebcf",
});

/** Status pill styling, mirroring the app's <Pill> tones (see ui.tsx). */
export const STATUS_PILL: Record<PayableStatus, string> = {
  paid: "border-olive/25 bg-olive-soft text-olive",
  // Amber, dashed: PayPal holds the money until the supplier claims it (distinct from "Pay partial").
  sent: "border-dashed border-saffron/70 bg-card text-[#8a5a0c]",
  paying: "border-ledger/20 bg-ledger-soft text-ledger",
  failed: "border-terracotta/25 bg-terracotta-soft text-terracotta",
  held: "border-terracotta/25 bg-terracotta-soft text-terracotta",
  disputed: "border-saffron/30 bg-saffron-soft text-[#8a5a0c]",
  pending: "border-line bg-paper text-ink-2",
};

export const SEVERITY_DOT: Record<string, string> = {
  high: "bg-terracotta",
  medium: "bg-saffron",
  low: "bg-ledger",
  opportunity: "bg-olive-2",
  info: "bg-muted",
};
