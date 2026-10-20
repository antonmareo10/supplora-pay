// The payment-run agent: Claude plans the week's supplier payments with tools.
// It can read invoices, cash and suppliers, and propose a plan that the tools
// validate (cash cap, held invoices, discount windows, completeness). It has no
// tool that moves money: the plan waits for the owner's approval in the UI.

import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { PAID_INVOICES, RESTAURANT, supplierById } from "@/data/seed";
import { effective, isSettled } from "./ap";
import { callTool, replayRun, runLive } from "./agent-run";
import { anthropic, claudeErrorMessage, claudeMode, MODEL } from "./claude";
import { addDays, businessToday, daysBetween, fmtDay } from "./dates";
import { fmt, pctOf, toDecimalString } from "./money";
import { fingerprint, recordedRun, recordMode } from "./recordings";
import { auditEntry, newId, readState, updateState } from "./state";
import type { AgentEvent, AppState, DeferredPayment, DocumentRecord, PaymentPlan, PlannedPayment } from "./types";

type Emit = (e: AgentEvent) => void;

const eur = (cents: number) => Number(toDecimalString(cents));

interface OpenInvoice {
  doc: DocumentRecord;
  supplierName: string;
  invoiceNumber: string;
  payableCents: number;
  withheldCents: number;
  dueDate: string | null;
  discount: { percent: number; deadline: string; amountCents: number } | null;
}

export function openInvoices(state: AppState, today: string): { open: OpenInvoice[]; held: DocumentRecord[]; unreviewed: number } {
  const open: OpenInvoice[] = [];
  const held: DocumentRecord[] = [];
  let unreviewed = 0;
  for (const doc of state.documents) {
    if (isSettled(doc)) continue;
    const e = effective(doc);
    if (!e || !doc.review) {
      unreviewed++;
      continue;
    }
    if (e.action === "hold") {
      held.push(doc);
      continue;
    }
    const d = doc.review.discount;
    open.push({
      doc,
      supplierName: supplierById(doc.review.supplierId)?.name ?? doc.review.extraction.supplier_name,
      invoiceNumber: doc.review.extraction.invoice_number ?? doc.fileName,
      payableCents: e.payableCents,
      withheldCents: e.withheldCents,
      dueDate: doc.review.dueDate,
      discount:
        d && d.deadline >= today ? { percent: d.percent, deadline: d.deadline, amountCents: pctOf(e.payableCents, d.percent) } : null,
    });
  }
  return { open, held, unreviewed };
}

const SYSTEM = `You are the accounts-payable agent for ${RESTAURANT.name}, an independent restaurant in Málaga. Every week you prepare the supplier payment run for the owner, ${RESTAURANT.ownerFirstName}. You never move money yourself: you propose a plan, and nothing is paid until ${RESTAURANT.ownerFirstName} approves it in the app. Approved payments go out as one PayPal payout batch.

How to work:
1. Call get_open_invoices and get_cash_position (in parallel).
2. Call get_supplier for the suppliers whose relationship matters to a decision (for example a supplier you consider deferring).
3. Check your plan with propose_payment_plan. If it returns errors, fix them and call it again.
4. Call request_approval once, with a short message for ${RESTAURANT.ownerFirstName}.

Rules:
- The plan total must not exceed the cash cap ${RESTAURANT.ownerFirstName} set for this run. The next payment run is in 7 days.
- Never pay held invoices. Partial invoices are paid at their payable amount; disputed amounts stay withheld until the supplier sends a credit note.
- Priorities: overdue invoices, then invoices due before the next run (earliest first); then early-payment discounts while their window is open (2% for paying ~20 days early is worth more than 30% a year, better than any other use of the cash); then the rest. When the cap does not allow everything, defer invoices that are not due before the next run.
- Every open invoice must be either paid or deferred, each with a one-sentence reason that cites the exact euros and dates returned by the tools.
- Write for a busy owner: plain, warm, specific. Before each group of tool calls, write one short sentence (max 15 words) saying what you are checking.`;

/** What a recorded planner run depends on: replay only when this matches exactly. */
export function plannerFingerprint(state: AppState, today: string): string {
  const { open, held, unreviewed } = openInvoices(state, today);
  return fingerprint({
    today,
    cap: state.settings.cashCapCents,
    open: open.map((o) => [o.doc.id, o.payableCents, o.withheldCents, o.dueDate, o.discount?.amountCents ?? 0, o.discount?.deadline ?? null]),
    held: held.map((h) => h.id),
    unreviewed,
  });
}

export async function runPaymentPlanner(emit: Emit, signal?: AbortSignal): Promise<string | null> {
  const mode = claudeMode();
  const today = businessToday();
  const startState = await readState();
  const capCents = startState.settings.cashCapCents;
  let draft: { payments: PlannedPayment[]; deferred: DeferredPayment[]; summary: string; totals: PaymentPlan["totals"] } | null = null;
  let savedPlanId: string | null = null;
  const log: AgentEvent[] = [];
  const out: Emit = (e) => {
    log.push(e);
    emit(e);
  };

  const tool = <T extends z.ZodType>(def: {
    name: string;
    description: string;
    inputSchema: T;
    label: (input: z.infer<T>) => string;
    run: (input: z.infer<T>) => Promise<{ summary: string; result: unknown; error?: boolean }>;
  }) =>
    betaZodTool({
      name: def.name,
      description: def.description,
      inputSchema: def.inputSchema,
      run: async (input, ctx) => {
        const id = ctx?.toolUse.id ?? crypto.randomUUID();
        out({ type: "tool_start", id, tool: def.name, label: def.label(input) });
        try {
          const r = await def.run(input);
          out({ type: "tool_end", id, tool: def.name, summary: r.summary, error: r.error });
          return JSON.stringify(r.result);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          out({ type: "tool_end", id, tool: def.name, summary: message, error: true });
          return `Error: ${message}`;
        }
      },
    });

  const getOpenInvoices = tool({
    name: "get_open_invoices",
    description:
      "Reviewed, unpaid supplier invoices with the amount that can be paid (after withholding disputed lines), due dates and any early-payment discount still available. Also lists held invoices that must not be paid, and how many documents are still unreviewed.",
    inputSchema: z.object({}),
    label: () => "Reading reviewed invoices",
    run: async () => {
      const { open, held, unreviewed } = openInvoices(await readState(), today);
      return {
        summary: `${open.length} payable · ${held.length} held${unreviewed ? ` · ${unreviewed} not reviewed` : ""}`,
        result: {
          today,
          invoices: open.map((o) => ({
            invoice_id: o.doc.id,
            supplier_id: o.doc.review!.supplierId,
            supplier: o.supplierName,
            invoice_number: o.invoiceNumber,
            invoice_total_eur: eur(o.doc.review!.invoiceCents),
            withheld_eur: eur(o.withheldCents),
            withheld_reason: o.withheldCents
              ? o.doc.review!.findings.filter((f) => f.withholdCents > 0).map((f) => f.title).join("; ")
              : null,
            payable_eur: eur(o.payableCents),
            due_date: o.dueDate,
            days_until_due: o.dueDate ? daysBetween(today, o.dueDate) : null,
            early_payment_discount: o.discount
              ? {
                  percent: o.discount.percent,
                  pay_by: o.discount.deadline,
                  saving_eur: eur(o.discount.amountCents),
                  amount_if_paid_early_eur: eur(o.payableCents - o.discount.amountCents),
                }
              : null,
          })),
          held_do_not_pay: held.map((d) => ({
            invoice_id: d.id,
            supplier: supplierById(d.review!.supplierId)?.name ?? d.review!.extraction.supplier_name,
            invoice_number: d.review!.extraction.invoice_number,
            total_eur: eur(d.review!.invoiceCents),
            reason: d.review!.findings.find((f) => f.severity === "high")?.title ?? d.review!.summary,
          })),
          unreviewed_documents: unreviewed,
        },
      };
    },
  });

  const getCashPosition = tool({
    name: "get_cash_position",
    description: "The owner's cash cap for this payment run, the date of the next run, and known upcoming commitments.",
    inputSchema: z.object({}),
    label: () => "Checking the cash cap for this run",
    run: async () => {
      const state = await readState();
      const { open } = openInvoices(state, today);
      return {
        summary: `Cap ${fmt(capCents)} · open payables ${fmt(open.reduce((s, o) => s + o.payableCents, 0))}`,
        result: {
          today,
          cash_cap_for_this_run_eur: eur(capCents),
          next_payment_run: addDays(today, 7),
          open_payables_total_eur: eur(open.reduce((s, o) => s + o.payableCents, 0)),
          funding: "Payouts are sent from the restaurant's PayPal business balance.",
          upcoming_commitments: [
            { what: "Staff payroll", date: "2026-10-30", eur: 8400 },
            { what: "Rent", date: "2026-11-01", eur: 3200 },
          ],
        },
      };
    },
  });

  const getSupplier = tool({
    name: "get_supplier",
    description: "A supplier's payment terms, what the owner says about the relationship, and recent payments.",
    inputSchema: z.object({ supplier_id: z.string() }),
    label: ({ supplier_id }) => `Looking up ${supplierById(supplier_id)?.name ?? supplier_id}`,
    run: async ({ supplier_id }) => {
      const s = supplierById(supplier_id);
      if (!s) return { summary: "Unknown supplier", result: { error: `No supplier with id ${supplier_id}` }, error: true };
      const recent = PAID_INVOICES.filter((p) => p.supplierId === s.id).slice(-3);
      return {
        summary: `${s.termsLabel} · ${s.category}`,
        result: {
          name: s.name,
          category: s.category,
          terms: s.termsLabel,
          relationship: s.relationship,
          recent_payments: recent.map((p) => ({ invoice: p.invoiceNumber, eur: eur(p.amountCents), paid_on: p.paidAt })),
          paid_via: "PayPal payout",
        },
      };
    },
  });

  const proposePlan = tool({
    name: "propose_payment_plan",
    description:
      "Validate a payment plan. Each open invoice must appear exactly once, either in payments or in deferred. Amounts are computed by the system from the payable amount (minus the early-payment discount when take_early_payment_discount is true). Returns the computed plan, or errors to fix.",
    inputSchema: z.object({
      payments: z.array(
        z.object({
          invoice_id: z.string(),
          take_early_payment_discount: z.boolean(),
          reason: z.string().describe("One sentence citing exact euros and dates"),
        }),
      ),
      deferred: z.array(z.object({ invoice_id: z.string(), reason: z.string() })),
      summary: z.string().describe("One or two sentences summarising the run for the owner"),
    }),
    label: (input) => `Checking a plan with ${input.payments.length} payment${input.payments.length === 1 ? "" : "s"}`,
    run: async (input) => {
      const { open, held } = openInvoices(await readState(), today);
      const errors: string[] = [];
      const seen = new Set<string>();
      const payments: PlannedPayment[] = [];
      const deferred: DeferredPayment[] = [];
      for (const p of input.payments) {
        const o = open.find((x) => x.doc.id === p.invoice_id);
        if (held.some((h) => h.id === p.invoice_id)) errors.push(`${p.invoice_id} is held and must not be paid.`);
        else if (!o) errors.push(`${p.invoice_id} is not an open payable invoice.`);
        if (seen.has(p.invoice_id)) errors.push(`${p.invoice_id} appears more than once.`);
        seen.add(p.invoice_id);
        if (!o) continue;
        if (p.take_early_payment_discount && !o.discount) errors.push(`${o.invoiceNumber} has no early-payment discount available.`);
        if (!p.reason.trim()) errors.push(`Give a reason for ${o.invoiceNumber}.`);
        const discountCents = p.take_early_payment_discount && o.discount ? o.discount.amountCents : 0;
        payments.push({
          docId: o.doc.id,
          supplierId: o.doc.review!.supplierId!,
          supplierName: o.supplierName,
          invoiceNumber: o.invoiceNumber,
          dueDate: o.dueDate,
          invoiceCents: o.doc.review!.invoiceCents,
          withheldCents: o.withheldCents,
          discountCents,
          amountCents: o.payableCents - discountCents,
          reason: p.reason.trim(),
          status: "proposed",
        });
      }
      for (const d of input.deferred) {
        const o = open.find((x) => x.doc.id === d.invoice_id);
        if (!o) {
          if (!held.some((h) => h.id === d.invoice_id)) errors.push(`${d.invoice_id} is not an open payable invoice.`);
          continue;
        }
        if (seen.has(d.invoice_id)) errors.push(`${o.invoiceNumber} is both paid and deferred (or listed twice).`);
        seen.add(d.invoice_id);
        deferred.push({ docId: o.doc.id, supplierName: o.supplierName, invoiceNumber: o.invoiceNumber, amountCents: o.payableCents, reason: d.reason.trim() });
      }
      for (const o of open) if (!seen.has(o.doc.id)) errors.push(`${o.invoiceNumber} (${o.doc.id}) is missing: pay it or defer it.`);
      const payCents = payments.reduce((s, p) => s + p.amountCents, 0);
      if (payCents > capCents) errors.push(`Total ${fmt(payCents)} exceeds the cash cap of ${fmt(capCents)} by ${fmt(payCents - capCents)}.`);
      if (!payments.length && open.length) errors.push("The plan pays nothing although invoices are open.");
      if (errors.length) {
        draft = null;
        return { summary: `${errors.length} issue${errors.length === 1 ? "" : "s"} to fix`, result: { ok: false, errors }, error: true };
      }
      const totals = {
        payCents,
        discountCents: payments.reduce((s, p) => s + p.discountCents, 0),
        withheldCents: payments.reduce((s, p) => s + p.withheldCents, 0),
        deferredCents: deferred.reduce((s, d) => s + d.amountCents, 0),
        headroomCents: capCents - payCents,
      };
      draft = { payments, deferred, summary: input.summary.trim(), totals };
      return {
        summary: `Valid: pay ${fmt(payCents)} of ${fmt(capCents)} cap${totals.discountCents ? ` · saves ${fmt(totals.discountCents)}` : ""}`,
        result: {
          ok: true,
          total_eur: eur(payCents),
          cash_cap_eur: eur(capCents),
          headroom_eur: eur(totals.headroomCents),
          discounts_captured_eur: eur(totals.discountCents),
          payments: payments.map((p) => ({ invoice_id: p.docId, supplier: p.supplierName, amount_eur: eur(p.amountCents), discount_eur: eur(p.discountCents) })),
          deferred: deferred.map((d) => ({ invoice_id: d.docId, supplier: d.supplierName, amount_eur: eur(d.amountCents) })),
        },
      };
    },
  });

  const requestApproval = tool({
    name: "request_approval",
    description:
      "Send the last valid plan from propose_payment_plan to the owner for approval. Call exactly once, at the end. The owner approves in the app; you cannot execute payments.",
    inputSchema: z.object({ message_to_owner: z.string().describe("2-3 sentences: what you propose and the main trade-off") }),
    label: () => `Sending the plan to ${RESTAURANT.ownerFirstName} for approval`,
    run: async ({ message_to_owner }) => {
      if (!draft) {
        return { summary: "No valid plan yet", result: { error: "Call propose_payment_plan and fix any errors first." }, error: true };
      }
      savedPlanId = await savePlan(draft, capCents, today, message_to_owner.trim(), log);
      out({ type: "result", kind: "plan", id: savedPlanId });
      return {
        summary: `Waiting for ${RESTAURANT.ownerFirstName}'s approval`,
        result: { ok: true, plan_id: savedPlanId, note: "Sent. Nothing is paid until the owner approves. Stop here." },
      };
    },
  });

  const tools = [getOpenInvoices, getCashPosition, getSupplier, proposePlan, requestApproval];
  const fp = plannerFingerprint(startState, today);

  if (mode === "replay") {
    const rec = recordedRun("planner");
    if (rec && rec.fingerprint === fp) {
      await replayRun(rec, tools, out, signal);
    } else {
      out({
        type: "info",
        tone: "fallback",
        text: "Your inputs differ from the recorded Claude run (another cash cap, an override, or invoices already paid), so the demo's deterministic planner prepares this plan instead: the same priority rules written as code, validated by the same tools. Run the app with your own API key to see Claude plan any scenario.",
      });
      await runFallbackPlanner(tools, today, capCents);
    }
  } else {
    const result = await runLive(
      anthropic(),
      {
        model: MODEL,
        max_tokens: 16000,
        max_iterations: 10,
        system: SYSTEM,
        output_config: { effort: "medium" },
        thinking: { type: "adaptive", display: "updates" },
        betas: ["server-side-fallback-2026-07-01", "thinking-display-updates-2026-08-18"],
        fallbacks: "default",
        tools,
        messages: [
          {
            role: "user",
            content: `Today is ${fmtDay(today)} (${today}). Prepare this week's supplier payment run for ${RESTAURANT.ownerFirstName}.`,
          },
        ],
      },
      out,
      signal,
      recordMode() ? { kind: "planner", fingerprint: fp, meta: { cashCapCents: capCents, today } } : null,
    );
    if (result.refused) {
      out({ type: "error", message: "The model declined this request." });
      return null;
    }
    if (result.error && !savedPlanId) {
      out({ type: "error", message: claudeErrorMessage(result.error) });
      return null;
    }
  }

  // The agent validated a plan but stopped before asking: still route it to the owner.
  if (!savedPlanId && draft) {
    savedPlanId = await savePlan(draft, capCents, today, (draft as { summary: string }).summary, log);
    out({ type: "result", kind: "plan", id: savedPlanId });
  }
  if (!savedPlanId) {
    out({ type: "error", message: "The agent stopped before producing a valid plan. Please try again." });
    return null;
  }
  const planId = savedPlanId;
  await updateState((s) => {
    const plan = s.plans.find((p) => p.id === planId);
    if (plan) plan.agentLog = log;
  });
  return planId;
}

/**
 * Demo-only fallback when the visitor's inputs differ from the recorded run: the planner's
 * priority rules as code (due before the next run first, then open early-payment discounts,
 * then the rest waits), driven through the agent's own tools so validation, the audit trail
 * and the approval flow are identical. Never used when Claude is available.
 */
async function runFallbackPlanner(tools: Parameters<typeof callTool>[0], today: string, capCents: number): Promise<void> {
  const call = (tool: string, input: Record<string, unknown> = {}) => callTool(tools, { id: `fallback_${tool}_${crypto.randomUUID().slice(0, 8)}`, tool, input });
  await Promise.all([call("get_open_invoices"), call("get_cash_position")]);
  const { open } = openInvoices(await readState(), today);
  const nextRun = addDays(today, 7);
  const byDue = [...open].sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
  const due = byDue.filter((o) => o.dueDate && o.dueDate <= nextRun);
  const discounted = byDue.filter((o) => !due.includes(o) && o.discount).sort((a, b) => b.discount!.amountCents - a.discount!.amountCents);
  const rest = byDue.filter((o) => !due.includes(o) && !discounted.includes(o));
  let total = 0;
  const payments: { invoice_id: string; take_early_payment_discount: boolean; reason: string }[] = [];
  const deferred: { invoice_id: string; reason: string }[] = [];
  const label = (o: OpenInvoice) => `${o.supplierName} ${o.invoiceNumber}`;
  const withheld = (o: OpenInvoice) => (o.withheldCents ? ` (${fmt(o.withheldCents)} withheld until a credit note arrives)` : "");
  for (const o of due) {
    const amount = o.payableCents - (o.discount?.amountCents ?? 0);
    if (total + amount > capCents) {
      deferred.push({ invoice_id: o.doc.id, reason: `${label(o)} is due ${fmtDay(o.dueDate)} but ${fmt(amount)} does not fit the ${fmt(capCents)} cap: raise the cap or pay it in the next run.` });
      continue;
    }
    total += amount;
    payments.push({
      invoice_id: o.doc.id,
      take_early_payment_discount: !!o.discount,
      reason: `${label(o)} is due ${fmtDay(o.dueDate)}, before the next run on ${fmtDay(nextRun)}: pay ${fmt(amount)}${withheld(o)}.`,
    });
  }
  for (const o of discounted) {
    const amount = o.payableCents - o.discount!.amountCents;
    if (total + amount > capCents) {
      deferred.push({ invoice_id: o.doc.id, reason: `Paying ${label(o)} early would save ${fmt(o.discount!.amountCents)}, but ${fmt(amount)} does not fit the ${fmt(capCents)} cap.` });
      continue;
    }
    total += amount;
    payments.push({
      invoice_id: o.doc.id,
      take_early_payment_discount: true,
      reason: `Paying ${label(o)} by ${fmtDay(o.discount!.deadline)} takes the ${o.discount!.percent}% early-payment discount: ${fmt(amount)} instead of ${fmt(o.payableCents)}, saving ${fmt(o.discount!.amountCents)}.`,
    });
  }
  for (const o of rest) {
    deferred.push({ invoice_id: o.doc.id, reason: `${label(o)} (${fmt(o.payableCents)}${withheld(o)}) is not due until ${fmtDay(o.dueDate)}, after the next run on ${fmtDay(nextRun)}, so it waits to keep cash in hand.` });
  }
  if (!payments.length && !deferred.length) return;
  const discounts = payments.filter((p) => p.take_early_payment_discount).length;
  const summary = `Pay ${payments.length} invoice${payments.length === 1 ? "" : "s"} for ${fmt(total)} of the ${fmt(capCents)} cap${discounts ? ", taking the early-payment discount where it is open" : ""}; ${deferred.length} deferred.`;
  const proposed = await call("propose_payment_plan", { payments, deferred, summary });
  if (proposed.startsWith("Error") || proposed.includes('"ok":false')) return;
  await call("request_approval", { message_to_owner: `${summary} Nothing is paid until you approve.` });
}

async function savePlan(
  draft: { payments: PlannedPayment[]; deferred: DeferredPayment[]; summary: string; totals: PaymentPlan["totals"] },
  capCents: number,
  today: string,
  messageToOwner: string,
  log: AgentEvent[],
): Promise<string> {
  const id = newId("plan");
  await updateState((s) => {
    for (const p of s.plans) if (p.status === "awaiting_approval") p.status = "superseded";
    s.plans.push({
      id,
      createdAt: new Date().toISOString(),
      today,
      status: "awaiting_approval",
      cashCapCents: capCents,
      payments: draft.payments,
      deferred: draft.deferred,
      totals: draft.totals,
      summary: draft.summary,
      messageToOwner,
      agentLog: log,
    });
    s.audit.push(
      auditEntry({
        actor: "agent",
        message: `Payment plan proposed: ${draft.payments.length} payments, ${fmt(draft.totals.payCents)} of ${fmt(capCents)} cap${draft.totals.discountCents ? `, ${fmt(draft.totals.discountCents)} in early-payment discounts` : ""}; ${draft.deferred.length} deferred. Awaiting owner approval.`,
        ref: { planId: id },
        amountCents: draft.totals.payCents,
      }),
    );
  });
  return id;
}

