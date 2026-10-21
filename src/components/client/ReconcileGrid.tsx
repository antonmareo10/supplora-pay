"use client";

// Reconciliation results in AG Grid (Community): one row per payout item or store order,
// ledger vs PayPal side by side, with a match widget and the source of each check.

import type { ColDef, ICellRendererParams, ValueFormatterParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useMemo } from "react";
import { cx } from "@/components/ui";
import { fmt } from "@/lib/money";
import type { ReconRow } from "@/lib/types";
import { supploraTheme } from "./ag-theme";

const RESULT_STYLE: Record<ReconRow["result"], { label: string; cls: string }> = {
  match: { label: "Match", cls: "border-olive/25 bg-olive-soft text-olive" },
  pending: { label: "PayPal ahead", cls: "border-saffron/30 bg-saffron-soft text-[#8a5a0c]" },
  mismatch: { label: "Mismatch", cls: "border-terracotta/25 bg-terracotta-soft text-terracotta" },
};

function ResultCell(p: ICellRendererParams<ReconRow>) {
  if (!p.data) return null;
  const s = RESULT_STYLE[p.data.result];
  return <span className={cx("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", s.cls)}>{s.label}</span>;
}

function KindCell(p: ICellRendererParams<ReconRow>) {
  if (!p.data) return null;
  return (
    <span className="flex h-full flex-col justify-center leading-tight">
      <span className="font-medium text-ink">{p.data.counterparty}</span>
      <span className="text-[11px] text-muted">{p.data.kind === "payout" ? "Supplier payout · REST Payouts" : "Store order · Agent Toolkit get_order"}</span>
    </span>
  );
}

function RefCell(p: ICellRendererParams<ReconRow>) {
  if (!p.data) return null;
  return <code className="font-mono text-[11.5px] tracking-tight text-ink-2">{p.data.reference}</code>;
}

function ListedCell(p: ICellRendererParams<ReconRow>) {
  const v = p.data?.listed;
  if (v === null || v === undefined) return <span className="text-muted" title="Transaction Search was not available">not checked</span>;
  return v ? <span className="text-olive">✓ listed</span> : <span className="text-[#8a5a0c]" title="Sandbox transactions can take up to 3 hours to appear">not listed yet</span>;
}

export default function ReconcileGrid({ rows }: { rows: ReconRow[] }) {
  const columnDefs = useMemo<ColDef<ReconRow>[]>(() => {
    const money = (p: ValueFormatterParams<ReconRow, number | null>) => (p.value == null ? "—" : fmt(p.value));
    return [
      { field: "result", headerName: "Result", cellRenderer: ResultCell, width: 130, sort: "desc", comparator: (a: string, b: string) => ["match", "pending", "mismatch"].indexOf(a) - ["match", "pending", "mismatch"].indexOf(b) },
      { field: "counterparty", headerName: "What", cellRenderer: KindCell, minWidth: 220, flex: 1 },
      { field: "reference", headerName: "PayPal reference", cellRenderer: RefCell, minWidth: 220, flex: 1 },
      { field: "ledgerCents", headerName: "Ledger", type: "rightAligned", cellClass: "num", width: 110, valueFormatter: money },
      { field: "paypalCents", headerName: "PayPal", type: "rightAligned", cellClass: "num font-medium", width: 110, valueFormatter: money },
      { field: "ledgerStatus", headerName: "Ledger status", width: 170, tooltipField: "ledgerStatus" },
      { field: "paypalStatus", headerName: "PayPal status", width: 210, tooltipField: "paypalStatus" },
      { field: "listed", headerName: "In account list", cellRenderer: ListedCell, width: 140 },
      { field: "note", headerName: "Note", minWidth: 240, flex: 1, tooltipField: "note" },
    ];
  }, []);
  return (
    <div style={{ height: Math.min(420, 92 + rows.length * 52), width: "100%" }}>
      <AgGridReact<ReconRow>
        theme={supploraTheme}
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
