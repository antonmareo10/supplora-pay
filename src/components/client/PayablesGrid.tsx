"use client";

// Payables dashboard built on AG Grid (Community). One row per reviewed invoice.
//
// Why a grid: /ledger is where the restaurant owner answers "what do I owe, what
// did we hold, and why". A static table can't sort by due date, filter to the
// held invoices, search a supplier or total the column that is currently in view.
// This grid does all of that and keeps its running totals row in sync with the
// filter, so the number at the bottom is always the money on screen.
//
// Licensing note: native row grouping + aggFunc are AG Grid *Enterprise* features.
// Rather than ship an unlicensed Enterprise watermark, everything here is genuine
// Community: external filter API (status chips), quick filter, per-column filters,
// a live filter-aware pinned totals row, a group-by sort with a live subtotal strip,
// and CSV export. All load-bearing, all free, no watermark.

import Link from "next/link";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type CellClassRules,
  type ColDef,
  type GridApi,
  type GridReadyEvent,
  type ICellRendererParams,
  type IRowNode,
  type ValueFormatterParams,
  type ValueGetterParams,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { cx } from "@/components/ui";
import { relativeDue } from "@/lib/dates";
import { fmt } from "@/lib/money";
import { STATUS_LABEL, STATUS_ORDER, type PayableStatus } from "@/lib/payables-status";
import type { PayableRow } from "@/lib/payables-view";

// Register the Community modules once (sorting, filtering, quick filter, CSV export,
// pinned rows, value formatters, external filter — all live in AllCommunityModule).
ModuleRegistry.registerModules([AllCommunityModule]);

// Quartz, re-skinned to the Supplora Pay palette (mirrors the tokens in globals.css).
// The app is light-only (`color-scheme: light`), so the theme is light to match.
const supploraTheme = themeQuartz.withParams({
  accentColor: "#1e3a5c", // --ledger
  backgroundColor: "#fffcf6", // --card
  foregroundColor: "#1b1914", // --ink
  textColor: "#1b1914",
  borderColor: "#ddd2bd", // --line
  chromeBackgroundColor: "#f4efe4", // --paper (floating-filter / tool strip)
  headerBackgroundColor: "#ebe3d2", // --paper-2
  headerTextColor: "#4a4437", // --ink-2
  headerFontWeight: 600,
  oddRowBackgroundColor: "#fbf8f0",
  rowHoverColor: "#f1ead9",
  selectedRowBackgroundColor: "#e3e9f1", // --ledger-soft
  rangeSelectionBorderColor: "#1e3a5c",
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
});

// Status pill styling mirrors the app's <Pill> tones (see ui.tsx TONE_PILL).
const STATUS_PILL: Record<PayableStatus, string> = {
  paid: "border-olive/25 bg-olive-soft text-olive",
  sent: "border-ink/70 bg-ink text-paper",
  paying: "border-ledger/20 bg-ledger-soft text-ledger",
  failed: "border-terracotta/25 bg-terracotta-soft text-terracotta",
  held: "border-terracotta/25 bg-terracotta-soft text-terracotta",
  disputed: "border-saffron/30 bg-saffron-soft text-[#8a5a0c]",
  pending: "border-line bg-paper text-ink-2",
};

const SEVERITY_DOT: Record<string, string> = {
  high: "bg-terracotta",
  medium: "bg-saffron",
  low: "bg-ledger",
  opportunity: "bg-olive-2",
  info: "bg-muted",
};

type GroupKey = "none" | "status" | "supplier";

interface TotalsRow {
  __total: true;
  id: string;
  supplier: string;
  count: number;
  invoiceCents: number;
  withheldCents: number;
  discountCents: number;
  paidCents: number;
  savedCents: number;
}

interface GroupSummary {
  key: string;
  label: string;
  tone: string;
  count: number;
  cents: number;
}

// --- cell renderers --------------------------------------------------------

function SupplierCell(p: ICellRendererParams<PayableRow>) {
  if (p.node.rowPinned) {
    const t = p.data as unknown as TotalsRow;
    return (
      <span className="font-semibold text-ink">
        Totals <span className="text-muted font-normal">· {t.count} invoice{t.count === 1 ? "" : "s"} in view</span>
      </span>
    );
  }
  const row = p.data;
  if (!row) return null;
  return (
    <Link href={`/inbox/${row.id}`} className="group flex flex-col justify-center leading-tight">
      <span className="font-medium text-ink group-hover:text-ledger">{row.supplier}</span>
      <span className="text-[11px] capitalize text-muted">{row.category}</span>
    </Link>
  );
}

function InvoiceCell(p: ICellRendererParams<PayableRow>) {
  if (p.node.rowPinned || !p.data) return null;
  return (
    <Link href={`/inbox/${p.data.id}`} className="font-mono text-[12px] tracking-tight text-ink-2 hover:text-ledger">
      {p.data.invoiceNumber}
    </Link>
  );
}

function StatusCell(p: ICellRendererParams<PayableRow>) {
  if (p.node.rowPinned || !p.data) return null;
  const s = p.data.status;
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium", STATUS_PILL[s])}>
      {STATUS_LABEL[s]}
    </span>
  );
}

function RecommendationCell(p: ICellRendererParams<PayableRow>) {
  if (p.node.rowPinned || !p.data) return null;
  const tone =
    p.data.recommendation === "hold" ? "text-terracotta" : p.data.recommendation === "pay_partial" ? "text-[#8a5a0c]" : "text-olive";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cx("text-sm font-medium", tone)}>{p.data.recommendationLabel}</span>
      {p.data.ownerDecision && <span className="rounded-full border border-line bg-paper px-1.5 text-[10px] uppercase tracking-wide text-muted">owner</span>}
    </span>
  );
}

function FindingCell(p: ICellRendererParams<PayableRow>) {
  if (p.node.rowPinned || !p.data) return null;
  const sev = p.data.findingSeverity;
  return (
    <span className="flex items-center gap-2 leading-tight">
      <span className={cx("h-1.5 w-1.5 shrink-0 rounded-full", sev ? SEVERITY_DOT[sev] : "bg-line-2")} aria-hidden />
      <span className="truncate text-ink-2">{p.data.finding}</span>
      {p.data.findingCount > 1 && <span className="shrink-0 text-[11px] text-muted">+{p.data.findingCount - 1}</span>}
    </span>
  );
}

function makeDueCell(today: string) {
  return function DueCell(p: ICellRendererParams<PayableRow>) {
    if (p.node.rowPinned || !p.data) return null;
    const due = p.data.dueDate;
    if (!due) return <span className="text-muted">—</span>;
    const rel = relativeDue(today, due);
    const overdue = rel.includes("overdue");
    const soon = rel === "due today" || rel === "due tomorrow";
    return (
      <span className="flex flex-col justify-center leading-tight">
        <span className="num text-ink-2">{p.value}</span>
        <span className={cx("text-[11px]", overdue ? "text-terracotta" : soon ? "text-saffron" : "text-muted")}>{rel}</span>
      </span>
    );
  };
}

function PaypalCell(p: ICellRendererParams<PayableRow>) {
  if (p.node.rowPinned || !p.data) return null;
  if (!p.data.paypalBatchId) return <span className="text-muted">—</span>;
  return (
    <span className="flex flex-col justify-center leading-tight">
      <code className="font-mono text-[12px] tracking-tight text-ink-2">{p.data.paypalBatchId}</code>
      {p.data.paypalItemId && <code className="font-mono text-[11px] tracking-tight text-muted">{p.data.paypalItemId}</code>}
    </span>
  );
}

// --- grid ------------------------------------------------------------------

export default function PayablesGrid({ rows, today }: { rows: PayableRow[]; today: string }) {
  const apiRef = useRef<GridApi<PayableRow> | null>(null);
  const [quick, setQuick] = useState("");
  const [groupBy, setGroupBy] = useState<GroupKey>("status");
  // Read by recompute(), which AG Grid calls from its own events: a ref never goes stale.
  const groupRef = useRef<GroupKey>("status");
  const [active, setActive] = useState<Set<PayableStatus>>(new Set());
  const activeRef = useRef(active);
  const [totals, setTotals] = useState<TotalsRow | null>(null);
  const [groups, setGroups] = useState<GroupSummary[]>([]);

  // Statuses actually present in the data, in logical order, for the chip row.
  const presentStatuses = useMemo(() => {
    const seen = new Set(rows.map((r) => r.status));
    return STATUS_ORDER.filter((s) => seen.has(s));
  }, [rows]);

  const moneyFmt = useCallback((p: ValueFormatterParams<PayableRow, number>) => fmt(p.value ?? 0), []);
  const moneyOrDash = useCallback((p: ValueFormatterParams<PayableRow, number>) => (p.value ? fmt(p.value) : "—"), []);
  const dueFmt = useCallback((p: ValueFormatterParams<PayableRow, string>) => {
    if (!p.value) return "—";
    const d = new Date(`${p.value}T00:00:00Z`);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  }, []);

  const columnDefs = useMemo<ColDef<PayableRow>[]>(() => {
    const dueCell = makeDueCell(today);
    return [
      {
        field: "supplier",
        headerName: "Supplier",
        cellRenderer: SupplierCell,
        flex: 2,
        minWidth: 190,
        filter: "agTextColumnFilter",
      },
      {
        field: "invoiceNumber",
        headerName: "Invoice",
        cellRenderer: InvoiceCell,
        width: 140,
        filter: "agTextColumnFilter",
      },
      {
        field: "status",
        headerName: "Status",
        cellRenderer: StatusCell,
        width: 150,
        comparator: (a: PayableStatus, b: PayableStatus) => STATUS_ORDER.indexOf(a) - STATUS_ORDER.indexOf(b),
        filterValueGetter: (p: ValueGetterParams<PayableRow>) => (p.data ? STATUS_LABEL[p.data.status] : ""),
        filter: "agTextColumnFilter",
      },
      {
        field: "recommendationLabel",
        headerName: "Recommendation",
        cellRenderer: RecommendationCell,
        width: 165,
        filter: "agTextColumnFilter",
      },
      {
        field: "finding",
        headerName: "Top finding",
        cellRenderer: FindingCell,
        flex: 2,
        minWidth: 190,
        filter: "agTextColumnFilter",
      },
      {
        field: "dueDate",
        headerName: "Due",
        cellRenderer: dueCell,
        valueFormatter: dueFmt,
        width: 130,
        filter: "agDateColumnFilter",
        filterParams: {
          comparator: (filterDate: Date, cellValue: string | null) => {
            if (!cellValue) return -1;
            const cell = new Date(`${cellValue}T00:00:00Z`);
            const f = Date.UTC(filterDate.getFullYear(), filterDate.getMonth(), filterDate.getDate());
            const c = Date.UTC(cell.getUTCFullYear(), cell.getUTCMonth(), cell.getUTCDate());
            return c < f ? -1 : c > f ? 1 : 0;
          },
        },
      },
      {
        field: "invoiceCents",
        headerName: "Amount",
        type: "rightAligned",
        cellClass: "num",
        width: 120,
        valueFormatter: moneyFmt,
        filter: "agNumberColumnFilter",
        filterValueGetter: (p: ValueGetterParams<PayableRow>) => (p.data ? p.data.invoiceCents / 100 : null),
      },
      {
        field: "withheldCents",
        headerName: "Withheld",
        type: "rightAligned",
        cellClass: "num",
        cellClassRules: { "text-terracotta": (p) => (p.value as number) > 0 } as CellClassRules<PayableRow>,
        width: 118,
        valueFormatter: moneyOrDash,
        filter: "agNumberColumnFilter",
        filterValueGetter: (p: ValueGetterParams<PayableRow>) => (p.data ? p.data.withheldCents / 100 : null),
      },
      {
        field: "discountCents",
        headerName: "Discount",
        type: "rightAligned",
        cellClass: "num",
        cellClassRules: { "text-olive": (p) => (p.value as number) > 0 } as CellClassRules<PayableRow>,
        width: 112,
        valueFormatter: moneyOrDash,
      },
      {
        field: "paidCents",
        headerName: "Paid",
        type: "rightAligned",
        cellClass: "num font-medium",
        width: 120,
        valueFormatter: moneyOrDash,
        filter: "agNumberColumnFilter",
        filterValueGetter: (p: ValueGetterParams<PayableRow>) => (p.data?.paidCents != null ? p.data.paidCents / 100 : null),
      },
      {
        field: "savedCents",
        headerName: "Saved",
        type: "rightAligned",
        cellClass: "num",
        cellClassRules: { "text-olive font-medium": (p) => (p.value as number) > 0 } as CellClassRules<PayableRow>,
        width: 112,
        valueFormatter: moneyOrDash,
      },
      {
        headerName: "PayPal batch · item",
        colId: "paypal",
        cellRenderer: PaypalCell,
        valueGetter: (p: ValueGetterParams<PayableRow>) => (p.data ? [p.data.paypalBatchId, p.data.paypalItemId].filter(Boolean).join(" ") : ""),
        width: 170,
        filter: "agTextColumnFilter",
      },
    ];
  }, [today, moneyFmt, moneyOrDash, dueFmt]);

  const defaultColDef = useMemo<ColDef<PayableRow>>(
    () => ({ sortable: true, resizable: true, filter: true, floatingFilter: true, suppressHeaderMenuButton: false }),
    [],
  );

  // Recompute the live totals row and the group-summary strip from the rows that
  // currently pass the filter (quick filter + column filters + status chips).
  const recompute = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    let count = 0;
    let invoice = 0;
    let withheld = 0;
    let discount = 0;
    let paid = 0;
    let saved = 0;
    const map = new Map<string, GroupSummary>();
    const groupBy = groupRef.current;
    api.forEachNodeAfterFilter((node: IRowNode<PayableRow>) => {
      const d = node.data;
      if (!d) return;
      count++;
      invoice += d.invoiceCents;
      withheld += d.withheldCents;
      discount += d.discountCents;
      paid += d.paidCents ?? 0;
      saved += d.savedCents;
      if (groupBy !== "none") {
        const key = groupBy === "supplier" ? d.supplier : d.status;
        const label = groupBy === "supplier" ? d.supplier : STATUS_LABEL[d.status];
        const tone = groupBy === "supplier" ? "border-line bg-paper text-ink-2" : STATUS_PILL[d.status];
        const g = map.get(key) ?? { key, label, tone, count: 0, cents: 0 };
        g.count++;
        g.cents += d.invoiceCents;
        map.set(key, g);
      }
    });
    setTotals({ __total: true, id: "__totals__", supplier: "Totals", count, invoiceCents: invoice, withheldCents: withheld, discountCents: discount, paidCents: paid, savedCents: saved });
    if (groupBy === "status") {
      setGroups([...map.values()].sort((a, b) => STATUS_ORDER.indexOf(a.key as PayableStatus) - STATUS_ORDER.indexOf(b.key as PayableStatus)));
    } else {
      setGroups([...map.values()].sort((a, b) => b.cents - a.cents));
    }
  }, []);

  const applyGroupSort = useCallback((key: GroupKey, api: GridApi<PayableRow>) => {
    if (key === "supplier") {
      api.applyColumnState({ state: [{ colId: "supplier", sort: "asc", sortIndex: 0 }, { colId: "status", sort: "asc", sortIndex: 1 }], defaultState: { sort: null } });
    } else {
      // "status" and "none" both cluster urgent work first via the status order.
      api.applyColumnState({ state: [{ colId: "status", sort: "asc", sortIndex: 0 }], defaultState: { sort: null } });
    }
  }, []);

  const onGridReady = useCallback(
    (e: GridReadyEvent<PayableRow>) => {
      apiRef.current = e.api;
      applyGroupSort(groupRef.current, e.api);
    },
    [applyGroupSort],
  );

  const onChangeGroup = useCallback(
    (key: GroupKey) => {
      setGroupBy(key);
      groupRef.current = key;
      if (apiRef.current) applyGroupSort(key, apiRef.current);
      recompute();
    },
    [applyGroupSort, recompute],
  );

  const toggleStatus = useCallback((s: PayableStatus) => {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      activeRef.current = next;
      apiRef.current?.onFilterChanged();
      return next;
    });
  }, []);

  const clearStatus = useCallback(() => {
    const next = new Set<PayableStatus>();
    setActive(next);
    activeRef.current = next;
    apiRef.current?.onFilterChanged();
  }, []);

  const isExternalFilterPresent = useCallback(() => activeRef.current.size > 0, []);
  const doesExternalFilterPass = useCallback((node: IRowNode<PayableRow>) => (node.data ? activeRef.current.has(node.data.status) : true), []);

  const exportCsv = useCallback(() => {
    apiRef.current?.exportDataAsCsv({
      fileName: `supplora-payables-${today}.csv`,
      skipColumnGroupHeaders: true,
      processCellCallback: (params) => {
        const colId = params.column.getColId();
        const v = params.value;
        if (colId.endsWith("Cents")) return typeof v === "number" ? (v / 100).toFixed(2) : "";
        if (colId === "status") {
          const d = params.node?.data as PayableRow | undefined;
          return d ? STATUS_LABEL[d.status] : "";
        }
        return v ?? "";
      },
    });
  }, [today]);

  const pinnedBottom = useMemo(() => (totals ? [totals as unknown as PayableRow] : []), [totals]);

  return (
    <div className="space-y-3">
      {/* Toolbar: search · group-by · export */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <input
            type="search"
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
            placeholder="Search suppliers, invoices, findings, PayPal ids…"
            aria-label="Search the payables grid"
            className="h-9 w-full rounded-full border border-line-2 bg-card pl-9 pr-3 text-sm text-ink placeholder:text-muted focus:border-ledger-2 focus:outline-none"
          />
          <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
        </div>

        <div className="inline-flex items-center rounded-full border border-line bg-paper p-0.5 text-xs">
          <span className="px-2 text-muted">Group</span>
          {(["status", "supplier", "none"] as GroupKey[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => onChangeGroup(k)}
              aria-pressed={groupBy === k}
              className={cx("rounded-full px-2.5 py-1 font-medium capitalize transition", groupBy === k ? "bg-ink text-paper" : "text-ink-2 hover:text-ink")}
            >
              {k === "none" ? "Flat" : k}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={exportCsv}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-line-2 bg-card px-3.5 text-sm font-medium text-ink transition-colors hover:border-ink-2/50 hover:bg-paper"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
          </svg>
          Export CSV
        </button>
      </div>

      {/* Status chips: AG Grid external filter */}
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by status">
        <button
          type="button"
          onClick={clearStatus}
          aria-pressed={active.size === 0}
          className={cx("rounded-full border px-3 py-1 text-xs font-medium transition", active.size === 0 ? "border-ink bg-ink text-paper" : "border-line bg-card text-ink-2 hover:border-line-2")}
        >
          All <span className="num opacity-70">{rows.length}</span>
        </button>
        {presentStatuses.map((s) => {
          const n = rows.filter((r) => r.status === s).length;
          const on = active.has(s);
          return (
            <button
              key={s}
              type="button"
              onClick={() => toggleStatus(s)}
              aria-pressed={on}
              className={cx("rounded-full border px-3 py-1 text-xs font-medium transition", on ? STATUS_PILL[s] : "border-line bg-card text-ink-2 hover:border-line-2")}
            >
              {STATUS_LABEL[s]} <span className="num opacity-70">{n}</span>
            </button>
          );
        })}
      </div>

      {/* Group subtotal strip (live, filter-aware) */}
      {groupBy !== "none" && groups.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted">{groupBy === "status" ? "By status:" : "By supplier:"}</span>
          {groups.map((g) => (
            <span key={g.key} className={cx("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-medium", g.tone)}>
              <span className="capitalize">{g.label}</span>
              <span className="opacity-70">{g.count}</span>
              <span className="num opacity-70">· {fmt(g.cents)}</span>
            </span>
          ))}
        </div>
      )}

      <div style={{ height: 560, width: "100%" }}>
        <AgGridReact<PayableRow>
          theme={supploraTheme}
          rowData={rows}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          getRowId={(p) => p.data.id}
          quickFilterText={quick}
          onGridReady={onGridReady}
          onFilterChanged={recompute}
          onFirstDataRendered={recompute}
          onRowDataUpdated={recompute}
          isExternalFilterPresent={isExternalFilterPresent}
          doesExternalFilterPass={doesExternalFilterPass}
          pinnedBottomRowData={pinnedBottom}
          animateRows
          suppressCellFocus
          rowHeight={52}
          headerHeight={42}
          overlayNoRowsTemplate="No invoices match the current filters."
        />
      </div>

      <p className="text-xs text-muted">
        {rows.length} reviewed invoice{rows.length === 1 ? "" : "s"}. Click a supplier or invoice to open the full review. Sort any column, filter in the header
        row, search, slice by status, or group — the totals row stays in sync with what is on screen.
      </p>
    </div>
  );
}
