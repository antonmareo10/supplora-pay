// Drafts a polite credit-note request for held or partially paid invoices, in the
// supplier's language, with the evidence from the review.

import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { DELIVERY_NOTES, RESTAURANT, supplierById } from "@/data/seed";
import { effective, FRAUD_HOLD_KINDS } from "./ap";
import { anthropic, claudeErrorMessage, claudeMode, MODEL, usageLabel } from "./claude";
import { fmtDay } from "./dates";
import { fmt } from "./money";
import { fingerprint, recordedDispute, recordMode, saveRecordedDispute } from "./recordings";
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
  // Possible fraud (changed payee, instructions aimed at the AI, unknown sender) is verified by phone,
  // never answered by email: the email channel may be the compromised one.
  if (e.action === "hold" && doc.review.findings.some((f) => FRAUD_HOLD_KINDS.includes(f.kind))) return false;
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
  // Recordings are keyed by the exact facts Claude saw; this session's payout batch id is the
  // only value that legitimately differs between runs, so it is normalised out and swapped back.
  const BATCH = "{PAYOUT_BATCH}";
  const batchId = doc.payment.batchId;
  const factsKey = fingerprint({ language, facts: batchId ? JSON.parse(JSON.stringify(facts).replaceAll(batchId, BATCH)) : facts });
  const started = Date.now();
  let subject: string;
  let body: string;
  if (claudeMode() === "replay") {
    const rec = recordedDispute(factsKey);
    const swap = (text: string) => (rec?.placeholders[BATCH] && batchId ? text.replaceAll(rec.placeholders[BATCH], batchId) : text);
    if (rec) {
      subject = swap(rec.subject);
      body = swap(rec.body);
    } else {
      // No recording for this exact situation: a plain template, clearly labelled.
      subject = `Invoice ${r.extraction.invoice_number ?? ""}: request for a credit note`.trim();
      body = [
        `Dear ${supplier.contactName},`,
        "",
        `About invoice ${r.extraction.invoice_number} of ${r.extraction.invoice_date} (${fmt(r.invoiceCents)}). ${paidPart}`,
        "",
        ...issues.map((f) => `- ${f.title}: ${f.detail}`),
        "",
        e.action === "hold" ? "Could you confirm this invoice can be cancelled?" : `Could you send us a credit note for ${fmt(e.withheldCents)}?`,
        "",
        "Kind regards,",
        RESTAURANT.owner,
        RESTAURANT.name,
        "",
        "[Demo fallback template: no recorded Claude draft matches this exact situation.]",
      ].join("\n");
    }
    await updateState((s) => {
      s.audit.push(
        auditEntry({
          actor: "claude",
          message: rec
            ? `Demo replay of Claude's recorded credit-note request to ${supplier.name} for ${r.extraction.invoice_number} (${rec.model}, ${rec.recordedAt.slice(0, 10)})`
            : `Demo fallback: template credit-note request to ${supplier.name} for ${r.extraction.invoice_number} (no recorded draft for this situation)`,
          ref: { docId },
        }),
      );
    });
    return updateState((s) => {
      const d = s.documents.find((x) => x.id === docId)!;
      d.dispute = { status: "drafted", subject, body, to: supplier.email, language: supplier.language, createdAt: new Date().toISOString() };
      return d;
    });
  }
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
    if (recordMode()) {
      await saveRecordedDispute(factsKey, {
        docId,
        invoiceNumber: r.extraction.invoice_number,
        model: res.model,
        recordedAt: new Date().toISOString(),
        subject,
        body,
        placeholders: batchId ? { [BATCH]: batchId } : {},
      });
    }
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
