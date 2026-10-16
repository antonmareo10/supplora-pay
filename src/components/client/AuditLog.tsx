"use client";

import { useState } from "react";
import type { AuditEntry } from "@/lib/types";
import { ActivityList } from "../Activity";
import { cx } from "../ui";

const FILTERS: { key: "all" | AuditEntry["actor"]; label: string }[] = [
  { key: "all", label: "All" },
  { key: "paypal", label: "PayPal API calls" },
  { key: "claude", label: "Claude" },
  { key: "agent", label: "Agent decisions" },
  { key: "owner", label: "Owner" },
  { key: "system", label: "System" },
];

export function AuditLog({ entries }: { entries: AuditEntry[] }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const shown = filter === "all" ? entries : entries.filter((e) => e.actor === filter);
  return (
    <div>
      <div role="tablist" aria-label="Filter the audit log" className="mb-3 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const n = f.key === "all" ? entries.length : entries.filter((e) => e.actor === f.key).length;
          return (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={cx(
                "rounded-full border px-3 py-1 text-xs font-medium transition",
                filter === f.key ? "border-ink bg-ink text-paper" : "border-line bg-card text-ink-2 hover:border-line-2",
              )}
            >
              {f.label} <span className="num opacity-70">{n}</span>
            </button>
          );
        })}
      </div>
      <ActivityList entries={shown} />
    </div>
  );
}
