"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconCheck, IconCopy, IconRefresh } from "../icons";
import { buttonClass, cx } from "../ui";
import { errorText, postJson } from "./api";

export function CopyButton({ text, label = "Copy", className }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          setCopied(false);
        }
      }}
      className={cx(buttonClass("ghost", "sm"), className)}
    >
      {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
      <span aria-live="polite">{copied ? "Copied" : label}</span>
    </button>
  );
}

export function ResetDemoButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          if (!window.confirm("Reset the demo? Reviews, plans and orders are cleared (PayPal sandbox records stay in PayPal). Claude readings stay cached.")) return;
          setBusy(true);
          setError(null);
          try {
            await postJson("/api/reset");
            router.push("/");
            router.refresh();
          } catch (err) {
            setError(errorText(err));
          } finally {
            setBusy(false);
          }
        }}
        className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs text-muted transition hover:bg-paper-2 hover:text-ink"
      >
        <IconRefresh size={13} className={busy ? "animate-spin" : undefined} />
        {busy ? "Resetting…" : "Reset demo"}
      </button>
      {error && <p className="mt-1 text-xs text-terracotta">{error}</p>}
    </div>
  );
}
