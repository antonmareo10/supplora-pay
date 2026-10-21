"use client";

// Reconciliation results in AG Grid (Community): one row per payout item or store order,
// ledger vs PayPal side by side, with a match widget and the source of each check.
//
// Sized to fit a 1280 px laptop without a horizontal scroll: the PayPal ids sit one per line under the
// payment they belong to, the ledger's and PayPal's statuses share one column (shown once when they agree,
// both, highlighted, when they differ), and rows grow to fit wrapped text instead of cutting it.

import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useMemo, type ReactNode } from "react";
import { cx } from "@/components/ui";
import { fmt } from "@/lib/money";
import { referenceParts, statusView } from "@/lib/reconcile-view";
import type { ReconRow } from "@/lib/types";
import { supploraTheme } from "./ag-theme";

// Rows size to their content (autoHeight); a little less side padding than the default so every column fits.
const reconTheme = supploraTheme.withParams({ rowHeight: 44, cellHorizontalPadding: 10 });

/** More rows than this and the grid scrolls inside a fixed height instead of growing the page. */
const AUTO_HEIGHT_MAX_ROWS = 14;

const RESULT_STYLE: Record<ReconRow["result"], { label: string; cls: string }> = {
  match: { label: "Match", cls: "border-olive/25 bg-olive-soft text-olive" },
  pending: { label: "PayPal ahead", cls: "border-saffron/30 bg-saffron-soft text-[#8a5a0c]" },
  mismatch: { label: "Mismatch", cls: "border-terracotta/25 bg-terracotta-soft text-terracotta" },
};

/** Every cell starts at the same top padding, so the first lines of a row line up however tall the row is. */
function Cell({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("whitespace-normal py-2.5 leading-[1.3]", className)}>{children}</div>;
}

function ResultCell(p: ICellRendererParams<ReconRow>) {
  if (!p.data) return null;
  const s = RESULT_STYLE[p.data.result];
  return (
    <Cell>
      <span className={cx("inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11.5px] font-medium", s.cls)}>{s.label}</span>
    </Cell>
  );
}

function WhatCell(p: ICellRendererParams<ReconRow>) {
  if (!p.data) return null;
  const ids = referenceParts(p.data.kind, p.data.reference);
  return (
    <Cell>
      <span className="block font-medium text-ink">{p.data.counterparty}</span>
      <span className="block text-[11px] text-muted">{p.data.kind === "payout" ? "Supplier payout · REST Payouts" : "Store order · Agent Toolkit get_order"}</span>
      <span className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-1.5 text-[11.5px] leading-[1.35]">
        {ids.map((r, i) => (
          <span key={i} className="contents">
            <span className="text-[10.5px] text-muted">{r.label}</span>
            <code className="break-all font-mono tracking-tight text-ink-2">{r.id}</code>
          </span>
        ))}
      </span>
    </Cell>
  );
}

function AmountCell(p: ICellRendererParams<ReconRow, number | null>) {
  if (!p.data) return null;
  const v = p.value;
  const paypal = p.colDef?.field === "paypalCents";
  // PayPal's amount is flagged when it differs from the ledger's (reconcile.ts never "fixes" an amount).
  const differs = paypal && v !== p.data.ledgerCents;
  return <Cell className={cx("num text-right", differs ? "font-semibold text-terracotta" : paypal ? "font-medium text-ink" : "text-ink")}>{v == null ? "—" : fmt(v)}</Cell>;
}

function StatusCell(p: ICellRendererParams<ReconRow>) {
  if (!p.data) return null;
  const v = statusView(p.data.ledgerStatus, p.data.paypalStatus);
  if (v.agree) {
    return (
      <Cell>
        {v.paypal.map((s) => (
          <span key={s} className="block font-medium text-ink [overflow-wrap:anywhere]">
            {s}
          </span>
        ))}
        <span className="block text-[11px] text-olive">ledger = PayPal</span>
      </Cell>
    );
  }
  // They disagree: both, side by side in one highlighted block (amber when PayPal is ahead, red on a mismatch).
  const tone = p.data.result === "mismatch" ? "border-terracotta bg-terracotta-soft/50" : "border-saffron bg-saffron-soft/60";
  return (
    <Cell>
      <span className={cx("block rounded-r-md border-l-2 py-1 pl-2 pr-1 text-[12.5px] [overflow-wrap:anywhere]", tone)}>
        <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted">Ledger</span>
        {v.ledger.map((s) => (
          <span key={s} className="block text-ink-2">
            {s}
          </span>
        ))}
        <span className="mt-1 block text-[10px] font-semibold uppercase tracking-wider text-muted">PayPal</span>
        {v.paypal.map((s) => (
          <span key={s} className="block font-medium text-ink">
            {s}
          </span>
        ))}
      </span>
    </Cell>
  );
}

function ListedCell(p: ICellRendererParams<ReconRow>) {
  const v = p.data?.listed;
  if (v === null || v === undefined)
    return (
      <Cell className="text-muted">
        <span title="Transaction Search was not available">not checked</span>
      </Cell>
    );
  return (
    <Cell>
      {v ? (
        <span className="text-olive">✓ listed</span>
      ) : (
        <span className="text-[#8a5a0c]" title="Sandbox transactions can take up to 3 hours to appear">
          not listed yet
        </span>
      )}
    </Cell>
  );
}

function NoteCell(p: ICellRendererParams<ReconRow>) {
  if (!p.data) return null;
  return <Cell className="text-[12.5px] text-ink-2">{p.data.note}</Cell>;
}

export default function ReconcileGrid({ rows }: { rows: ReconRow[] }) {
  const columnDefs = useMemo<ColDef<ReconRow>[]>(
    () => [
      {
        field: "result",
        headerName: "Result",
        cellRenderer: ResultCell,
        width: 114,
        sort: "desc",
        comparator: (a: string, b: string) => ["match", "pending", "mismatch"].indexOf(a) - ["match", "pending", "mismatch"].indexOf(b),
      },
      {
        field: "counterparty",
        headerName: "What · PayPal ids",
        headerTooltip: "Who was paid, how it was checked, and the PayPal ids: payout batch and item, or order, authorization and capture",
        cellRenderer: WhatCell,
        minWidth: 188,
        flex: 1,
        autoHeight: true,
      },
      { field: "ledgerCents", headerName: "Ledger", type: "rightAligned", cellRenderer: AmountCell, width: 88 },
      { field: "paypalCents", headerName: "PayPal", type: "rightAligned", cellRenderer: AmountCell, width: 88 },
      {
        colId: "status",
        field: "paypalStatus",
        headerName: "Status",
        headerTooltip: "The ledger's status and PayPal's: shown once when they agree, both (highlighted) when they differ",
        cellRenderer: StatusCell,
        width: 164,
        autoHeight: true,
      },
      { field: "listed", headerName: "In account list", cellRenderer: ListedCell, width: 92, wrapHeaderText: true, autoHeaderHeight: true, autoHeight: true },
      { field: "note", headerName: "Note", cellRenderer: NoteCell, minWidth: 142, flex: 1.15, autoHeight: true },
    ],
    [],
  );
  const autoHeight = rows.length <= AUTO_HEIGHT_MAX_ROWS;
  return (
    <div style={autoHeight ? { width: "100%" } : { height: 640, width: "100%" }}>
      <AgGridReact<ReconRow>
        theme={reconTheme}
        domLayout={autoHeight ? "autoHeight" : "normal"}
        rowData={rows}
        columnDefs={columnDefs}
        defaultColDef={{ sortable: true, resizable: true }}
        getRowId={(p) => p.data.id}
        suppressCellFocus
        tooltipShowDelay={200}
        overlayNoRowsTemplate="Nothing paid through PayPal yet."
      />
    </div>
  );
}
