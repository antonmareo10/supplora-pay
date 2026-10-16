import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl px-6 py-24 text-center">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">404</p>
      <h1 className="font-display mt-2 text-5xl text-ink">Not in the ledger</h1>
      <p className="mt-3 text-ink-2">That page, document or store doesn&apos;t exist.</p>
      <Link href="/" className="mt-6 inline-block font-medium text-ledger hover:underline">
        Back to Supplora Pay
      </Link>
    </main>
  );
}
