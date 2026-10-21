import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { DisputeDraft } from "@/components/client/DisputeDraft";
import { DocThumb } from "@/components/DocCard";
import { ACTION_TONE, Card, Empty, PageHeader, paymentLabel, Pill, Stamp } from "@/components/ui";
import { supplierById } from "@/data/seed";
import { ACTION_LABEL, effective } from "@/lib/ap";
import { claudeAvailable } from "@/lib/claude";
import { fmtDateTime } from "@/lib/dates";
import { needsDispute } from "@/lib/disputes";
import { fmt } from "@/lib/money";
import { readState } from "@/lib/state";

export const metadata: Metadata = { title: "Disputes" };

export default async function DisputesPage() {
  await connection();
  const state = await readState();
  const docs = state.documents.filter(needsDispute);
  const total = docs.reduce((s, d) => s + effective(d)!.withheldCents, 0);
  const claudeReady = claudeAvailable();

  return (
    <div>
      <PageHeader kicker="Disputes" title="Ask for the money back, politely">
        For every invoice on hold or paid partially, Claude drafts a short credit-note request in the supplier&apos;s language, with the exact
        numbers from the review. You edit, copy or send it from your own mail app.
        {docs.length > 0 && <span className="mt-1 block text-sm text-muted">{docs.length} invoices · {fmt(total)} withheld or held</span>}
      </PageHeader>

      {docs.length === 0 ? (
        <Empty
          title="Nothing to dispute"
          action={
            <Link href="/inbox" className="text-sm font-medium text-ledger hover:underline">
              Review the inbox
            </Link>
          }
        >
          When a review finds a price rise, a short delivery, a wrong total or a duplicate, the invoice appears here.
        </Empty>
      ) : (
        <ul className="space-y-6">
          {docs.map((doc) => {
            const r = doc.review!;
            const e = effective(doc)!;
            const supplier = supplierById(r.supplierId);
            const issues = r.findings.filter((f) => f.withholdCents > 0 || f.severity === "high");
            return (
              <li key={doc.id}>
                <Card className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)]">
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <DocThumb doc={doc} className="h-20 w-16 shrink-0" />
                      <div className="min-w-0">
                        <Link href={`/inbox/${doc.id}`} className="font-semibold text-ink hover:text-ledger">
                          {supplier?.name ?? r.extraction.supplier_name}
                        </Link>
                        <p className="text-xs text-muted">
                          {r.extraction.invoice_number} · invoice {fmt(r.invoiceCents)}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Stamp tone={ACTION_TONE[e.action]}>{ACTION_LABEL[e.action]}</Stamp>
                          {doc.dispute?.status === "sent" ? (
                            <Pill tone="olive">Sent {doc.dispute.sentAt ? fmtDateTime(doc.dispute.sentAt) : ""}</Pill>
                          ) : doc.dispute ? (
                            <Pill tone="ledger">Draft ready</Pill>
                          ) : (
                            <Pill>Not drafted</Pill>
                          )}
                        </div>
                      </div>
                    </div>
                    <p className="num text-2xl font-semibold text-terracotta">
                      {fmt(e.withheldCents)} <span className="text-sm font-normal text-muted">{e.action === "hold" ? "held" : "withheld"}</span>
                    </p>
                    <ul className="space-y-2">
                      {issues.map((f) => (
                        <li key={f.id} className="rounded-lg bg-paper/70 px-3 py-2 text-[13px]">
                          <p className="font-medium text-ink">{f.title}</p>
                          <p className="mt-0.5 text-ink-2">{f.detail}</p>
                        </li>
                      ))}
                    </ul>
                    {doc.payment.status !== "unpaid" && (
                      <p className="text-xs text-muted">
                        Payment status: {paymentLabel(doc.payment.status)}
                        {doc.payment.amountCents != null && ` · ${fmt(doc.payment.amountCents)} sent via PayPal`}
                      </p>
                    )}
                  </div>
                  <DisputeDraft key={`${doc.id}-${doc.dispute?.createdAt ?? "none"}`} docId={doc.id} dispute={doc.dispute} claudeReady={claudeReady} />
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
