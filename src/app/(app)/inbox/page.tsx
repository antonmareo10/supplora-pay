import type { Metadata } from "next";
import { connection } from "next/server";
import { ReviewAllButton, UploadZone } from "@/components/client/InboxActions";
import { DocCard } from "@/components/DocCard";
import { PageHeader } from "@/components/ui";
import { claudeConfigured } from "@/lib/claude";
import { businessToday } from "@/lib/dates";
import { fmt } from "@/lib/money";
import { readState } from "@/lib/state";

export const metadata: Metadata = { title: "Inbox" };

export default async function InboxPage() {
  await connection();
  const state = await readState();
  const today = businessToday();
  const docs = [...state.documents].sort((a, b) => a.addedAt.localeCompare(b.addedAt));
  const pending = docs.filter((d) => d.reviewStatus === "pending" || d.reviewStatus === "failed").map((d) => d.id);
  const reviewed = docs.filter((d) => d.review);
  const total = reviewed.reduce((s, d) => s + d.review!.invoiceCents, 0);

  return (
    <div>
      <PageHeader
        kicker="Inbox"
        title="Supplier documents"
        actions={<ReviewAllButton pendingIds={pending} claudeReady={claudeConfigured()} />}
      >
        Invoices forwarded from your email or snapped at the kitchen door. Claude reads each one; Supplora checks it against the signed
        delivery note and your price history.
        {reviewed.length > 0 && (
          <span className="mt-1 block text-sm text-muted">
            {reviewed.length} of {docs.length} reviewed · {fmt(total)} invoiced
          </span>
        )}
      </PageHeader>

      <div className="mb-5">
        <UploadZone />
      </div>

      <ul className="grid gap-3 lg:grid-cols-2">
        {docs.map((doc) => (
          <li key={doc.id}>
            <DocCard doc={doc} today={today} />
          </li>
        ))}
      </ul>
    </div>
  );
}
