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
type Row = ToolRow | { kind: "note"; text: string; key: string } | { kind: "error"; message: string; key: string };

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
    } else if (e.type === "error") {
      rows.push({ kind: "error", message: e.message, key: `e${i}` });
    }
  });
  return rows;
}

export function AgentTimeline({ events, running }: { events: AgentEvent[]; running?: boolean }) {
  const rows = toRows(events);
  const done = events.find((e) => e.type === "done") as Extract<AgentEvent, { type: "done" }> | undefined;
  return (
    <ol className="relative space-y-2.5 border-l border-dashed border-line-2 pl-5" aria-live="polite">
      {rows.map((row) => {
        if (row.kind === "note") {
          return (
            <li key={row.key} className="relative text-[13.5px] italic leading-relaxed text-ink-2">
              <span className="absolute -left-[27px] top-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-paper text-[#5b2b6e]">
                <IconSpark size={12} />
              </span>
              {row.text}
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
          Claude is thinking…
        </li>
      )}
      {done && <li className="text-xs text-muted">Finished in {(done.elapsedMs / 1000).toFixed(1)} s</li>}
    </ol>
  );
}
