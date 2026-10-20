import type { Metadata } from "next";
import { connection } from "next/server";
import { ReviewAllButton, UploadZone } from "@/components/client/InboxActions";
import { DocCard } from "@/components/DocCard";
import { PageHeader } from "@/components/ui";
import { claudeAvailable } from "@/lib/claude";
import { businessToday } from "@/lib/dates";
import { fmt } from "@/lib/money";
import { demoMode } from "@/lib/session";
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
        actions={<ReviewAllButton pendingIds={pending} claudeReady={claudeAvailable()} />}
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
        {demoMode() ? (
          <p className="rounded-2xl border border-dashed border-line-2 bg-paper/60 px-5 py-4 text-sm text-ink-2">
            <span className="font-medium text-ink">Uploads are off in the public demo.</span> Nothing here calls Claude: the six sample invoices replay
            Claude&rsquo;s recorded readings. Run the app with your own Anthropic key (see the README) to read your own invoices.
          </p>
        ) : (
          <UploadZone />
        )}
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
