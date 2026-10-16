"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DocumentRecord } from "@/lib/types";
import { IconCheck, IconMail, IconSpark } from "../icons";
import { buttonClass, ErrorNote } from "../ui";
import { errorText, postJson } from "./api";
import { CopyButton } from "./small";

export function DisputeDraft({ docId, dispute, claudeReady }: { docId: string; dispute: DocumentRecord["dispute"]; claudeReady: boolean }) {
  const router = useRouter();
  const [subject, setSubject] = useState(dispute?.subject ?? "");
  const [body, setBody] = useState(dispute?.body ?? "");
  const [busy, setBusy] = useState<"draft" | "sent" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function draft() {
    setBusy("draft");
    setError(null);
    try {
      const res = await postJson<{ document: DocumentRecord }>(`/api/disputes/${docId}`, { action: "draft" });
      setSubject(res.document.dispute?.subject ?? "");
      setBody(res.document.dispute?.body ?? "");
      router.refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  if (!dispute) {
    return (
      <div className="space-y-3">
        <button type="button" onClick={draft} disabled={!!busy || !claudeReady} className={buttonClass("primary")}>
          <IconSpark size={15} className={busy ? "pulse-dot" : undefined} />
          {busy ? "Claude is writing…" : "Draft the email with Claude"}
        </button>
        {!claudeReady && <p className="text-xs text-terracotta">Add ANTHROPIC_API_KEY to .env.local to draft emails.</p>}
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    );
  }

  const full = `Subject: ${subject}\n\n${body}`;
  const mailto = `mailto:${encodeURIComponent(dispute.to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const sent = dispute.status === "sent";

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-line bg-white">
        <div className="flex flex-wrap items-center gap-x-2 border-b border-line px-4 py-2 text-xs text-muted">
          <span>To</span>
          <code className="font-mono text-ink-2">{dispute.to}</code>
          <span className="ml-auto">{dispute.language === "es" ? "Spanish" : "English"} · drafted by Claude</span>
        </div>
        <label className="block border-b border-line px-4 py-2">
          <span className="sr-only">Subject</span>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={sent}
            className="w-full bg-transparent text-sm font-semibold text-ink outline-none"
          />
        </label>
        <label className="block px-4 py-3">
          <span className="sr-only">Email body</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={sent}
            rows={Math.min(16, Math.max(8, body.split("\n").length + 1))}
            className="w-full resize-y bg-transparent text-sm leading-relaxed text-ink outline-none"
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <CopyButton text={full} label="Copy email" />
        <a href={mailto} className={buttonClass("ghost", "sm")}>
          <IconMail size={14} /> Open in mail app
        </a>
        {!sent && (
          <>
            <button type="button" onClick={draft} disabled={!!busy || !claudeReady} className={buttonClass("quiet", "sm")}>
              {busy === "draft" ? "Rewriting…" : "Redraft"}
            </button>
            <button
              type="button"
              disabled={!!busy}
              onClick={async () => {
                setBusy("sent");
                setError(null);
                try {
                  await postJson(`/api/disputes/${docId}`, { action: "sent", subject, body });
                  router.refresh();
                } catch (err) {
                  setError(errorText(err));
                } finally {
                  setBusy(null);
                }
              }}
              className={buttonClass("ink", "sm")}
            >
              <IconCheck size={14} /> {busy === "sent" ? "Saving…" : "Mark as sent"}
            </button>
          </>
        )}
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  );
}
