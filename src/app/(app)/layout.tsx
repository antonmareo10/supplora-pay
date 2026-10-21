import Link from "next/link";
import { after, connection } from "next/server";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand";
import { NavLinks, type NavCounts } from "@/components/client/NavLinks";
import { ResetDemoButton } from "@/components/client/small";
import { RESTAURANT } from "@/data/seed";
import { lowStock } from "@/lib/ap";
import { claudeMode } from "@/lib/claude";
import { businessToday, fmtDayLong } from "@/lib/dates";
import { needsDispute } from "@/lib/disputes";
import { sweepStaleDemoPayouts } from "@/lib/payments";
import { paypalConfigured } from "@/lib/paypal";
import { demoMode } from "@/lib/session";
import { readState } from "@/lib/state";

function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      <span className={`h-2 w-2 rounded-full ${ok ? "bg-olive-2" : "bg-terracotta"}`} aria-hidden="true" />
      <span>{label}</span>
      <span className="sr-only">{ok ? "connected" : "not configured"}</span>
    </li>
  );
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  await connection();
  const state = await readState();
  const counts: NavCounts = {
    inbox: state.documents.filter((d) => d.reviewStatus !== "reviewed").length,
    payments: state.plans.filter((p) => p.status === "awaiting_approval" || p.status === "partially_paid").reduce((n, p) => n + p.payments.filter((x) => x.status === "proposed").length, 0),
    disputes: state.documents.filter((d) => needsDispute(d) && d.dispute?.status !== "sent").length,
    reorder: lowStock(state).length,
  };
  const today = businessToday();
  const claude = claudeMode();
  const paypal = paypalConfigured();
  const demo = demoMode();
  // Public demo: visits also trigger the payout housekeeping sweep (throttled), after the page is sent.
  if (demo) after(sweepStaleDemoPayouts);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[264px_minmax(0,1fr)]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-paper">
        Skip to content
      </a>
      <aside className="no-print sticky top-0 hidden h-screen flex-col border-r border-line bg-paper-2/70 px-4 py-6 lg:flex">
        <Link href="/" className="flex items-center gap-2.5 px-2">
          <BrandMark />
          <span>
            <span className="font-display block text-[26px] leading-none text-ink">Supplora Pay</span>
            <span className="block whitespace-nowrap text-[10px] uppercase tracking-[0.12em] text-muted">Accounts-payable agent</span>
          </span>
        </Link>

        <div className="mt-6 rounded-xl border border-line bg-card/70 px-3 py-2.5">
          <p className="text-sm font-semibold text-ink">{RESTAURANT.name}</p>
          <p className="text-xs text-muted">Málaga · owner {RESTAURANT.owner}</p>
        </div>

        <div className="mt-5">
          <NavLinks variant="side" counts={counts} />
        </div>

        <div className="mt-auto space-y-3 px-2 text-xs text-ink-2">
          <ul className="space-y-1.5">
            <StatusDot
              ok={claude !== "off"}
              label={claude === "live" ? "Claude · claude-opus-5-5" : claude === "replay" ? "Claude · recorded runs (demo)" : "Claude not configured"}
            />
            <StatusDot ok={paypal} label={paypal ? "PayPal sandbox" : "PayPal not configured"} />
          </ul>
          <p className="text-muted">
            Business date: <span className="text-ink-2">{fmtDayLong(today)}</span>
          </p>
          <ResetDemoButton />
        </div>
      </aside>

      <div className="min-w-0">
        <header className="no-print sticky top-0 z-30 border-b border-line bg-paper/92 px-4 pt-3 backdrop-blur lg:hidden">
          <div className="mb-2 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2">
              <BrandMark size={26} />
              <span className="font-display text-2xl leading-none">Supplora Pay</span>
            </Link>
            <span className="text-xs text-muted">{RESTAURANT.name}</span>
          </div>
          <NavLinks variant="top" counts={counts} />
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 lg:py-10">
          {demo && (
            <aside aria-label="About this demo" className="no-print mb-6 flex flex-col gap-1 rounded-xl border border-ledger/20 bg-ledger-soft px-4 py-2.5 text-[13px] leading-snug text-ledger sm:flex-row sm:items-center sm:gap-3">
              <span className="shrink-0 font-semibold uppercase tracking-wider">Public demo</span>
              <span className="text-ink-2">
                No keys needed: Claude&rsquo;s invoice readings and agent runs are <strong className="font-semibold text-ink">replays of recorded real runs</strong>; every
                rule, approval and <strong className="font-semibold text-ink">PayPal sandbox call runs live</strong>. Your session is private to this browser; use Reset demo to
                start over.
              </span>
            </aside>
          )}
          {children}
        </main>
        <footer className="no-print mx-auto max-w-6xl px-4 pb-10 text-xs text-muted sm:px-8">
          Sandbox demo. Payments use the PayPal sandbox; no real money moves. Built on{" "}
          <a className="underline decoration-line-2 underline-offset-2 hover:text-ink" href="https://www.supplora.app" target="_blank" rel="noreferrer">
            Supplora
          </a>
          .
          <div className="mt-2 lg:hidden">
            <ResetDemoButton />
          </div>
        </footer>
      </div>
    </div>
  );
}
