// Instant loading state for an invoice. Without it, opening an invoice from the inbox waited for the
// server render (1.5–2.5 s on a cold serverless instance) with no feedback: the inbox stayed on screen,
// the wheel scrolled it, then the invoice replaced it at the top. A loading.tsx lets Next prefetch this
// skeleton with the link, so the click navigates at once (see "Dynamic routes without loading.tsx" in
// node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md).
export default function InvoiceLoading() {
  return (
    <div aria-busy="true" aria-label="Loading the invoice">
      <div className="mb-5 h-5 w-16 animate-pulse rounded bg-paper-3 motion-reduce:animate-none" />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)]">
        <div className="aspect-[1/1.3] animate-pulse rounded-xl border border-line bg-paper-2 motion-reduce:animate-none" />
        <div className="min-w-0 space-y-6">
          <div className="space-y-3">
            <div className="h-7 w-32 animate-pulse rounded-full bg-paper-3 motion-reduce:animate-none" />
            <div className="h-10 w-3/4 animate-pulse rounded-lg bg-paper-3 motion-reduce:animate-none" />
            <div className="h-10 w-full animate-pulse rounded-lg bg-paper-2 motion-reduce:animate-none" />
          </div>
          <div className="h-56 animate-pulse rounded-2xl bg-paper-2 motion-reduce:animate-none" />
          <div className="h-32 animate-pulse rounded-2xl bg-paper-2 motion-reduce:animate-none" />
          <div className="h-32 animate-pulse rounded-2xl bg-paper-2 motion-reduce:animate-none" />
        </div>
      </div>
    </div>
  );
}
