// AG Studio in Supplora's palette. Every value points at a token from app/globals.css (the same
// variables the Tailwind classes use), so Studio's canvas, widgets, grids and charts read as part of
// the page: paper background, cream cards, ink text, the ledger blue for focus and selection.

import { studioTheme } from "ag-studio";

const token = (name: string) => `var(--${name})`;
const line = (color: string) => ({ width: 1, color: token(color) });
const FONT = "var(--font-inter), Inter, ui-sans-serif, system-ui, sans-serif";

// Money series keep the meaning they have everywhere else in the app: blue = to pay or in flight,
// olive = sent / saved, saffron = withheld until a credit note, terracotta = held.
const CHART_PALETTE = ["ledger-2", "olive-2", "saffron", "terracotta", "ledger", "ink-2", "olive", "line-2", "muted", "paypal"];

const palette = Object.fromEntries(
  CHART_PALETTE.flatMap((name, i) => [
    [`chartPaletteFills${i + 1}Color`, token(name)],
    [`chartPaletteStrokes${i + 1}Color`, token(name)],
  ]),
);

export const supploraStudioTheme = studioTheme.withParams({
  fontFamily: FONT,
  fontSize: 14,
  textColor: token("ink"),
  foregroundColor: token("ink"),
  subtleTextColor: token("muted"),
  backgroundColor: token("card"),
  borderColor: token("line"),
  accentColor: token("ledger-2"),
  iconColor: token("ink-2"),
  rowHoverColor: token("paper-2"),

  // No frame of its own: the canvas is the page's paper; widgets are the app's cards.
  studioWrapperBorder: false,
  studioWrapperBorderRadius: 0,
  studioWrapperSpacing: 0,
  studioWrapperBackgroundColor: token("paper"),
  studioCanvasBorder: false,
  studioCanvasBorderRadius: 0,
  studioCanvasShadow: false,
  studioCanvasBackgroundColor: token("paper"),
  studioCanvasPadding: 16,
  studioCanvasRowHeight: 18,
  studioCanvasFontFamily: FONT,

  studioWidgetBackgroundColor: token("card"),
  studioWidgetBorder: line("line"),
  studioWidgetBorderRadius: 14,
  studioWidgetPadding: 12,
  studioWidgetTitleFontFamily: FONT,
  studioWidgetTitleFontSize: 15,
  studioWidgetTitleFontWeight: 600,
  studioWidgetTitleTextColor: token("ink"),
  studioWidgetSubtitleFontFamily: FONT,
  studioWidgetSubtitleFontSize: 13,
  studioWidgetSubtitleTextColor: token("muted"),
  studioWidgetCaptionFontFamily: FONT,
  studioWidgetCaptionFontSize: 12,
  studioWidgetCaptionTextColor: token("muted"),
  studioWidgetResizeBorderColor: token("ledger-2"),

  studioPanelContainerBackgroundColor: token("card"),
  studioPanelContainerBorder: line("line"),
  studioPanelContainerBorderRadius: 0,
  studioPanelDividerColor: token("line"),
  studioPanelDividerActiveColor: token("ledger-2"),
  studioPanelSectionBorderColor: token("line"),
  studioPanelHeaderFontFamily: FONT,
  studioPanelHeaderFontWeight: 600,
  studioPanelChevronButtonHoverBackgroundColor: token("paper-2"),
  studioPanelChevronButtonHoverColor: token("ledger"),
  studioToggleButtonActiveBackgroundColor: token("ledger-soft"),
  studioToggleButtonActiveBorderColor: token("ledger-2"),
  studioToggleButtonActiveColor: token("ledger"),

  gridFontFamily: FONT,
  gridFontSize: 13,
  gridCellTextColor: token("ink"),
  gridHeaderBackgroundColor: token("card"),
  gridHeaderTextColor: token("muted"),
  gridHeaderFontWeight: 600,
  gridHeaderFontSize: 12,
  gridRowHeight: 38,
  gridRowBorder: line("line"),
  gridHeaderRowBorder: line("line-2"),
  gridPinnedRowBorder: line("line-2"),
  gridRowHoverColor: token("paper-2"),
  gridWrapperBorder: false,

  chartFontFamily: FONT,
  chartTextColor: token("ink"),
  chartSubtleTextColor: token("muted"),
  chartAxisLineColor: token("line-2"),
  chartGridLineColor: token("line"),
  ...palette,
});
