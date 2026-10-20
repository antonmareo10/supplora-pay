import { fmtDateTime } from "@/lib/dates";
import { fmt } from "@/lib/money";
import type { AuditEntry } from "@/lib/types";
import { cx, Mono } from "./ui";

export const ACTOR_STYLE: Record<AuditEntry["actor"], { label: string; cls: string }> = {
  claude: { label: "Claude", cls: "bg-[#efe6f3] text-[#5b2b6e] border-[#5b2b6e]/20" },
  agent: { label: "Agent", cls: "bg-ledger-soft text-ledger border-ledger/20" },
  owner: { label: "Owner", cls: "bg-olive-soft text-olive border-olive/20" },
  paypal: { label: "PayPal API", cls: "bg-[#e5ecf8] text-paypal border-paypal/20" },
  system: { label: "System", cls: "bg-paper-2 text-ink-2 border-line" },
};

export function ActorBadge({ actor }: { actor: AuditEntry["actor"] }) {
  const a = ACTOR_STYLE[actor];
  return <span className={cx("inline-flex h-fit w-[84px] shrink-0 justify-center self-start rounded-full border px-2 py-0.5 text-[11px] font-semibold", a.cls)}>{a.label}</span>;
}

export function ApiLine({ api }: { api: NonNullable<AuditEntry["api"]> }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-muted">
      {api.via === "toolkit" && (
        <span className="rounded-full border border-paypal/25 bg-[#e5ecf8] px-1.5 py-px text-[10.5px] font-semibold text-paypal" title="Called through the official PayPal Agent Toolkit (MCP server, in-process)">
          Agent Toolkit · MCP
        </span>
      )}
      <Mono className={cx("break-all rounded px-1.5 py-px", api.ok ? "bg-paper-2" : "bg-terracotta-soft text-terracotta")}>
        {api.method} {api.endpoint}
      </Mono>
      <span className={cx("num font-semibold", api.ok ? "text-olive" : "text-terracotta")}>{api.status || "ERR"}</span>
      {api.resourceId && <Mono className="break-all">{api.resourceId}</Mono>}
      <span className="num">{api.durationMs} ms</span>
      {api.requestId && <span title="PayPal-Request-Id (idempotency key)">idem: <Mono>{api.requestId.length > 28 ? `${api.requestId.slice(0, 28)}…` : api.requestId}</Mono></span>}
      {api.debugId && <span title="PayPal debug id">debug: <Mono>{api.debugId}</Mono></span>}
      {api.error && <span className="text-terracotta">{api.error}</span>}
    </div>
  );
}

export function ActivityList({ entries, compact }: { entries: AuditEntry[]; compact?: boolean }) {
  if (!entries.length) return <p className="py-6 text-center text-sm text-muted">No activity yet.</p>;
  return (
    <ol className="divide-y divide-line">
      {entries.map((e) => (
        <li key={e.id} className={cx("flex gap-3", compact ? "py-2.5" : "py-3")}>
          <ActorBadge actor={e.actor} />
          <div className="min-w-0 flex-1">
            <p className={cx("break-words text-ink", compact ? "text-[13px] leading-snug" : "text-sm")}>{e.message}</p>
            {e.api && !compact && <ApiLine api={e.api} />}
          </div>
          <div className="hidden shrink-0 text-right sm:block">
            <time className="num block text-[11px] text-muted" dateTime={e.at}>
              {fmtDateTime(e.at)}
            </time>
            {e.amountCents != null && e.amountCents > 0 && !compact && <span className="num text-xs text-ink-2">{fmt(e.amountCents)}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}
