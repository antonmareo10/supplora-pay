import Link from "next/link";
import { supplierById } from "@/data/seed";
import { effective } from "@/lib/ap";
import { fmtDay, relativeDue } from "@/lib/dates";
import { fmt } from "@/lib/money";
import type { DocumentRecord, Finding } from "@/lib/types";
import { IconDoc } from "./icons";
import { cx, docStatus, Pill, SEVERITY_TONE, Stamp } from "./ui";

export function chipLabel(f: Finding): string {
  switch (f.kind) {
    case "price_increase": {
      const m = /\(\+([\d.]+)%\)/.exec(f.title);
      return m ? `Price +${m[1]}%` : "Price rise";
    }
    case "quantity_mismatch":
      return "Short delivery";
    case "not_delivered":
      return "Not delivered";
    case "arithmetic":
      return "Line-total error";
    case "totals_mismatch":
      return "Totals error";
    case "duplicate":
      return "Duplicate";
    case "possible_duplicate":
      return "Possible duplicate";
    case "early_payment_discount":
      return f.severity === "opportunity" ? "Early-pay discount" : "Discount expired";
    case "due_soon":
      return f.title.replace(/ \(.+\)$/, "");
    case "overdue":
      return "Overdue";
    case "unknown_supplier":
      return "Unknown supplier";
    case "payment_details_changed":
      return "Payment details changed";
    case "suspicious_instruction":
      return "Instruction aimed at the AI";
    case "no_delivery_note":
      return "No delivery note";
    case "not_an_invoice":
      return "Not an invoice";
    case "currency":
      return "Foreign currency";
    default:
      return f.source === "claude" ? "Claude note" : "Note";
  }
}

export function DocThumb({ doc, className }: { doc: DocumentRecord; className?: string }) {
  if (doc.mimeType === "application/pdf") {
    return (
      <div className={cx("grid place-items-center rounded-lg border border-line bg-paper text-muted", className)}>
        <IconDoc size={28} />
        <span className="text-[10px] font-semibold uppercase tracking-wider">PDF</span>
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- local user uploads and static samples, no optimisation needed
  return <img src={doc.url} alt="" loading="lazy" className={cx("rounded-lg border border-line bg-white object-cover object-top", className)} />;
}

export function DocCard({ doc, today }: { doc: DocumentRecord; today: string }) {
  const status = docStatus(doc);
  const r = doc.review;
  const e = effective(doc);
  const supplier = r ? supplierById(r.supplierId)?.name ?? r.extraction.supplier_name : null;
  const chips = r ? r.findings.filter((f) => f.severity !== "info" || f.kind === "due_soon").slice(0, 3) : [];
  return (
    <Link
      href={`/inbox/${doc.id}`}
      className="group grid grid-cols-[76px_minmax(0,1fr)] gap-4 rounded-2xl border border-line bg-card p-3 pr-4 transition hover:-translate-y-px hover:border-line-2 hover:shadow-[0_6px_20px_-12px_rgba(60,45,20,0.35)] sm:grid-cols-[92px_minmax(0,1fr)]"
    >
      <DocThumb doc={doc} className="h-[104px] w-full sm:h-[122px]" />
      <div className="flex min-w-0 flex-col">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 truncate text-[15px] font-semibold text-ink group-hover:text-ledger">{supplier ?? (doc.origin === "upload" ? "Uploaded document" : "New supplier document")}</p>
          <Stamp tone={status.tone} className={doc.reviewStatus === "reviewing" ? "pulse-dot" : undefined}>
            {status.icon}
            {status.label}
          </Stamp>
        </div>
        {r ? (
          <p className="mt-0.5 truncate text-xs text-muted">
            {r.extraction.invoice_number} · issued {fmtDay(r.extraction.invoice_date)} · {relativeDue(today, r.dueDate)}
          </p>
        ) : (
          <p className="mt-0.5 text-xs text-muted">
            <span className="block truncate font-mono text-[11px]">{doc.fileName}</span>
            {doc.origin === "upload" ? "Uploaded" : "Forwarded by email"} · {doc.reviewStatus === "failed" ? <span className="text-terracotta">{doc.reviewError}</span> : doc.reviewStatus === "reviewing" ? "Claude is reading it…" : "waiting for Claude"}
          </p>
        )}
        {r && e && (
          <p className="mt-2 flex flex-wrap items-baseline gap-x-2">
            <span className={cx("num text-lg font-semibold", e.action === "hold" ? "text-muted line-through decoration-1" : "text-ink")}>
              {fmt(e.action === "pay_partial" ? e.payableCents : r.invoiceCents)}
            </span>
            {e.action === "pay_partial" && <span className="num text-xs text-muted">of {fmt(r.invoiceCents)}</span>}
            {e.action === "hold" && <span className="num text-xs text-terracotta">{fmt(r.invoiceCents)} held</span>}
          </p>
        )}
        {chips.length > 0 && (
          <div className="mt-auto flex flex-wrap gap-1.5 pt-2">
            {chips.map((f) => (
              <Pill key={f.id} tone={SEVERITY_TONE[f.severity]}>
                {chipLabel(f)}
              </Pill>
            ))}
          </div>
        )}
        {r && chips.length === 0 && e?.action === "pay_full" && (
          <p className="mt-auto pt-2 text-xs text-olive">Matches delivery note and price history</p>
        )}
      </div>
    </Link>
  );
}
