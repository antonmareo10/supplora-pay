// Renders an agent run (live or stored) as a timeline of notes and tool calls.
import type { AgentEvent } from "@/lib/types";
import { IconAlert, IconCheck, IconSpark } from "./icons";
import { cx } from "./ui";

interface ToolRow {
  kind: "tool";
  id: string;
  tool: string;
  label: string;
  summary?: string;
  error?: boolean;
  done: boolean;
}
type Row =
  | ToolRow
  | { kind: "note"; text: string; key: string }
  | { kind: "info"; text: string; tone: "replay" | "fallback"; key: string }
  | { kind: "error"; message: string; key: string };

export function toRows(events: AgentEvent[]): Row[] {
  const rows: Row[] = [];
  const tools = new Map<string, ToolRow>();
  events.forEach((e, i) => {
    if (e.type === "note") {
      const last = rows[rows.length - 1];
      if (last?.kind === "note" && last.text === e.text) return;
      rows.push({ kind: "note", text: e.text, key: `n${i}` });
    } else if (e.type === "tool_start") {
      const row: ToolRow = { kind: "tool", id: e.id, tool: e.tool, label: e.label, done: false };
      tools.set(e.id, row);
      rows.push(row);
    } else if (e.type === "tool_end") {
      const row = tools.get(e.id);
      if (row) {
        row.summary = e.summary;
        row.error = e.error;
        row.done = true;
      }
    } else if (e.type === "info") {
      rows.push({ kind: "info", text: e.text, tone: e.tone, key: `i${i}` });
    } else if (e.type === "error") {
      rows.push({ kind: "error", message: e.message, key: `e${i}` });
    }
  });
  return rows;
}

/** **bold** spans (the only inline markup Claude's notes use). React escapes the text. */
function Inline({ text }: { text: string }) {
  const parts = text.split("**");
  return <>{parts.map((part, i) => (i % 2 ? <strong key={i} className="font-semibold text-ink">{part}</strong> : part))}</>;
}

/**
 * Claude's notes: one-liners stay as italic asides; longer messages (the agent's final summary
 * for the owner) get light Markdown: paragraphs, bullet lists and pipe tables.
 */
function NoteText({ text }: { text: string }) {
  const lines = text.split("\n");
  if (lines.length === 1) return <span className="italic"><Inline text={text} /></span>;
  const blocks: { kind: "p" | "ul" | "table"; lines: string[] }[] = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    const kind = line.trimStart().startsWith("|") ? "table" : /^\s*[-*] /.test(line) ? "ul" : line.trim() ? "p" : null;
    if (!kind) {
      blocks.push({ kind: "p", lines: [] });
      continue;
    }
    const last = blocks[blocks.length - 1];
    if (last && last.kind === kind && (kind !== "p" || last.lines.length)) last.lines.push(line);
    else blocks.push({ kind, lines: [line] });
  }
  return (
    <div className="space-y-2 not-italic text-ink-2">
      {blocks.filter((b) => b.lines.length).map((b, i) => {
        if (b.kind === "ul") {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {b.lines.map((l, j) => <li key={j}><Inline text={l.replace(/^\s*[-*] /, "")} /></li>)}
            </ul>
          );
        }
        if (b.kind === "table") {
          const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
          const [head, ...body] = b.lines.filter((l) => !/^\s*\|?\s*:?-{2,}/.test(l));
          const headers = cells(head);
          return (
            <div key={i}>
              {/* Phones: one card per row, every column labelled (a 4-column table would cut "Why"). */}
              <ul className="space-y-2 sm:hidden">
                {body.map((r, j) => {
                  const row = cells(r);
                  return (
                    <li key={j} className="rounded-lg border border-line/80 bg-card/70 px-3 py-2 text-[12.5px]">
                      <p className="font-medium text-ink">
                        <Inline text={row[0] ?? ""} />
                      </p>
                      <dl className="mt-1 space-y-0.5">
                        {headers.slice(1).map((h, k) =>
                          row[k + 1] ? (
                            <div key={k} className="flex gap-2">
                              <dt className="w-[4.5rem] shrink-0 pt-px text-[10.5px] uppercase tracking-wider text-muted">{h}</dt>
                              <dd className="min-w-0">
                                <Inline text={row[k + 1]} />
                              </dd>
                            </div>
                          ) : null,
                        )}
                      </dl>
                    </li>
                  );
                })}
              </ul>
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full min-w-[420px] text-left text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line text-[11px] uppercase tracking-wider text-muted">{headers.map((c, j) => <th key={j} className="py-1 pr-3 font-semibold">{c}</th>)}</tr>
                  </thead>
                  <tbody>
                    {body.map((r, j) => (
                      <tr key={j} className="border-b border-line/70 last:border-0">{cells(r).map((c, k) => <td key={k} className="py-1 pr-3 align-top"><Inline text={c} /></td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        }
        return <p key={i}>{b.lines.map((l, j) => <span key={j}>{j > 0 && <br />}<Inline text={l} /></span>)}</p>;
      })}
    </div>
  );
}

function IconPlay() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M7 4.5v15l13-7.5z" />
    </svg>
  );
}

/** `replay`: the public demo replays a recorded run, so nothing is "thinking" live. */
export function AgentTimeline({ events, running, replay }: { events: AgentEvent[]; running?: boolean; replay?: boolean }) {
  const rows = toRows(events);
  const done = events.find((e) => e.type === "done") as Extract<AgentEvent, { type: "done" }> | undefined;
  const fallback = events.some((e) => e.type === "info" && e.tone === "fallback");
  const replaying = !fallback && (replay || events.some((e) => e.type === "info" && e.tone === "replay"));
  return (
    <ol className="relative space-y-2.5 border-l border-dashed border-line-2 pl-5" aria-live="polite">
      {rows.map((row) => {
        if (row.kind === "note") {
          return (
            <li key={row.key} className="relative text-[13.5px] leading-relaxed text-ink-2">
              <span className="absolute -left-[27px] top-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-paper text-[#5b2b6e]">
                <IconSpark size={12} />
              </span>
              <NoteText text={row.text} />
            </li>
          );
        }
        if (row.kind === "info") {
          return (
            <li key={row.key} className="relative">
              <span className="absolute -left-[27px] top-1 grid h-3.5 w-3.5 place-items-center rounded-full bg-paper text-ledger" aria-hidden="true">
                <IconPlay />
              </span>
              <p className={cx("rounded-lg border px-3 py-2 text-[12.5px] leading-relaxed", row.tone === "replay" ? "border-ledger/20 bg-ledger-soft text-ledger" : "border-saffron/30 bg-saffron-soft text-[#8a5a0c]")}>
                <span className="mr-1.5 font-semibold uppercase tracking-wider">{row.tone === "replay" ? "Demo replay" : "Fallback"}</span>
                {row.text}
              </p>
            </li>
          );
        }
        if (row.kind === "error") {
          return (
            <li key={row.key} role="alert" className="relative text-sm text-terracotta">
              <span className="absolute -left-[27px] top-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-paper">
                <IconAlert size={12} />
              </span>
              {row.message}
            </li>
          );
        }
        return (
          <li key={row.id} className="relative">
            <span
              className={cx(
                "absolute -left-[26px] top-1 h-3 w-3 rounded-full border-2",
                !row.done ? "pulse-dot border-ledger bg-ledger-soft" : row.error ? "border-terracotta bg-terracotta-soft" : "border-olive bg-olive",
              )}
              aria-hidden="true"
            />
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-sm font-medium text-ink">{row.label}</span>
              <code className="font-mono text-[11px] text-muted">{row.tool}</code>
            </div>
            {row.done ? (
              <p className={cx("text-[13px]", row.error ? "text-terracotta" : "text-ink-2")}>
                {!row.error && <IconCheck size={12} className="mr-1 inline text-olive" />}
                {row.summary}
              </p>
            ) : (
              <p className="text-[13px] text-muted">working…</p>
            )}
          </li>
        );
      })}
      {running && !done && (
        <li className="relative text-[13px] text-muted">
          <span className="pulse-dot absolute -left-[25px] top-1.5 h-2 w-2 rounded-full bg-ledger" aria-hidden="true" />
          {fallback ? "Running the rules…" : replaying ? "Replaying recorded run…" : "Claude is thinking…"}
        </li>
      )}
      {done && <li className="text-xs text-muted">Finished in {(done.elapsedMs / 1000).toFixed(1)} s</li>}
    </ol>
  );
}
