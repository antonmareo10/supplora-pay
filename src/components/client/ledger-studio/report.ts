// The built-in "Accounts payable" report: four pages an owner would actually open, as AG Studio
// report state. Field ids ('invoices.toPay') refer to the tables in ./data.ts.

import type { AgPageState, AgReportState, AgWidgetLayoutState } from "ag-studio";
import type { LedgerRegistry } from "./widgets/types";

/** Bump when the default report changes, so a saved copy of the old one is not restored over it. */
export const REPORT_VERSION = 7;

export const PAGES = [
  { id: "owe", title: "What we owe" },
  { id: "why", title: "Why we held money back" },
  { id: "suppliers", title: "Suppliers and prices" },
  { id: "paypal", title: "PayPal" },
  { id: "your-page", title: "Your page" },
] as const;

export type PageId = (typeof PAGES)[number]["id"];

const at = (xTrack: number, yTrack: number, xSpan: number, ySpan: number): AgWidgetLayoutState => ({ xTrack, yTrack, xSpan, ySpan });
const title = (text: string) => ({ title: { enabled: true, text } });
const sum = (id: string) => ({ id, aggregation: "sum" as const });
const countd = (id: string) => ({ id, aggregation: "countd" as const });

const kpi = (text: string, value: { id: string; aggregation?: "sum" | "countd" }) => ({
  type: "value" as const,
  dataMapping: { value: [value] },
  format: { title: { enabled: true, text } },
});

const owe: AgPageState<LedgerRegistry> = {
  id: "owe",
  widgets: {
    "kpi-to-pay": kpi("To pay", sum("invoices.toPay")),
    "kpi-sent": kpi("Sent via PayPal", sum("invoices.sent")),
    "kpi-withheld": kpi("Withheld, credit note due", sum("invoices.withheld")),
    "kpi-held": kpi("Held, not paid", sum("invoices.held")),
    "due-window": {
      type: "button-filter",
      dataMapping: { value: [{ id: "invoices.dueWindow" }] },
      format: { ...title("When it falls due"), style: { dimensions: { height: 30, minWidth: 48 } } },
    },
    "cash-by-week": {
      type: "column-chart-stacked",
      dataMapping: {
        categoryKey: [{ id: "invoices.dueWeekLabel" }],
        valueKey: [sum("invoices.toPay")],
        legendKey: [{ id: "suppliers.name" }],
      },
      sort: [{ field: { id: "invoices.dueWeekLabel" }, direction: "asc" }],
      format: { ...title("Still to pay, by the week it falls due"), style: { theme: { common: { legend: { enabled: true } } } } },
    },
    // One colour: a donut would hand each decision a palette colour that says nothing about it.
    "by-decision": {
      type: "bar-chart-grouped",
      dataMapping: { categoryKey: [{ id: "invoices.decision" }], valueKey: [sum("invoices.invoiced")] },
      sort: [{ field: sum("invoices.invoiced"), direction: "desc" }],
      format: title("Invoiced, by decision"),
    },
    "open-invoices": {
      type: "grid",
      dataMapping: {
        cols: [
          { id: "invoices.dueDate" },
          { id: "suppliers.name" },
          { id: "invoices.number" },
          { id: "invoices.status" },
          { id: "invoices.decision" },
          sum("invoices.toPay"),
          sum("invoices.withheld"),
          sum("invoices.held"),
          { id: "invoices.topFinding" },
        ],
      },
      sort: [{ field: { id: "invoices.dueDate" }, direction: "asc" }],
      format: title("Every invoice this week, soonest due first"),
    },
  },
  widgetLayout: {
    "kpi-to-pay": at(0, 0, 6, 7),
    "kpi-sent": at(6, 0, 6, 7),
    "kpi-withheld": at(12, 0, 6, 7),
    "kpi-held": at(18, 0, 6, 7),
    "due-window": at(0, 7, 24, 7),
    "cash-by-week": at(0, 14, 16, 17),
    "by-decision": at(16, 14, 8, 17),
    "open-invoices": at(0, 31, 24, 22),
  },
  filter: {
    // Only what is still to pay: sent and held invoices would add empty series to the legend.
    widget: { "cash-by-week": [{ field: { id: "invoices.toPay" }, model: { operator: "greaterThan", value: 0 } }] },
  },
};

const why: AgPageState<LedgerRegistry> = {
  id: "why",
  widgets: {
    "kpi-withheld": kpi("Withheld, credit note due", sum("invoices.withheld")),
    "kpi-held": kpi("Held, not paid", sum("invoices.held")),
    "kpi-findings": kpi("Findings", countd("findings.id")),
    "kpi-at-stake": kpi("Money at stake", sum("findings.atStake")),
    scoreboard: {
      type: "credit-note-scoreboard",
      dataMapping: { category: [{ id: "suppliers.name" }], value: [sum("invoices.withheld")] },
      format: title("Who owes us a credit note"),
    },
    "by-kind": {
      type: "bar-chart-grouped",
      dataMapping: { categoryKey: [{ id: "findings.kind" }], valueKey: [sum("findings.atStake")] },
      sort: [{ field: sum("findings.atStake"), direction: "desc" }],
      format: title("What the checks found, by money at stake"),
    },
    evidence: {
      type: "evidence-list",
      dataMapping: {},
      format: title("The evidence (click a bar or a supplier to narrow it)"),
    },
    "held-treemap": {
      type: "treemap-chart",
      dataMapping: { categoryKey: [{ id: "suppliers.name" }, { id: "findings.kind" }], valueKey: [sum("findings.atStake")] },
      format: title("Money at stake, by supplier and finding"),
    },
  },
  widgetLayout: {
    "kpi-withheld": at(0, 0, 6, 7),
    "kpi-held": at(6, 0, 6, 7),
    "kpi-findings": at(12, 0, 6, 7),
    "kpi-at-stake": at(18, 0, 6, 7),
    scoreboard: at(0, 7, 10, 18),
    "by-kind": at(10, 7, 14, 18),
    evidence: at(0, 25, 14, 26),
    "held-treemap": at(14, 25, 10, 26),
  },
};

const suppliers: AgPageState<LedgerRegistry> = {
  id: "suppliers",
  widgets: {
    supplier: {
      type: "list-filter",
      dataMapping: { value: [{ id: "suppliers.name" }] },
      format: title("Supplier"),
    },
    "money-by-supplier": {
      type: "bar-chart-stacked",
      dataMapping: {
        categoryKey: [{ id: "suppliers.name" }],
        valueKey: [sum("invoices.toPay"), sum("invoices.sent"), sum("invoices.withheld"), sum("invoices.held")],
      },
      format: { ...title("Where each supplier's money stands"), style: { theme: { common: { legend: { enabled: true } } } } },
    },
    "price-change": {
      type: "bar-chart-grouped",
      dataMapping: { categoryKey: [{ id: "priceChanges.item" }], valueKey: [{ id: "priceChanges.changePct", aggregation: "avg" }] },
      sort: [{ field: { id: "priceChanges.changePct", aggregation: "avg" }, direction: "desc" }],
      format: title("Unit price this week against the last invoice"),
    },
    "price-changes": {
      type: "grid",
      dataMapping: {
        cols: [
          { id: "suppliers.name" },
          { id: "priceChanges.item" },
          { id: "priceChanges.unit" },
          { id: "priceChanges.before", aggregation: "avg" },
          { id: "priceChanges.beforeRef" },
          { id: "priceChanges.now", aggregation: "avg" },
          { id: "priceChanges.ref" },
          { id: "priceChanges.changePct", aggregation: "avg" },
        ],
      },
      sort: [{ field: { id: "priceChanges.changePct", aggregation: "avg" }, direction: "desc" }],
      format: title("Every item on this week's invoices, against its last price"),
    },
  },
  widgetLayout: {
    supplier: at(0, 0, 6, 32),
    "money-by-supplier": at(6, 0, 18, 16),
    "price-change": at(6, 16, 18, 16),
    "price-changes": at(0, 32, 24, 22),
  },
};

const paypal: AgPageState<LedgerRegistry> = {
  id: "paypal",
  widgets: {
    about: {
      type: "text",
      dataMapping: {},
      format: {
        style: {
          text: "Payouts appear here once a payment run is approved, and restock orders once one goes through PayPal Orders. Each row carries the ids PayPal returned, so it can be checked in the sandbox.",
          typography: { fontSize: 14 },
          color: "var(--ink-2)",
          verticalAlign: "center",
        },
      },
    },
    "kpi-payouts": kpi("Sent through Payouts", sum("payouts.amount")),
    "kpi-items": kpi("Payout items", countd("payouts.id")),
    "kpi-captured": kpi("Captured on restock orders", sum("orders.captured")),
    "kpi-released": kpi("Released (did not arrive)", sum("orders.released")),
    "payout-status": {
      type: "donut-chart",
      dataMapping: { categoryKey: [{ id: "payouts.status" }], valueKey: [sum("payouts.amount")] },
      format: title("Payouts by PayPal status"),
    },
    "confirmed-by": {
      type: "bar-chart-grouped",
      dataMapping: { categoryKey: [{ id: "payouts.confirmedBy" }], valueKey: [countd("payouts.id")] },
      format: title("How each status was confirmed"),
    },
    payouts: {
      type: "grid",
      dataMapping: {
        cols: [{ id: "payouts.sentAt" }, { id: "suppliers.name" }, { id: "invoices.number" }, { id: "payouts.batch" }, { id: "payouts.item" }, { id: "payouts.status" }, { id: "payouts.confirmedBy" }, sum("payouts.amount")],
      },
      sort: [{ field: { id: "payouts.sentAt" }, direction: "desc" }],
      format: title("Every payout, with its PayPal ids"),
    },
    orders: {
      type: "grid",
      dataMapping: {
        cols: [{ id: "orders.createdAt" }, { id: "suppliers.name" }, { id: "orders.id" }, { id: "orders.placedBy" }, { id: "orders.status" }, sum("orders.authorized"), sum("orders.captured"), sum("orders.released"), sum("orders.refunded")],
      },
      sort: [{ field: { id: "orders.createdAt" }, direction: "desc" }],
      format: title("Restock orders: authorized, captured for what arrived, the rest released"),
    },
  },
  widgetLayout: {
    about: at(0, 0, 24, 4),
    "kpi-payouts": at(0, 4, 6, 7),
    "kpi-items": at(6, 4, 6, 7),
    "kpi-captured": at(12, 4, 6, 7),
    "kpi-released": at(18, 4, 6, 7),
    "payout-status": at(0, 11, 10, 16),
    "confirmed-by": at(10, 11, 14, 16),
    payouts: at(0, 27, 24, 18),
    orders: at(0, 45, 24, 16),
  },
};

// A blank page for the owner's own views: Claude builds here when asked for a new one.
const yours: AgPageState<LedgerRegistry> = {
  id: "your-page",
  widgets: {
    hint: {
      type: "text",
      dataMapping: {},
      format: {
        style: {
          text: "Your page: ask Claude to build a view here, or switch to Edit and drag widgets in.",
          typography: { fontSize: 14 },
          color: "var(--ink-2)",
          verticalAlign: "center",
        },
      },
    },
  },
  widgetLayout: { hint: at(0, 0, 24, 4) },
};

export function defaultReport(): AgReportState<LedgerRegistry> {
  return {
    pages: [owe, why, suppliers, paypal, yours],
    selectedPageId: "owe",
    panels: { filters: { collapsed: true }, data: { collapsed: true }, ai: { collapsed: true } },
  };
}
