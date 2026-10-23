// AG Studio's data model for the ledger: one table per row type in lib/studio-data.ts, the joins
// between them, a calendar for "by week" questions and two ratios. Field ids ('invoices.toPay')
// are what reports, widgets and the agents refer to, so they stay stable.

import {
  createFormats,
  type AgDataSourcesDefinition,
  type AgExpressionFieldDefinition,
  type AgFieldDefinition,
  type AgFormat,
  type AgRelationDefinition,
} from "ag-studio";
import type { StudioTables } from "@/lib/studio-data";
import type { LedgerRegistry } from "./widgets/types";

const CALENDAR_ID = "calendar";

type FieldSpec = [id: string, name: string, format: AgFormat<LedgerRegistry>, hide?: boolean, description?: string];

const fields = (specs: FieldSpec[]): AgFieldDefinition<LedgerRegistry>[] =>
  specs.map(([id, name, format, hide, description]) => ({ id, name, format, ...(hide && { hide }), ...(description && { description }) }));

const manyToOne = (id: string, source: string, target: string): AgRelationDefinition => {
  const [sourceTable, sourceField] = source.split(".");
  const [targetTable, targetField] = target.split(".");
  return { id, source: { tableId: sourceTable, fieldId: sourceField }, target: { tableId: targetTable, fieldId: targetField }, type: "many-to-one" };
};

const onCalendar = (tableId: string, fieldId: string, truncate?: "day"): AgRelationDefinition => ({
  id: `${tableId}-${fieldId}-calendar`,
  source: { tableId, fieldId },
  target: { calendarId: CALENDAR_ID },
  ...(truncate && { truncate }),
});

const ratio = (id: string, name: string, description: string, numerator: string, denominator: string): AgExpressionFieldDefinition<LedgerRegistry> => ({
  id,
  name,
  description,
  format: "percentageFormat",
  isMeasure: true,
  expression: { operator: "divide", inputs: [{ id: numerator, aggregation: "sum" }, { id: denominator, aggregation: "sum" }] },
});

/** True when there is something to analyse: at least one reviewed invoice. */
export const hasLedgerData = (t: StudioTables) => t.invoices.length > 0;

export function buildStudioData(t: StudioTables): AgDataSourcesDefinition<LedgerRegistry> {
  // The calendar covers the payables, not the price history: "by week" charts then start at the
  // first week that has an invoice due or a payment, instead of a month of empty weeks.
  const days = [...t.invoices.map((r) => r.dueDate), ...t.payouts.map((r) => r.sentAt.slice(0, 10)), ...t.orders.map((r) => r.createdAt.slice(0, 10)), t.asOf]
    .filter((d): d is string => !!d)
    .sort();

  return {
    description:
      `Accounts payable for ${t.restaurant.name}, a restaurant in ${t.restaurant.city}, Spain (owner ${t.restaurant.owner}), for the week of ` +
      `${t.asOf}. Amounts are EUR including VAT. Each supplier invoice was read by Claude and checked by rules against ` +
      "the signed delivery note, the price history and earlier payments. Decisions: Pay in full, Pay partial (line " +
      "overcharges withheld until the supplier sends a credit note) or Hold (nothing paid: duplicates, unknown " +
      "senders, changed payment details, instructions aimed at the AI). Payments go out through PayPal Payouts; " +
      "restock orders through PayPal Orders (authorized, then captured for what arrived).",
    // Euros and dates as the rest of the app shows them, whatever the browser's locale.
    formats: createFormats({
      overrides: {
        currencyFormat: { formatOptions: { format: new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" }) } },
        // Studio reads plain dates as local days, so they are shown in local time too (no off-by-one).
        dateFormat: { formatOptions: { format: new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }) } },
        dateTimeFormat: {
          formatOptions: { format: new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" }) },
        },
      },
    }) as LedgerRegistry["formats"],
    sources: [
      {
        id: "invoices",
        description: "One row per reviewed supplier invoice this week. toPay is still to send; sent went through PayPal; withheld is held back on a partial payment until a credit note arrives; held is the whole invoice when it is on hold.",
        data: t.invoices,
        fields: fields([
          ["id", "Invoice id", "textFormat", true],
          ["number", "Invoice", "textFormat"],
          ["supplierId", "Supplier id", "textFormat", true],
          ["status", "Status", "textFormat", false, "Payment status: Open, Pay partial, Held, Paying, Sent (awaiting the supplier's PayPal claim), Paid, Payment failed or Returned."],
          ["statusRank", "Status urgency", "integerFormat", true, "0 is most urgent (failed), 7 least (paid)."],
          ["decision", "Decision", "textFormat", false, "Pay in full, Pay partial or Hold."],
          ["decidedBy", "Decided by", "textFormat", false, "Checks and Claude, or Owner when the owner overrode the recommendation."],
          ["invoiceDate", "Invoice date", "dateFormat"],
          ["dueDate", "Due date", "dateFormat"],
          ["dueWindow", "Due window", "textFormat", false, "Overdue, Due within 7 days, Due in 8 to 14 days, Due later, No due date, or Paid or sent."],
          ["daysToDue", "Days to due", "integerFormat", false, "Negative when overdue; empty once paid or sent."],
          ["dueWeek", "Week due (Monday)", "dateFormat", false, "Monday of the week the invoice falls due."],
          ["dueWeekLabel", "Week due", "textFormat", false, "The week the invoice falls due, as W43 · 19 Oct (sorts in time order)."],
          ["invoiced", "Invoiced", "currencyFormat"],
          ["toPay", "To pay", "currencyFormat", false, "Still to send through PayPal (0 once sent, or when the invoice is on hold)."],
          ["sent", "Sent via PayPal", "currencyFormat", false, "Sent through PayPal Payouts: claimed by the supplier or waiting for their claim."],
          ["withheld", "Withheld (credit note due)", "currencyFormat", false, "Line overcharges held back on a partial payment until the supplier sends a credit note."],
          ["held", "Held (not paid)", "currencyFormat", false, "The whole invoice, when it is on hold."],
          ["discount", "Early-payment discount", "currencyFormat"],
          ["topFinding", "Top finding", "textFormat"],
          ["findings", "Findings", "integerFormat"],
          ["paypalBatch", "PayPal payout batch", "textFormat"],
          ["paypalItem", "PayPal payout item", "textFormat"],
          ["link", "Review page", "textFormat", true],
        ]),
      },
      {
        id: "findings",
        description: "What the checks found on each invoice, with the evidence. atStake is the money involved; withhold is the part not paid until it is resolved.",
        data: t.findings,
        fields: fields([
          ["id", "Finding id", "textFormat", true],
          ["invoiceId", "Invoice id", "textFormat", true],
          ["kind", "Finding", "textFormat"],
          ["severity", "Severity", "textFormat"],
          ["severityRank", "Severity rank", "integerFormat", true],
          ["title", "What the checks found", "textFormat"],
          ["detail", "Detail", "textFormat"],
          ["evidence", "Evidence", "textFormat"],
          ["atStake", "At stake", "currencyFormat"],
          ["withhold", "Withheld for this", "currencyFormat"],
          ["source", "Found by", "textFormat", false, "Rule (deterministic check) or Claude (read off the document)."],
        ]),
      },
      {
        id: "suppliers",
        description: "The restaurant's suppliers, plus any sender that is not one of them.",
        data: t.suppliers,
        fields: fields([
          ["id", "Supplier id", "textFormat", true],
          ["name", "Supplier", "textFormat"],
          ["category", "Category", "textFormat"],
          ["terms", "Payment terms", "textFormat"],
          ["known", "Supplier on file", "booleanFormat"],
        ]),
      },
      {
        id: "payouts",
        name: "PayPal payouts",
        description: "PayPal Payouts items sent for invoices, with the status PayPal reported and how it was confirmed.",
        data: t.payouts,
        fields: fields([
          ["id", "Payout id", "textFormat", true],
          ["invoiceId", "Invoice id", "textFormat", true],
          ["supplierId", "Supplier id", "textFormat", true],
          ["batch", "Payout batch", "textFormat"],
          ["item", "Payout item", "textFormat"],
          ["status", "PayPal status", "textFormat"],
          ["amount", "Payout amount", "currencyFormat"],
          ["sentAt", "Sent at", "dateTimeFormat"],
          ["confirmedBy", "Status confirmed by", "textFormat"],
        ]),
      },
      {
        id: "orders",
        name: "Restock orders",
        description: "Restock orders paid with PayPal Orders: authorized at approval, captured for what the delivery note confirms, the rest released.",
        data: t.orders,
        fields: fields([
          ["id", "PayPal order", "textFormat"],
          ["supplierId", "Supplier id", "textFormat", true],
          ["placedBy", "Placed by", "textFormat"],
          ["status", "Order status", "textFormat"],
          ["authorized", "Authorized", "currencyFormat"],
          ["captured", "Captured", "currencyFormat"],
          ["released", "Released", "currencyFormat"],
          ["refunded", "Refunded", "currencyFormat"],
          ["createdAt", "Ordered at", "dateTimeFormat"],
        ]),
      },
      {
        id: "prices",
        name: "Unit prices",
        description: "Unit prices per item: earlier invoices from the price history, and this week's invoices.",
        data: t.prices,
        fields: fields([
          ["id", "Price id", "textFormat", true],
          ["supplierId", "Supplier id", "textFormat", true],
          ["item", "Item", "textFormat"],
          ["unit", "Unit", "textFormat"],
          ["date", "Price date", "dateFormat"],
          ["unitPrice", "Unit price", "currencyFormat"],
          ["source", "Price source", "textFormat"],
          ["ref", "Document", "textFormat"],
        ]),
      },
      {
        id: "priceChanges",
        name: "Price changes",
        description: "This week's unit price per item against the last earlier invoice for the same item. changePct is the change as a fraction (0.05 = 5%).",
        data: t.priceChanges,
        fields: fields([
          ["id", "Price change id", "textFormat", true],
          ["invoiceId", "Invoice id", "textFormat", true],
          ["supplierId", "Supplier id", "textFormat", true],
          ["item", "Item", "textFormat"],
          ["unit", "Unit", "textFormat"],
          ["before", "Last price", "currencyFormat"],
          ["beforeRef", "Last invoice", "textFormat"],
          ["now", "This week", "currencyFormat"],
          ["ref", "This week's invoice", "textFormat"],
          ["change", "Change per unit", "currencyFormat"],
          ["changePct", "Change", "percentageFormat"],
        ]),
      },
    ],
    relationships: [
      manyToOne("invoice-supplier", "invoices.supplierId", "suppliers.id"),
      manyToOne("finding-invoice", "findings.invoiceId", "invoices.id"),
      manyToOne("payout-invoice", "payouts.invoiceId", "invoices.id"),
      manyToOne("order-supplier", "orders.supplierId", "suppliers.id"),
      manyToOne("price-supplier", "prices.supplierId", "suppliers.id"),
      manyToOne("price-change-invoice", "priceChanges.invoiceId", "invoices.id"),
      onCalendar("invoices", "dueDate"),
      onCalendar("payouts", "sentAt", "day"),
      onCalendar("orders", "createdAt", "day"),
    ],
    calendars: [
      {
        id: CALENDAR_ID,
        label: "Calendar",
        range: {
          from: { type: "date", value: days[0] ?? t.asOf },
          to: { type: "date", value: days.at(-1) ?? t.asOf },
        },
        fragments: ["year", "month", "week", "day", "dayOfWeek"],
      },
    ],
    expressions: [
      ratio("withheldShare", "Withheld share", "Withheld on partial payments / invoiced.", "invoices.withheld", "invoices.invoiced"),
      ratio("sentShare", "Sent share", "Sent through PayPal / invoiced.", "invoices.sent", "invoices.invoiced"),
    ],
  };
}
