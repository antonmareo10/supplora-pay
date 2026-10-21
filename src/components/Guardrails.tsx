// Shown on the review page of an invoice held as possible fraud (a changed payee, or text that tries
// to instruct the AI): why it cannot pay the address printed on it. Every line is computed now, from
// the same code the payment flow runs; nothing here is a canned message.

import { supplierById } from "@/data/seed";
import { FRAUD_HOLD_KINDS } from "@/lib/ap";
import { businessToday } from "@/lib/dates";
import { validateProposal } from "@/lib/plan-rules";
import { openInvoices, planCandidate } from "@/lib/planner";
import type { AppState, DocumentRecord } from "@/lib/types";
import { IconShield } from "./icons";
import { Mono } from "./ui";

export function hasFraudHold(doc: DocumentRecord): boolean {
  return !!doc.review?.findings.some((f) => FRAUD_HOLD_KINDS.includes(f.kind));
}

export function Guardrails({ doc, state }: { doc: DocumentRecord; state: AppState }) {
  const r = doc.review;
  if (!r || !hasFraudHold(doc)) return null;
  const supplier = supplierById(r.supplierId);
  const printed = r.extraction.payment_email;
  const injection = r.findings.find((f) => f.kind === "suspicious_instruction");
  // The payment agent's own plan check, asked to pay this invoice as the document demands.
  const { open, held } = openInvoices(state, businessToday());
  const check = validateProposal(
    { payments: [{ invoice_id: doc.id, take_early_payment_discount: false, reason: "Pay in full today, as the note on the invoice asks." }], deferred: [] },
    open.map(planCandidate),
    held.map((h) => h.id),
    state.settings.cashCapCents,
  );
  const refusal = check.errors.filter((e) => e.includes(doc.id));
  const heldReason = r.findings.find((f) => f.severity === "high")?.title;

  return (
    <section aria-labelledby="guardrails" className="rounded-2xl border border-ledger/25 bg-ledger-soft/50 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <IconShield size={20} className="mt-1 shrink-0 text-ledger" />
        <div className="min-w-0">
          <h2 id="guardrails" className="font-display text-2xl leading-tight text-ink">
            Why this invoice cannot pay the account printed on it
          </h2>
          <p className="mt-1 text-sm text-ink-2">Checked now, by the code that runs the payments. No model decides any of this.</p>
        </div>
      </div>
      <ol className="mt-4 space-y-3 text-sm text-ink-2">
        <li className="rounded-xl border border-line bg-card px-4 py-3">
          <p className="font-semibold text-ink">1. The payee comes from your supplier directory, never from a document</p>
          <p className="mt-1">
            {supplier ? (
              <>
                PayPal Payouts pays {supplier.name} at <Mono>{supplier.paypalEmail}</Mono>, the account in your directory
                {printed && printed.toLowerCase() !== supplier.paypalEmail.toLowerCase() ? (
                  <>
                    . The address printed on this invoice, <Mono>{printed}</Mono>, is never used
                  </>
                ) : null}
                : no route, tool or agent reads a payee from a document. Even if you release this invoice, the money goes to the directory account.
              </>
            ) : (
              <>This supplier is not in your directory, so there is no account to pay: an invoice from an unknown sender is never paid.</>
            )}
          </p>
        </li>
        <li className="rounded-xl border border-line bg-card px-4 py-3">
          <p className="font-semibold text-ink">2. The payment agent&rsquo;s tool refuses it</p>
          <p className="mt-1">
            Asked to pay this invoice in full, <Mono>propose_payment_plan</Mono> (the check every plan goes through) answers:
          </p>
          <p className="mt-1.5 rounded-lg bg-paper/80 px-3 py-2 font-mono text-[12.5px] text-terracotta">
            {refusal.length ? refusal.join(" ") : "This invoice is not held any more: you released it, and it would be paid to the directory account above."}
          </p>
          <p className="mt-1.5 text-xs text-muted">Approval refuses it too: held invoices cannot be sent to PayPal until you release them.</p>
        </li>
        {injection && (
          <li className="rounded-xl border border-line bg-card px-4 py-3">
            <p className="font-semibold text-ink">3. The text on the document never reaches the agents</p>
            <p className="mt-1">
              Claude transcribed the instruction as data, quoted above. The payment agent only receives directory names, plain invoice references and the
              rule-written reason{heldReason ? <> (&ldquo;{heldReason}&rdquo;)</> : null}. The purchasing agent never sees invoices.
            </p>
          </li>
        )}
        <li className="rounded-xl border border-line bg-card px-4 py-3">
          <p className="font-semibold text-ink">{injection ? "4" : "3"}. Verify it outside the document</p>
          <p className="mt-1">
            {supplier ? (
              <>
                Call {supplier.contactName} at {supplier.phone}, the number in your directory. Do not reply to the email or use contact details printed on
                the invoice. No credit-note email is drafted for this invoice.
              </>
            ) : (
              <>Confirm who sent it before adding the supplier to your directory. No email is drafted for this invoice.</>
            )}
          </p>
        </li>
      </ol>
    </section>
  );
}
