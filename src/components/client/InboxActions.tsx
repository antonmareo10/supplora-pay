"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { IconSpark, IconUpload } from "../icons";
import { buttonClass, cx, ErrorNote } from "../ui";
import { errorText, postJson } from "./api";

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,application/pdf";

export function ReviewAllButton({ pendingIds, claudeReady }: { pendingIds: string[]; claudeReady: boolean }) {
  const router = useRouter();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  async function run() {
    setErrors([]);
    const queue = [...pendingIds];
    const total = queue.length;
    let done = 0;
    setProgress({ done, total });
    const tick = setInterval(() => router.refresh(), 2500);
    const worker = async () => {
      while (queue.length) {
        const id = queue.shift()!;
        try {
          await postJson(`/api/documents/${id}/review`);
        } catch (err) {
          setErrors((e) => [...e, errorText(err)]);
        }
        done++;
        setProgress({ done, total });
        router.refresh();
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    clearInterval(tick);
    setProgress(null);
    router.refresh();
  }

  if (!pendingIds.length && !progress) return null;
  return (
    <div className="flex flex-col items-end gap-2">
      <button type="button" onClick={run} disabled={!!progress || !claudeReady} className={buttonClass("primary")}>
        <IconSpark size={16} className={progress ? "pulse-dot" : undefined} />
        {progress ? `Claude is reading… ${progress.done}/${progress.total}` : `Review ${pendingIds.length} with Claude`}
      </button>
      {!claudeReady && <p className="text-xs text-terracotta">Add ANTHROPIC_API_KEY to .env.local to enable reviews.</p>}
      {errors.length > 0 && <ErrorNote className="max-w-sm">{errors[0]}</ErrorNote>}
    </div>
  );
}

export function UploadZone() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    if (file.size > 10 * 1024 * 1024) {
      setError("That file is larger than 10 MB.");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/documents", { method: "POST", body: form });
      const json = (await res.json().catch(() => ({}))) as { document?: { id: string }; error?: string };
      if (!res.ok || !json.document) throw new Error(json.error ?? `Upload failed (${res.status})`);
      router.push(`/inbox/${json.document.id}`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const file = e.dataTransfer.files?.[0];
        if (file) void upload(file);
      }}
      className={cx(
        "flex flex-col items-start gap-3 rounded-2xl border border-dashed px-5 py-4 transition sm:flex-row sm:items-center sm:justify-between",
        drag ? "border-ledger bg-ledger-soft" : "border-line-2 bg-paper/60",
      )}
    >
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-card text-ledger ring-1 ring-line">
          <IconUpload size={18} />
        </span>
        <div>
          <p className="text-sm font-medium text-ink">Add a supplier invoice</p>
          <p className="text-xs text-muted">Drop a phone photo or PDF here (JPEG, PNG, WebP or PDF, up to 10 MB).</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <label className={cx(buttonClass("ghost"), busy && "pointer-events-none opacity-60")}>
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
              e.target.value = "";
            }}
          />
          <IconUpload size={15} />
          {busy ? "Uploading…" : "Choose file"}
        </label>
      </div>
      {error && <ErrorNote className="w-full">{error}</ErrorNote>}
    </div>
  );
}
