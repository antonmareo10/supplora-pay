import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { StudioLoader } from "@/components/client/ledger-studio/StudioLoader";
import { Card, PageHeader } from "@/components/ui";
import { businessToday } from "@/lib/dates";
import { buildStudioTables } from "@/lib/studio-data";
import { studioAiConfig } from "@/lib/studio-ai";
import { readState } from "@/lib/state";

export const metadata: Metadata = { title: "Ledger studio" };

export default async function LedgerStudioPage() {
  await connection();
  const state = await readState();
  const tables = buildStudioTables(state, businessToday());
  // AG Studio licence keys are client-side by design (like AG Grid's); unset, Studio runs as a trial.
  const licenseKey = process.env.AG_STUDIO_LICENSE_KEY?.trim() || undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Ledger · AG Studio"
        title="Ask the ledger anything"
        actions={
          <Link href="/ledger" className="rounded-full border border-line-2 bg-card px-3.5 py-2 text-sm font-medium text-ink hover:border-ink-2/50">
            Back to the ledger
          </Link>
        }
      >
        The week&apos;s payables as an AG Studio report: what falls due each week, why money was held back, which supplier owes a credit
        note, and every PayPal payout. Click any bar or supplier to filter the page, switch to Edit to change it, or ask Claude to build
        a view for you.
      </PageHeader>

      {tables.invoices.length === 0 ? (
        <Card className="px-6 py-10 text-center text-muted">
          Nothing reviewed yet.{" "}
          <Link href="/inbox" className="text-ledger-2 underline-offset-2 hover:underline">
            Review the inbox
          </Link>{" "}
          to fill the ledger, then come back.
        </Card>
      ) : (
        <StudioLoader tables={tables} licenseKey={licenseKey} ai={studioAiConfig()} />
      )}
    </div>
  );
}
