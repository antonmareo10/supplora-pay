"use client";

// Payables dashboard: AG Charts + AG Grid (both Community), cross-filtered.
//
// Why a grid: /ledger is where the restaurant owner answers "what do I owe, what did we hold,
// and why". A static table can't sort by due date, filter to the held invoices, search a
// supplier or total the column that is currently in view.
//
// What is custom here (all Community, no Enterprise modules, no watermark):
//  - theme: Quartz re-skinned to the app's palette (ag-theme.ts), incl. change-flash colour;
//  - layout: column groups (Amounts / Why / PayPal), supplier pinned left for narrow screens, a
//    flexible, wrapping "Top finding" column and two-line rows so the grid fits a laptop screen
//    without cutting text, a filter-aware pinned totals row, a live subtotal strip, chart above;
//  - widgets: status pills, severity dots, a findings tooltip with the evidence behind every
//    flag, an in-cell bar on withheld amounts, due dates with relative labels, PayPal id cells;
//  - cross-filtering: status chips and a click on a supplier's bar in the chart are AG Grid
//    external filters; the chart is recomputed from the rows that pass the grid's filters
//    (quick search, column filters, chips), so chart, grid and totals always agree.
// Native row grouping/aggregation and integrated charts are Enterprise features, so the
// grouping strip and the chart are built on the Community APIs instead.

import Link from "next/link";
import { AgCharts } from "ag-charts-react";
import { AllCommunityModule as ChartsCommunityModule, ModuleRegistry as ChartsModuleRegistry, type AgCartesianChartOptions } from "ag-charts-community";
import {
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

// Room for a two-line supplier name or finding (long ones are clamped; the tooltip has them all).
// Set on the theme, not the grid, so plain text cells stay vertically centred too.
const payablesTheme = supploraTheme.withParams({ rowHeight: 64 });

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
  maxWithheld: number;
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
      <span className="line-clamp-2 whitespace-normal font-medium text-ink group-hover:text-ledger" title={row.supplier}>
        {row.supplier}
      </span>
      <span className="mt-0.5 text-[11px] text-muted">
        <span className="capitalize">{row.category}</span> · <span className="font-mono tracking-tight">{row.invoiceNumber}</span>
      </span>
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
    <span className="flex h-full flex-col items-start justify-center gap-0.5 leading-tight">
      <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium", STATUS_PILL[s])}>{STATUS_LABEL[s]}</span>
      {p.data.ownerDecision && <span className="text-[10.5px] text-muted">owner changed it to {p.data.recommendationLabel.toLowerCase()}</span>}
    </span>
  );
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
    <span className="flex h-full items-center gap-2 leading-snug">
      <span className={cx("h-1.5 w-1.5 shrink-0 rounded-full", sev ? SEVERITY_DOT[sev] : "bg-line-2")} aria-hidden />
      <span className="line-clamp-3 min-w-0 whitespace-normal text-ink-2">{p.data.finding}</span>
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
    const done = p.data.status === "paid" ? "paid" : p.data.status === "sent" ? "awaiting claim" : null;
    const overdue = rel.includes("overdue");
    const soon = rel === "due today" || rel === "due tomorrow";
    return (
      <span className="flex h-full flex-col justify-center leading-tight">
        <span className="num text-ink-2">{p.valueFormatted}</span>
        <span className={cx("text-[11px]", done ? "text-muted" : overdue ? "text-terracotta" : soon ? "text-saffron" : "text-muted")}>{done ?? rel}</span>
      </span>
    );
  };
}

/** In-cell bar: what this invoice holds back (withheld lines or the whole held invoice), relative to the largest in the grid. */
function WithheldCell(p: ICellRendererParams<PayableRow, number, GridContext>) {
  const v = p.value ?? 0;
  if (p.node.rowPinned) return <span className="num font-semibold text-terracotta">{v ? fmt(v) : "—"}</span>;
  if (!v) return <span className="text-muted">—</span>;
  const pct = Math.max(6, Math.round((v / Math.max(1, p.context?.maxWithheld ?? v)) * 100));
  return (
    <span className="flex h-full flex-col items-end justify-center gap-1 leading-tight">
      <span className="num font-medium text-terracotta">{fmt(v)}</span>
      <span className="h-1 w-16 overflow-hidden rounded-full bg-terracotta-soft" aria-hidden>
        <span className="block h-full rounded-full bg-terracotta/70" style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

/** Sent through PayPal, with the early-payment discount it captured (if any). */
function SentCell(p: ICellRendererParams<PayableRow, number>) {
  const v = p.value;
  const discount = p.data?.discountCents ?? 0;
  if (!v) return <span className="text-muted">—</span>;
  return (
    <span className="flex h-full flex-col items-end justify-center leading-tight">
      <span className={cx("num", p.node.rowPinned ? "font-semibold text-ink" : "font-medium text-ink")}>{fmt(v)}</span>
      {discount > 0 && <span className="num text-[11px] text-olive">−{fmt(discount)} discount</span>}
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
  ["paid", "Sent via PayPal", PALETTE.olive2],
  ["toPay", "To pay / in flight", PALETTE.ledger2],
  ["withheld", "Withheld (until credit note)", PALETTE.saffron],
  ["held", "Held (not paid)", PALETTE.terracotta],
] as const;

type SeriesKey = (typeof SERIES)[number][0];

/**
 * Narrow screens: a short label that fits the axis (full name in the tooltip), so names are never
 * clipped at the chart's edge: no legal form, whole words up to 14 characters.
 */
function shortSupplier(name: string): string {
  const base = name.replace(/,?\s+(S\.L\.|S\.A\.|Ltd\.?|Co\.?|Inc\.?)$/i, "");
  if (base.length <= 14) return base;
  let out = "";
  for (const word of base.split(/\s+/)) {
    const next = out ? `${out} ${word}` : word;
    if (next.length > 14) break;
    out = next;
  }
  out = out.replace(/\s+(de|del|la|y|&|and|of)$/i, "");
  return out || `${base.slice(0, 13)}…`;
}

function moneyChartOptions(
  data: SupplierMoney[],
  selected: string | null,
  onPick: (supplier: string) => void,
  hidden: Set<SeriesKey>,
  narrow: boolean,
): AgCartesianChartOptions {
  return {
    data,
    series: SERIES.map(([yKey, yName, fill]) => ({
      visible: !hidden.has(yKey),
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
      x: {
        type: "category",
        position: "left",
        label: {
          fontSize: narrow ? 11 : 12,
          color: PALETTE.ink2,
          truncate: true,
          formatter: ({ value }: { value: string }) => (narrow ? shortSupplier(String(value)) : String(value)),
        },
      },
      y: { type: "number", position: "bottom", label: { formatter: ({ value }: { value: number }) => eurAxis(value), color: PALETTE.muted, fontSize: 11 } },
    },
    // The legend is HTML below the chart: it wraps on a phone instead of paginating, and leaves no
    // off-screen focus targets that widen the page.
    legend: { enabled: false },
    background: { fill: PALETTE.card },
    padding: { top: 8, right: narrow ? 10 : 16, bottom: 4, left: 4 },
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
  const [hiddenSeries, setHiddenSeries] = useState<Set<SeriesKey>>(new Set());
  const rootRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < 640));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const presentStatuses = useMemo(() => {
    const seen = new Set(rows.map((r) => r.status));
    return STATUS_ORDER.filter((s) => seen.has(s));
  }, [rows]);

  const context = useMemo<GridContext>(() => ({ maxWithheld: Math.max(0, ...rows.map((r) => r.withheldCents)) }), [rows]);
  // The PayPal ids column only earns its width once something has been sent.
  const anySent = useMemo(() => rows.some((r) => r.paypalBatchId), [rows]);

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
        headerName: "Supplier · invoice",
        cellRenderer: SupplierCell,
        pinned: "left",
        lockPinned: true,
        width: narrow ? 150 : 188,
        // Search and filter by supplier, category or invoice number.
        getQuickFilterText: (p) => (p.data ? `${p.data.supplier} ${p.data.category} ${p.data.invoiceNumber}` : ""),
        filterValueGetter: (p: ValueGetterParams<PayableRow>) => (p.data ? `${p.data.supplier} ${p.data.invoiceNumber}` : ""),
        filter: "agTextColumnFilter",
      },
      {
        field: "status",
        headerName: "Status",
        cellRenderer: StatusCell,
        width: 132,
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
          { field: "invoiceCents", headerName: "Invoiced", type: "rightAligned", cellClass: "num", width: 100, valueFormatter: moneyFmt, filter: "agNumberColumnFilter", filterValueGetter: euros("invoiceCents") },
          {
            field: "withheldCents",
            headerName: "Withheld",
            headerTooltip: "Withheld until the supplier sends a credit note, or the whole invoice when it is held (e.g. a duplicate)",
            type: "rightAligned",
            cellRenderer: WithheldCell,
            width: 112,
            valueFormatter: moneyOrDash,
            filter: "agNumberColumnFilter",
            filterValueGetter: euros("withheldCents"),
          },
          {
            field: "paidCents",
            headerName: "Sent",
            headerTooltip: "Sent through PayPal Payouts: claimed by the supplier, or awaiting their claim. Includes any early-payment discount taken.",
            type: "rightAligned",
            cellRenderer: SentCell,
            width: 108,
            enableCellChangeFlash: true,
            valueFormatter: moneyOrDash,
            filter: "agNumberColumnFilter",
            filterValueGetter: euros("paidCents"),
          },
          // Shown inside the Sent cell; kept as a column for the CSV export and search.
          { field: "discountCents", headerName: "Discount", hide: true, valueFormatter: moneyOrDash },
        ],
      },
      {
        headerName: "Why",
        marryChildren: true,
        children: [
          {
            field: "finding",
            headerName: "Top finding",
            headerTooltip: "Hover a finding for the evidence behind it",
            cellRenderer: FindingCell,
            tooltipField: "finding",
            tooltipComponent: FindingsTooltip,
            flex: 1,
            minWidth: 200,
            filter: "agTextColumnFilter",
          },
          // The status pill already shows the outcome; kept for the CSV export and search.
          { field: "recommendationLabel", headerName: "Claude + rules", cellRenderer: RecommendationCell, width: 150, hide: true, filter: "agTextColumnFilter" },
          {
            field: "dueDate",
            headerName: "Due",
            cellRenderer: dueCell,
            valueFormatter: dueFmt,
            width: 100,
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
        headerName: "PayPal",
        children: [
          // Shown under the supplier name; kept as a column for the CSV export.
          { field: "invoiceNumber", headerName: "Invoice no.", cellRenderer: InvoiceCell, width: 136, hide: true, filter: "agTextColumnFilter" },
          {
            headerName: "Payout batch · item",
            colId: "paypal",
            cellRenderer: PaypalCell,
            enableCellChangeFlash: true,
            valueGetter: (p: ValueGetterParams<PayableRow>) => (p.data ? [p.data.paypalBatchId, p.data.paypalItemId].filter(Boolean).join(" ") : ""),
            width: 136,
            hide: !anySent,
            filter: "agTextColumnFilter",
          },
        ],
      },
    ];
  }, [today, narrow, anySent]);

  const defaultColDef = useMemo<ColDef<PayableRow>>(() => ({ sortable: true, resizable: true, filter: true, floatingFilter: true }), []);

  // Recompute the totals row, the subtotal strip and the chart from the rows that currently
  // pass every filter (quick search + column filters + status chips + chart selection).
  const recompute = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    const groupBy = groupRef.current;
    const t = { count: 0, invoice: 0, withheld: 0, discount: 0, paid: 0 };
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
    setTotals({ __total: true, id: "__totals__", supplier: "Totals", count: t.count, invoiceCents: t.invoice, withheldCents: t.withheld, discountCents: t.discount, paidCents: t.paid });
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
      allColumns: true,
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
  const chartOptions = useMemo(() => moneyChartOptions(chartData, supplier, pickSupplier, hiddenSeries, narrow), [chartData, supplier, pickSupplier, hiddenSeries, narrow]);
  const toggleSeries = useCallback(
    (key: SeriesKey) =>
      setHiddenSeries((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }),
    [],
  );
  const filtered = active.size > 0 || supplier !== null || quick.trim() !== "";

  return (
    <div ref={rootRef} className="min-w-0 space-y-4">
      {/* Chart: where each supplier's euros stand. Click a bar to filter the grid. */}
      <div className="overflow-hidden rounded-xl border border-line bg-card">
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
        <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 border-t border-line px-3 py-2.5 text-xs text-ink-2" aria-label="Chart legend: click to show or hide a series">
          {SERIES.map(([key, label, fill]) => {
            const off = hiddenSeries.has(key);
            return (
              <li key={key}>
                <button type="button" onClick={() => toggleSeries(key)} aria-pressed={!off} className={cx("inline-flex items-center gap-1.5 rounded transition hover:text-ink", off && "opacity-45 line-through")}>
                  <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: fill }} aria-hidden />
                  {label}
                </button>
              </li>
            );
          })}
        </ul>
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

      <div className="w-full">
        <AgGridReact<PayableRow>
          domLayout="autoHeight"
          includeHiddenColumnsInQuickFilter
          theme={payablesTheme}
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
