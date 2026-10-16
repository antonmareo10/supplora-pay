// Drafts a polite credit-note request for held or partially paid invoices, in the
// supplier's language, with the evidence from the review.

import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { DELIVERY_NOTES, RESTAURANT, supplierById } from "@/data/seed";
import { effective } from "./ap";
import { anthropic, claudeErrorMessage, MODEL, usageLabel } from "./claude";
import { fmtDay } from "./dates";
import { fmt } from "./money";
import { auditEntry, readState, updateState } from "./state";
import type { DocumentRecord } from "./types";

export class DisputeError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const EmailSchema = z.object({
  subject: z.string(),
  body: z.string().describe("Plain-text email body with line breaks, no markdown"),
});

export function needsDispute(doc: DocumentRecord): boolean {
  const e = effective(doc);
  if (!e || !doc.review) return false;
  return e.action === "hold" || e.withheldCents > 0;
}

export async function draftDispute(docId: string): Promise<DocumentRecord> {
  const state = await readState();
  const doc = state.documents.find((d) => d.id === docId);
  if (!doc?.review) throw new DisputeError("Review this invoice first.", 409);
  if (!needsDispute(doc)) throw new DisputeError("Nothing to dispute on this invoice.", 409);
  const supplier = supplierById(doc.review.supplierId);
  if (!supplier) throw new DisputeError("This invoice's supplier is not in your directory; contact them manually.", 409);
  const e = effective(doc)!;
  const r = doc.review;
  const dn = DELIVERY_NOTES.find((n) => n.id === r.deliveryNoteId);
  const issues = r.findings.filter((f) => f.withholdCents > 0 || f.severity === "high");
  const paidPart =
    doc.payment.status === "paid" || doc.payment.status === "unclaimed" || doc.payment.status === "processing"
      ? `We have already paid ${fmt(doc.payment.amountCents ?? e.payableCents)} via PayPal${doc.payment.batchId ? ` (payout batch ${doc.payment.batchId})` : ""}.`
      : e.action === "hold"
        ? "We are holding payment of this invoice."
        : `We will pay ${fmt(e.payableCents)} now and withhold ${fmt(e.withheldCents)}.`;

  const facts = {
    from: { restaurant: RESTAURANT.name, company: RESTAURANT.legalName, signer: RESTAURANT.owner, email: RESTAURANT.email },
    to: { supplier: supplier.name, contact: supplier.contactName, email: supplier.email },
    invoice: {
      number: r.extraction.invoice_number,
      date: r.extraction.invoice_date,
      total: fmt(r.invoiceCents),
      delivery_note: dn ? `${dn.number} (${fmtDay(dn.date)}, signed by ${dn.receivedBy})` : null,
    },
    payment_status: paidPart,
    action: e.action === "hold" ? "hold the whole invoice" : `withhold ${fmt(e.withheldCents)}`,
    issues: issues.map((f) => ({ title: f.title, evidence: f.detail })),
  };

  const language = supplier.language === "es" ? "Spanish (Spain)" : "English";
  const started = Date.now();
  let subject: string;
  let body: string;
  try {
    const res = await anthropic().messages.parse({
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: "medium", format: zodOutputFormat(EmailSchema) },
      system: `You write emails for ${RESTAURANT.owner}, owner of ${RESTAURANT.name}, to her suppliers. Tone: warm, polite and firm; this is a long-term supplier relationship. Be concise (under 170 words in the body). State each issue with the exact numbers given, and make one clear request: a credit note (or, for an invoice already paid, confirmation that the copy can be cancelled). Do not invent facts, amounts or dates beyond those provided. Plain text, no markdown, sign with her name and the restaurant.`,
      messages: [
        {
          role: "user",
          content: `Write the email in ${language}.\n\nFacts:\n${JSON.stringify(facts, null, 1)}`,
        },
      ],
    });
    if (res.stop_reason === "refusal" || !res.parsed_output) throw new Error("Claude could not draft this email.");
    subject = res.parsed_output.subject.trim();
    body = res.parsed_output.body.trim();
    await updateState((s) => {
      s.audit.push(
        auditEntry({
          actor: "claude",
          message: `Drafted a credit-note request to ${supplier.name} for ${r.extraction.invoice_number} · ${usageLabel(res.usage)}`,
          api: { method: "POST", endpoint: "/v1/messages", status: 200, ok: true, durationMs: Date.now() - started, resourceId: res.id },
          ref: { docId },
        }),
      );
    });
  } catch (err) {
    throw new DisputeError(claudeErrorMessage(err), 502);
  }

  return updateState((s) => {
    const d = s.documents.find((x) => x.id === docId)!;
    d.dispute = { status: "drafted", subject, body, to: supplier.email, language: supplier.language, createdAt: new Date().toISOString() };
    return d;
  });
}

export async function markDisputeSent(docId: string, edited?: { subject?: string; body?: string }): Promise<DocumentRecord> {
  return updateState((s) => {
    const d = s.documents.find((x) => x.id === docId);
    if (!d?.dispute) throw new DisputeError("Draft the email first.", 409);
    if (edited?.subject) d.dispute.subject = edited.subject.slice(0, 300);
    if (edited?.body) d.dispute.body = edited.body.slice(0, 8000);
    d.dispute.status = "sent";
    d.dispute.sentAt = new Date().toISOString();
    s.audit.push(
      auditEntry({
        actor: "owner",
        message: `Credit-note request for ${d.review?.extraction.invoice_number ?? d.fileName} marked as sent to ${d.dispute.to}.`,
        ref: { docId },
      }),
    );
    return d;
  });
}
