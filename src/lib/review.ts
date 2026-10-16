// AI review of a supplier document:
//   1. Claude (vision) transcribes it into a typed Extraction (structured output, Zod)
//      and maps the supplier and each line to the restaurant's directory.
//   2. The deterministic rules in checks.ts compare that with price history, the
//      signed delivery note and payment history, and compute every euro.
// Claude results are cached by file hash so re-running the demo costs nothing.

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { CATALOG, DELIVERY_NOTES, PAID_INVOICES, PRICE_HISTORY, RESTAURANT, SAMPLE_FILES, SUPPLIERS } from "@/data/seed";
import { runChecks, type OtherDocument } from "./checks";
import { anthropic, claudeErrorMessage, MODEL, usageLabel } from "./claude";
import { businessToday } from "./dates";
import { fmt } from "./money";
import { CACHE_DIR, UPLOAD_DIR, auditEntry, readState, updateState } from "./state";
import type { AppState, DocumentRecord, Extraction, PaidInvoice, ReviewRecord } from "./types";
import { isSettled } from "./ap";

const PROMPT_VERSION = "review-v1";

const ExtractionSchema = z.object({
  document_type: z.enum(["invoice", "credit_note", "delivery_note", "receipt", "other"]),
  language: z.string().describe("ISO 639-1 code of the document's language, e.g. es or en"),
  supplier_name: z.string().describe("Issuer's name exactly as printed"),
  supplier_tax_id: z.string().nullable().describe("Issuer's tax ID (CIF/NIF/VAT no.) as printed"),
  matched_supplier_id: z.string().nullable().describe("id from the supplier directory, or null"),
  payment_email: z.string().nullable().describe("PayPal or remittance email printed for payment, or null"),
  invoice_number: z.string().nullable(),
  invoice_date: z.string().nullable().describe("YYYY-MM-DD"),
  due_date: z.string().nullable().describe("YYYY-MM-DD, only if printed"),
  payment_terms: z.string().nullable().describe("Payment terms as printed"),
  early_payment_discount: z
    .object({ percent: z.number(), within_days: z.number() })
    .nullable()
    .describe("Only when the document offers a discount for paying early"),
  delivery_note_refs: z.array(z.string()).describe("Delivery note / albarán numbers referenced"),
  currency: z.string().describe("ISO 4217 code, e.g. EUR"),
  lines: z.array(
    z.object({
      description: z.string(),
      matched_item_key: z.string().nullable().describe("Key from this supplier's product list, or null"),
      quantity: z.number(),
      unit: z.string(),
      unit_price: z.number(),
      line_total: z.number().describe("Line total exactly as printed, even if it looks wrong"),
      vat_rate_percent: z.number().nullable(),
    }),
  ),
  subtotal: z.number().nullable().describe("Taxable base before VAT, as printed"),
  vat_total: z.number().nullable().describe("Total VAT, as printed"),
  total: z.number().describe("Amount due, as printed"),
  observations: z
    .array(z.object({ text: z.string(), severity: z.enum(["info", "warning"]) }))
    .describe("Only things on the document that should change whether or how much to pay"),
  legibility: z.enum(["clear", "partly_legible", "poor"]),
});

const SYSTEM = `You read supplier documents for ${RESTAURANT.name}, an independent restaurant in Málaga, Spain, and transcribe them into structured data for its accounts-payable team. Documents may be in Spanish or English.

Rules:
- Transcribe exactly what is printed. Never correct arithmetic, prices, quantities or totals, even when they look wrong: discrepancies are detected afterwards by comparing your transcription with signed delivery notes and price history. If a printed line total disagrees with quantity × unit price, report the printed line total.
- Numbers as plain decimals with a dot (Spanish "1.234,56" → 1234.56, "7,5" → 7.5). Dates as YYYY-MM-DD (Spanish documents use DD/MM/YYYY).
- matched_supplier_id: the id from the supplier directory when the issuer is clearly that supplier (same name or tax ID); otherwise null.
- matched_item_key: for each line, the key from that supplier's product list when it is clearly the same product (wording or language may differ); otherwise null. Never map to another supplier's products.
- payment_email: the PayPal or remittance email printed for payment, if any.
- early_payment_discount: only when the document offers a discount for early payment (for example "2/10 net 30" means 2% if paid within 10 days).
- observations: only things visible on the document that should change whether or how much the restaurant pays, for example: marked as a copy, reminder or duplicate; handwritten corrections; new or changed bank or payment details; a different customer; missing tax ID; unusual terms. Use severity "warning" for those and "info" for minor notes. Do not repeat arithmetic or price problems here. Return an empty list when nothing is unusual.
- legibility: how reliably you could read the numbers.`;

function directoryText(): string {
  const dir = SUPPLIERS.map((s) => ({
    id: s.id,
    name: s.name,
    tax_id: s.taxId,
    products: CATALOG.filter((c) => c.supplierId === s.id).map((c) => `${c.key}: ${c.name} (${c.unit})`),
  }));
  return JSON.stringify(dir, null, 1);
}

type ImageMime = "image/png" | "image/jpeg" | "image/webp" | "image/gif";
export const ACCEPTED_MIME = ["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"] as const;

interface CachedExtraction {
  extraction: Extraction;
  model: string;
  durationMs: number;
  createdAt: string;
  usage?: string;
}

async function readCache(key: string): Promise<CachedExtraction | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(CACHE_DIR, `${key}.json`), "utf8")) as CachedExtraction;
  } catch {
    return null;
  }
}

async function writeCache(key: string, value: CachedExtraction): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(value, null, 1), "utf8");
}

export async function documentBytes(doc: DocumentRecord): Promise<Buffer> {
  if (doc.origin === "sample") {
    if (!SAMPLE_FILES.includes(doc.fileName)) throw new Error("Unknown sample file");
    return fs.readFile(path.join(process.cwd(), "public", "samples", doc.fileName));
  }
  const ext = doc.mimeType === "application/pdf" ? "pdf" : doc.mimeType.split("/")[1];
  if (!/^up_[a-f0-9]{12}$/.test(doc.id)) throw new Error("Invalid document id");
  return fs.readFile(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ UPLOAD_DIR, `${doc.id}.${ext}`));
}

async function extract(doc: DocumentRecord): Promise<{ result: CachedExtraction; cached: boolean; messageId?: string }> {
  const bytes = await documentBytes(doc);
  const key = createHash("sha256").update(PROMPT_VERSION).update(MODEL).update(doc.mimeType).update(bytes).digest("hex").slice(0, 40);
  const hit = await readCache(key);
  if (hit) return { result: hit, cached: true };

  const data = bytes.toString("base64");
  const source =
    doc.mimeType === "application/pdf"
      ? ({ type: "document", source: { type: "base64", media_type: "application/pdf", data } } as const)
      : ({ type: "image", source: { type: "base64", media_type: doc.mimeType as ImageMime, data } } as const);

  const started = Date.now();
  const response = await anthropic().messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    output_config: { effort: "medium", format: zodOutputFormat(ExtractionSchema) },
    messages: [
      {
        role: "user",
        content: [
          source,
          { type: "text", text: `Supplier directory with each supplier's products:\n${directoryText()}\n\nTranscribe this document.` },
        ],
      },
    ],
  });
  if (response.stop_reason === "refusal") throw new Error("Claude declined to read this document.");
  if (response.stop_reason === "max_tokens") throw new Error("The document is too long to read in one pass.");
  const parsed = response.parsed_output;
  if (!parsed) throw new Error("Claude's answer did not match the invoice schema. Try again.");
  const result: CachedExtraction = {
    extraction: parsed as Extraction,
    model: response.model,
    durationMs: Date.now() - started,
    createdAt: new Date().toISOString(),
    usage: usageLabel(response.usage),
  };
  await writeCache(key, result);
  return { result, cached: false, messageId: response.id };
}

/** Paid invoices known to Supplora: history before the app plus everything paid through it. */
function paidInvoices(state: AppState, excludeDocId: string): PaidInvoice[] {
  const viaApp: PaidInvoice[] = state.documents
    .filter((d) => d.id !== excludeDocId && d.review?.supplierId && d.review.extraction.invoice_number && isSettled(d))
    .map((d) => ({
      supplierId: d.review!.supplierId!,
      invoiceNumber: d.review!.extraction.invoice_number!,
      amountCents: d.payment.amountCents ?? d.review!.payableCents,
      paidAt: (d.payment.at ?? new Date().toISOString()).slice(0, 10),
      method: "paypal",
      reference: d.payment.batchId ? `PayPal batch ${d.payment.batchId}` : "PayPal",
    }));
  return [...PAID_INVOICES, ...viaApp];
}

function otherDocs(state: AppState, docId: string): OtherDocument[] {
  return state.documents
    .filter((d) => d.id !== docId && d.review)
    .map((d) => ({
      docId: d.id,
      addedAt: d.addedAt,
      supplierId: d.review!.supplierId,
      invoiceNumber: d.review!.extraction.invoice_number,
      totalCents: d.review!.invoiceCents,
    }));
}

function check(state: AppState, doc: DocumentRecord, extraction: Extraction) {
  return runChecks(
    extraction,
    { suppliers: SUPPLIERS, catalog: CATALOG, priceHistory: PRICE_HISTORY, deliveryNotes: DELIVERY_NOTES, paidInvoices: paidInvoices(state, doc.id) },
    { today: businessToday(), otherDocs: otherDocs(state, doc.id), addedAt: doc.addedAt },
  );
}

/** Re-run the rules (no Claude) for every reviewed, unpaid document so cross-document checks stay consistent. */
export function recheckAll(state: AppState): void {
  for (const doc of state.documents) {
    if (!doc.review || isSettled(doc)) continue;
    const before = doc.review.recommendation;
    const outcome = check(state, doc, doc.review.extraction);
    doc.review = { ...doc.review, ...outcome };
    if (before !== outcome.recommendation && doc.decision?.by === "agent") doc.decision = undefined;
  }
}

export async function reviewDocument(docId: string): Promise<DocumentRecord> {
  const claimed = await updateState((s) => {
    const doc = s.documents.find((d) => d.id === docId);
    if (!doc) throw new ReviewError("Document not found", 404);
    if (doc.reviewStatus === "reviewing") throw new ReviewError("This document is already being reviewed", 409);
    if (isSettled(doc)) throw new ReviewError("This invoice has already been paid", 409);
    doc.reviewStatus = "reviewing";
    doc.reviewError = undefined;
    return doc;
  });

  let ex: Awaited<ReturnType<typeof extract>>;
  try {
    ex = await extract(claimed);
  } catch (err) {
    const message = claudeErrorMessage(err);
    await updateState((s) => {
      const doc = s.documents.find((d) => d.id === docId);
      if (doc) {
        doc.reviewStatus = "failed";
        doc.reviewError = message;
      }
      s.audit.push(
        auditEntry({
          actor: "claude",
          message: `Could not read ${claimed.fileName}: ${message}`,
          api: { method: "POST", endpoint: "/v1/messages", status: (err as { status?: number }).status ?? 0, ok: false, durationMs: 0, error: message },
          ref: { docId },
        }),
      );
    });
    throw new ReviewError(message, 502);
  }

  return updateState((s) => {
    const doc = s.documents.find((d) => d.id === docId);
    if (!doc) throw new ReviewError("Document not found", 404);
    const { extraction } = ex.result;
    const outcome = check(s, doc, extraction);
    const record: ReviewRecord = {
      ...outcome,
      reviewedAt: new Date().toISOString(),
      model: ex.result.model,
      durationMs: ex.result.durationMs,
      cached: ex.cached,
      extraction,
    };
    doc.review = record;
    doc.reviewStatus = "reviewed";
    doc.decision = undefined;
    const supplier = SUPPLIERS.find((x) => x.id === outcome.supplierId);
    s.audit.push(
      auditEntry({
        actor: "claude",
        message: `${ex.cached ? "Reused cached reading of" : "Read"} ${extraction.invoice_number ?? doc.fileName} (${supplier?.name ?? extraction.supplier_name}): ${extraction.lines.length} lines, total ${fmt(outcome.invoiceCents)}${ex.result.usage && !ex.cached ? ` · ${ex.result.usage}` : ""}`,
        api: ex.cached
          ? undefined
          : { method: "POST", endpoint: "/v1/messages", status: 200, ok: true, durationMs: ex.result.durationMs, resourceId: ex.messageId },
        ref: { docId },
      }),
      auditEntry({ actor: "agent", message: `Review of ${extraction.invoice_number ?? doc.fileName}: ${outcome.summary}`, ref: { docId }, amountCents: outcome.payableCents }),
    );
    recheckAll(s);
    return s.documents.find((d) => d.id === docId)!;
  });
}

export class ReviewError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function getDocument(docId: string): Promise<DocumentRecord | undefined> {
  return (await readState()).documents.find((d) => d.id === docId);
}
