"use client";

import { buttonClass } from "@/components/ui";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="rounded-2xl border border-terracotta/30 bg-terracotta-soft p-6">
      <p className="font-display text-3xl text-ink">Something went wrong</p>
      <p className="mt-2 text-sm text-ink-2">{error.message || "Unexpected error."}</p>
      <button type="button" onClick={reset} className={`${buttonClass("ink")} mt-4`}>
        Try again
      </button>
    </div>
  );
}
