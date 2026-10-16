export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <div className="h-4 w-40 animate-pulse rounded bg-paper-3" />
      <div className="h-12 w-2/3 animate-pulse rounded-lg bg-paper-3" />
      <div className="h-40 animate-pulse rounded-2xl bg-paper-2" />
      <div className="grid gap-3 md:grid-cols-2">
        <div className="h-32 animate-pulse rounded-2xl bg-paper-2" />
        <div className="h-32 animate-pulse rounded-2xl bg-paper-2" />
      </div>
    </div>
  );
}
