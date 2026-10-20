"use client";

// Payables dashboard: AG Charts + AG Grid (both Community), cross-filtered.
//
// Why a grid: /ledger is where the restaurant owner answers "what do I owe, what did we hold,
// and why". A static table can't sort by due date, filter to the held invoices, search a
// supplier or total the column that is currently in view.
//
// What is custom here (all Community, no Enterprise modules, no watermark):
//  - theme: Quartz re-skinned to the app's palette (ag-theme.ts), incl. change-flash colour;
//  - layout: column groups (Invoice / Amounts / PayPal), supplier pinned left for narrow screens,
//    a filter-aware pinned totals row, a live subtotal strip, chart above the grid;
//  - widgets: status pills, severity dots, a findings tooltip with the evidence behind every
//    flag, an in-cell "saved" bar, due dates with relative labels, PayPal id cells;
//  - cross-filtering: status chips and a click on a supplier's bar in the chart are AG Grid
//    external filters; the chart is recomputed from the rows that pass the grid's filters
//    (quick search, column filters, chips), so chart, grid and totals always agree.
// Native row grouping/aggregation and integrated charts are Enterprise features, so the
// grouping strip and the chart are built on the Community APIs instead.

import Link from "next/link";
import { AgCharts } from "ag-charts-react";
import { AllCommunityModule as ChartsCommunityModule, ModuleRegistry as ChartsModuleRegistry, type AgCartesianChartOptions } from "ag-charts-community";
import {
  type CellClassRules,
  type ColDef,
  type ColGroupDef,
  type GridApi,
  type GridReadyEvent,
  type ICellRendererParams,
  type IRowNode,
  type ITooltipParams,
  type ValueFormatterParams,
  type ValueGetterParams,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cx } from "@/components/ui";
import { relativeDue } from "@/lib/dates";
import { fmt } from "@/lib/money";
import { STATUS_LABEL, STATUS_ORDER, type PayableStatus } from "@/lib/payables-status";
import type { PayableRow } from "@/lib/payables-view";
import { PALETTE, SEVERITY_DOT, STATUS_PILL, supploraTheme } from "./ag-theme";

ChartsModuleRegistry.registerModules([ChartsCommunityModule]);

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

/** One bar in the chart: where a supplier's invoiced euros stand. */
interface SupplierMoney {
  supplier: string;
  paid: number;
  toPay: number;
  withheld: number;
  held: number;
}

interface GridContext {
  maxSaved: number;
}

// --- cell renderers & widgets ----------------------------------------------

function SupplierCell(p: ICellRendererParams<PayableRow>) {
  if (p.node.rowPinned) {
    const t = p.data as unknown as TotalsRow;
    return (
      <span className="font-semibold text-ink">
        Totals <span className="font-normal text-muted">· {t.count} in view</span>
      </span>
    );
  }
  const row = p.data;
  if (!row) return null;
  return (
    <Link href={`/inbox/${row.id}`} className="group flex h-full flex-col justify-center leading-tight">
      <span className="truncate font-medium text-ink group-hover:text-ledger">{row.supplier}</span>
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
  return <span className={cx("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium", STATUS_PILL[s])}>{STATUS_LABEL[s]}</span>;
}

function RecommendationCell(p: ICellRendererParams<PayableRow>) {
  if (p.node.rowPinned || !p.data) return null;
  const tone = p.data.recommendation === "hold" ? "text-terracotta" : p.data.recommendation === "pay_partial" ? "text-[#8a5a0c]" : "text-olive";
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
    <span className="flex h-full items-center gap-2 leading-tight">
      <span className={cx("h-1.5 w-1.5 shrink-0 rounded-full", sev ? SEVERITY_DOT[sev] : "bg-line-2")} aria-hidden />
      <span className="truncate text-ink-2">{p.data.finding}</span>
      {p.data.findingCount > 1 && <span className="shrink-0 rounded-full bg-paper-2 px-1.5 text-[11px] text-muted">+{p.data.findingCount - 1}</span>}
    </span>
  );
}

/** Tooltip widget: every finding behind the recommendation, with its evidence and the money at stake. */
function FindingsTooltip(p: ITooltipParams<PayableRow>) {
  const row = p.data;
  if (!row || p.node?.rowPinned) return null;
  return (
    <div className="max-w-[360px] rounded-xl border border-line bg-card p-3 text-[12.5px] leading-snug shadow-[0_12px_32px_-12px_rgba(40,30,10,0.35)]">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
        {row.supplier} · {row.invoiceNumber}
      </p>
      {row.findings.length === 0 ? (
        <p className="text-ink-2">No issues: matches the delivery note and price history.</p>
      ) : (
        <ul className="space-y-2">
          {row.findings.map((f, i) => {
            // Observations read off the document use a shortened detail as their title: show it once.
            const repeated = f.detail.startsWith(f.title.replace(/(…|\.{3})$/, ""));
            return (
              <li key={i} className="flex gap-2">
                <span className={cx("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", SEVERITY_DOT[f.severity])} aria-hidden />
                <span>
                  <span className="font-medium text-ink">{repeated ? f.detail : f.title}</span>
                  {f.withholdCents > 0 && <span className="num ml-1.5 text-terracotta">withhold {fmt(f.withholdCents)}</span>}
                  {f.withholdCents === 0 && f.impactCents > 0 && <span className="num ml-1.5 text-olive">{fmt(f.impactCents)}</span>}
                  {!repeated && <span className="block text-ink-2">{f.detail}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function makeDueCell(today: string) {
  return function DueCell(p: ICellRendererParams<PayableRow>) {
    if (p.node.rowPinned || !p.data) return null;
    const due = p.data.dueDate;
    if (!due) return <span className="text-muted">—</span>;
    const rel = relativeDue(today, due);
    const settled = p.data.status === "paid" || p.data.status === "sent";
    const overdue = rel.includes("overdue");
    const soon = rel === "due today" || rel === "due tomorrow";
    return (
      <span className="flex h-full flex-col justify-center leading-tight">
        <span className="num text-ink-2">{p.valueFormatted}</span>
        <span className={cx("text-[11px]", settled ? "text-muted" : overdue ? "text-terracotta" : soon ? "text-saffron" : "text-muted")}>{settled ? "settled" : rel}</span>
      </span>
    );
  };
}

/** In-cell bar: how much this invoice saved, relative to the best one in the grid. */
function SavedCell(p: ICellRendererParams<PayableRow, number, GridContext>) {
  const v = p.value ?? 0;
  if (p.node.rowPinned) return <span className="num font-semibold text-olive">{v ? fmt(v) : "—"}</span>;
  if (!v) return <span className="text-muted">—</span>;
  const pct = Math.max(6, Math.round((v / Math.max(1, p.context?.maxSaved ?? v)) * 100));
  return (
    <span className="flex h-full flex-col items-end justify-center gap-1">
      <span className="num font-medium text-olive">{fmt(v)}</span>
      <span className="h-1 w-16 overflow-hidden rounded-full bg-olive-soft" aria-hidden>
        <span className="block h-full rounded-full bg-olive-2" style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

function PaypalCell(p: ICellRendererParams<PayableRow>) {
  if (p.node.rowPinned || !p.data) return null;
  if (!p.data.paypalBatchId) return <span className="text-muted">—</span>;
  return (
    <span className="flex h-full flex-col justify-center leading-tight">
      <code className="font-mono text-[12px] tracking-tight text-ink-2">{p.data.paypalBatchId}</code>
      {p.data.paypalItemId && <code className="font-mono text-[11px] tracking-tight text-muted">{p.data.paypalItemId}</code>}
    </span>
  );
}

// --- chart -------------------------------------------------------------------

const eurAxis = (v: number) => (v >= 1000 ? `€${(v / 1000).toFixed(1)}k` : `€${Math.round(v)}`);
const SERIES = [
  ["paid", "Paid via PayPal", PALETTE.olive2],
  ["toPay", "To pay / in flight", PALETTE.ledger2],
  ["withheld", "Withheld (credit note asked)", PALETTE.saffron],
  ["held", "Held (not paid)", PALETTE.terracotta],
] as const;

function moneyChartOptions(data: SupplierMoney[], selected: string | null, onPick: (supplier: string) => void): AgCartesianChartOptions {
  return {
    data,
    series: SERIES.map(([yKey, yName, fill]) => ({
      type: "bar",
      direction: "horizontal",
      xKey: "supplier",
      yKey,
      yName,
      stacked: true,
      fill,
      strokeWidth: 0,
      cornerRadius: 3,
      itemStyler: ({ datum }: { datum: SupplierMoney }) => ({ fillOpacity: selected && datum.supplier !== selected ? 0.28 : 1 }),
      tooltip: {
        renderer: ({ datum }: { datum: SupplierMoney }) => ({
          heading: datum.supplier,
          title: yName,
          data: [{ label: "Amount", value: fmt(Math.round((datum[yKey] as number) * 100)) }],
        }),
      },
    })),
    axes: {
      x: { type: "category", position: "left", label: { fontSize: 12, color: PALETTE.ink2 } },
      y: { type: "number", position: "bottom", label: { formatter: ({ value }: { value: number }) => eurAxis(value), color: PALETTE.muted, fontSize: 11 } },
    },
    legend: { position: "bottom", item: { label: { color: PALETTE.ink2, fontSize: 12 } } },
    background: { fill: PALETTE.card },
    padding: { top: 8, right: 16, bottom: 4, left: 4 },
    theme: { params: { fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif", foregroundColor: PALETTE.ink, textColor: PALETTE.ink2 } },
    listeners: { seriesNodeClick: (e: { datum: unknown }) => onPick((e.datum as SupplierMoney).supplier) },
  } as unknown as AgCartesianChartOptions;
}

// --- dashboard ---------------------------------------------------------------

export default function PayablesGrid({ rows, today }: { rows: PayableRow[]; today: string }) {
  const apiRef = useRef<GridApi<PayableRow> | null>(null);
  const [quick, setQuick] = useState("");
  const [groupBy, setGroupBy] = useState<GroupKey>("status");
  // Read by recompute(), which AG Grid calls from its own events: a ref never goes stale.
  const groupRef = useRef<GroupKey>("status");
  const [active, setActive] = useState<Set<PayableStatus>>(new Set());
  const activeRef = useRef(active);
  const [supplier, setSupplier] = useState<string | null>(null);
  const supplierRef = useRef<string | null>(null);
  const [totals, setTotals] = useState<TotalsRow | null>(null);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [chartData, setChartData] = useState<SupplierMoney[]>([]);

  const presentStatuses = useMemo(() => {
    const seen = new Set(rows.map((r) => r.status));
    return STATUS_ORDER.filter((s) => seen.has(s));
  }, [rows]);

  const context = useMemo<GridContext>(() => ({ maxSaved: Math.max(0, ...rows.map((r) => r.savedCents)) }), [rows]);

  const columnDefs = useMemo<(ColDef<PayableRow> | ColGroupDef<PayableRow>)[]>(() => {
    const dueCell = makeDueCell(today);
    const moneyFmt = (p: ValueFormatterParams<PayableRow, number>) => fmt(p.value ?? 0);
    const moneyOrDash = (p: ValueFormatterParams<PayableRow, number>) => (p.value ? fmt(p.value) : "—");
    const dueFmt = (p: ValueFormatterParams<PayableRow, string>) =>
      p.value ? new Date(`${p.value}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "—";
    // Number filters work in euros, like the owner thinks, while the data stays in cents.
    const euros = (key: "invoiceCents" | "withheldCents" | "paidCents") => (p: ValueGetterParams<PayableRow>) => (p.data?.[key] != null ? (p.data[key] as number) / 100 : null);
    return [
      {
        field: "supplier",
        headerName: "Supplier",
        cellRenderer: SupplierCell,
        pinned: "left",
        lockPinned: true,
        width: 200,
        filter: "agTextColumnFilter",
      },
      {
        field: "status",
        headerName: "Status",
        cellRenderer: StatusCell,
        width: 164,
        enableCellChangeFlash: true,
        comparator: (a: PayableStatus, b: PayableStatus) => STATUS_ORDER.indexOf(a) - STATUS_ORDER.indexOf(b),
        filterValueGetter: (p: ValueGetterParams<PayableRow>) => (p.data ? STATUS_LABEL[p.data.status] : ""),
        filter: "agTextColumnFilter",
      },
      {
        // Money first: it is what the owner reads the ledger for.
        headerName: "Amounts (EUR, VAT incl.)",
        marryChildren: true,
        children: [
          { field: "invoiceCents", headerName: "Invoiced", type: "rightAligned", cellClass: "num", width: 110, valueFormatter: moneyFmt, filter: "agNumberColumnFilter", filterValueGetter: euros("invoiceCents") },
          {
            field: "withheldCents",
            headerName: "Withheld",
            type: "rightAligned",
            cellClass: "num",
            cellClassRules: { "text-terracotta": (p) => (p.value as number) > 0 } as CellClassRules<PayableRow>,
            width: 106,
            valueFormatter: moneyOrDash,
            filter: "agNumberColumnFilter",
            filterValueGetter: euros("withheldCents"),
          },
          {
            field: "paidCents",
            headerName: "Paid",
            type: "rightAligned",
            cellClass: "num font-medium",
            width: 110,
            enableCellChangeFlash: true,
            valueFormatter: moneyOrDash,
            filter: "agNumberColumnFilter",
            filterValueGetter: euros("paidCents"),
          },
          { field: "savedCents", headerName: "Saved", type: "rightAligned", cellRenderer: SavedCell, width: 108 },
          {
            field: "discountCents",
            headerName: "Discount",
            type: "rightAligned",
            cellClass: "num",
            cellClassRules: { "text-olive": (p) => (p.value as number) > 0 } as CellClassRules<PayableRow>,
            width: 100,
            valueFormatter: moneyOrDash,
          },
        ],
      },
      {
        headerName: "Why",
        marryChildren: true,
        children: [
          {
            field: "finding",
            headerName: "Top finding · hover for evidence",
            cellRenderer: FindingCell,
            tooltipField: "finding",
            tooltipComponent: FindingsTooltip,
            width: 260,
            filter: "agTextColumnFilter",
          },
          { field: "recommendationLabel", headerName: "Claude + rules", cellRenderer: RecommendationCell, width: 150, filter: "agTextColumnFilter" },
          {
            field: "dueDate",
            headerName: "Due",
            cellRenderer: dueCell,
            valueFormatter: dueFmt,
            width: 116,
            // The date picker does not fit a floating filter this narrow; the header menu has it.
            floatingFilter: false,
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
        ],
      },
      {
        headerName: "Document · PayPal",
        children: [
          { field: "invoiceNumber", headerName: "Invoice no.", cellRenderer: InvoiceCell, width: 136, filter: "agTextColumnFilter" },
          {
            headerName: "Payout batch · item",
            colId: "paypal",
            cellRenderer: PaypalCell,
            enableCellChangeFlash: true,
            valueGetter: (p: ValueGetterParams<PayableRow>) => (p.data ? [p.data.paypalBatchId, p.data.paypalItemId].filter(Boolean).join(" ") : ""),
            width: 176,
            filter: "agTextColumnFilter",
          },
        ],
      },
    ];
  }, [today]);

  const defaultColDef = useMemo<ColDef<PayableRow>>(() => ({ sortable: true, resizable: true, filter: true, floatingFilter: true }), []);

  // Recompute the totals row, the subtotal strip and the chart from the rows that currently
  // pass every filter (quick search + column filters + status chips + chart selection).
  const recompute = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    const groupBy = groupRef.current;
    const t = { count: 0, invoice: 0, withheld: 0, discount: 0, paid: 0, saved: 0 };
    const map = new Map<string, GroupSummary>();
    const money = new Map<string, SupplierMoney>();
    api.forEachNodeAfterFilter((node: IRowNode<PayableRow>) => {
      const d = node.data;
      if (!d) return;
      t.count++;
      t.invoice += d.invoiceCents;
      t.withheld += d.withheldCents;
      t.discount += d.discountCents;
      t.paid += d.paidCents ?? 0;
      t.saved += d.savedCents;
      if (groupBy !== "none") {
        const key = groupBy === "supplier" ? d.supplier : d.status;
        const g = map.get(key) ?? {
          key,
          label: groupBy === "supplier" ? d.supplier : STATUS_LABEL[d.status],
          tone: groupBy === "supplier" ? "border-line bg-paper text-ink-2" : STATUS_PILL[d.status],
          count: 0,
          cents: 0,
        };
        g.count++;
        g.cents += d.invoiceCents;
        map.set(key, g);
      }
      const m = money.get(d.supplier) ?? { supplier: d.supplier, paid: 0, toPay: 0, withheld: 0, held: 0 };
      if (d.status === "held") m.held += d.invoiceCents / 100;
      else {
        const paid = d.paidCents ?? 0;
        m.paid += paid / 100;
        m.withheld += d.withheldCents / 100;
        if (d.status !== "paid" && d.status !== "sent") m.toPay += Math.max(0, d.invoiceCents - d.withheldCents - paid) / 100;
      }
      money.set(d.supplier, m);
    });
    setTotals({ __total: true, id: "__totals__", supplier: "Totals", count: t.count, invoiceCents: t.invoice, withheldCents: t.withheld, discountCents: t.discount, paidCents: t.paid, savedCents: t.saved });
    const list = [...map.values()];
    setGroups(groupBy === "status" ? list.sort((a, b) => STATUS_ORDER.indexOf(a.key as PayableStatus) - STATUS_ORDER.indexOf(b.key as PayableStatus)) : list.sort((a, b) => b.cents - a.cents));
    const size = (m: SupplierMoney) => m.paid + m.toPay + m.withheld + m.held;
    setChartData([...money.values()].sort((a, b) => size(b) - size(a)));
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
    const next = new Set(activeRef.current);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    activeRef.current = next;
    setActive(next);
    apiRef.current?.onFilterChanged();
  }, []);

  // The chart only sets state (it is configured during render); the effect below applies it to the grid.
  const pickSupplier = useCallback((name: string | null) => setSupplier((prev) => (name && prev === name ? null : name)), []);
  useEffect(() => {
    supplierRef.current = supplier;
    apiRef.current?.onFilterChanged();
  }, [supplier]);

  const clearAll = useCallback(() => {
    activeRef.current = new Set();
    setActive(new Set());
    setSupplier(null);
    setQuick("");
    apiRef.current?.setFilterModel(null);
    apiRef.current?.onFilterChanged();
  }, []);

  const isExternalFilterPresent = useCallback(() => activeRef.current.size > 0 || supplierRef.current !== null, []);
  const doesExternalFilterPass = useCallback((node: IRowNode<PayableRow>) => {
    const d = node.data;
    if (!d) return true;
    if (activeRef.current.size > 0 && !activeRef.current.has(d.status)) return false;
    if (supplierRef.current !== null && d.supplier !== supplierRef.current) return false;
    return true;
  }, []);

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
  const chartOptions = useMemo(() => moneyChartOptions(chartData, supplier, pickSupplier), [chartData, supplier, pickSupplier]);
  const filtered = active.size > 0 || supplier !== null || quick.trim() !== "";

  return (
    <div className="space-y-4">
      {/* Chart: where each supplier's euros stand. Click a bar to filter the grid. */}
      <div className="rounded-xl border border-line bg-card">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-3">
          <p className="text-sm font-medium text-ink">Where the money stands, by supplier</p>
          <p className="text-xs text-muted">{supplier ? `Showing ${supplier} · click its bar again to clear` : "Click a bar to filter the grid · follows every grid filter"}</p>
        </div>
        <div className="h-[260px] w-full px-1 pb-1">
          {chartData.length > 0 ? (
            <AgCharts options={chartOptions} style={{ height: "100%", width: "100%" }} />
          ) : (
            <p className="grid h-full place-items-center text-sm text-muted">No invoices match the current filters.</p>
          )}
        </div>
      </div>

      {/* Toolbar: search · group-by · export */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
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

        <div className="inline-flex items-center rounded-full border border-line bg-paper p-0.5 text-xs" role="group" aria-label="Group the subtotal strip">
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
          onClick={clearAll}
          aria-pressed={!filtered}
          className={cx("rounded-full border px-3 py-1 text-xs font-medium transition", !filtered ? "border-ink bg-ink text-paper" : "border-line bg-card text-ink-2 hover:border-line-2")}
        >
          {filtered ? "Clear filters" : "All"} <span className="num opacity-70">{rows.length}</span>
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
        {supplier && (
          <button type="button" onClick={() => pickSupplier(null)} className="rounded-full border border-ledger/30 bg-ledger-soft px-3 py-1 text-xs font-medium text-ledger">
            Supplier: {supplier} <span aria-hidden>×</span>
            <span className="sr-only">clear supplier filter</span>
          </button>
        )}
      </div>

      {/* Group subtotal strip (live, filter-aware) */}
      {groupBy !== "none" && groups.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted">{groupBy === "status" ? "By status:" : "By supplier:"}</span>
          {groups.map((g) => (
            <span key={g.key} className={cx("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-medium", g.tone)}>
              <span>{g.label}</span>
              <span className="opacity-70">{g.count}</span>
              <span className="num opacity-70">· {fmt(g.cents)}</span>
            </span>
          ))}
        </div>
      )}

      <div style={{ height: 520, width: "100%" }}>
        <AgGridReact<PayableRow>
          theme={supploraTheme}
          rowData={rows}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          context={context}
          getRowId={(p) => p.data.id}
          quickFilterText={quick}
          onGridReady={onGridReady}
          onFilterChanged={recompute}
          onFirstDataRendered={recompute}
          onRowDataUpdated={recompute}
          isExternalFilterPresent={isExternalFilterPresent}
          doesExternalFilterPass={doesExternalFilterPass}
          pinnedBottomRowData={pinnedBottom}
          tooltipShowDelay={200}
          tooltipHideDelay={12000}
          animateRows
          suppressCellFocus
          groupHeaderHeight={34}
          overlayNoRowsTemplate="No invoices match the current filters."
        />
      </div>

      <p className="text-xs text-muted">
        {rows.length} reviewed invoice{rows.length === 1 ? "" : "s"}. Hover a finding for the evidence behind it; click a supplier or invoice for the full review. Every filter
        (search, header filters, chips, chart) drives the totals row, the subtotal strip and the chart.
      </p>
    </div>
  );
}
