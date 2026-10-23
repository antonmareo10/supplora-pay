"use client";

// Custom AG Studio widget: the evidence behind every finding, as cards. It needs no field mapping:
// it reads the findings, invoice and supplier fields from the report schema and asks Studio's data
// engine for them, so the page filters and every cross-filter (a supplier picked on the scoreboard,
// a bar clicked on a chart) narrow it to the invoices in question. Each card links to the invoice's
// review, where the owner can change the decision.

import type { AgWidgetField, AgWidgetParams } from "ag-studio";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { EvidenceDef } from "./types";

const FIELDS = {
  id: "findings.id",
  rank: "findings.severityRank",
  severity: "findings.severity",
  kind: "findings.kind",
  title: "findings.title",
  detail: "findings.detail",
  evidence: "findings.evidence",
  withhold: "findings.withhold",
  number: "invoices.number",
  link: "invoices.link",
  supplier: "suppliers.name",
} as const;

type Key = keyof typeof FIELDS;

interface Card {
  key: string;
  severity: string;
  kind: string;
  title: string;
  detail: string;
  evidence: string;
  withhold: string | null;
  number: string;
  link: string | null;
  supplier: string;
}

const DOT: Record<string, string> = { High: "bg-terracotta", Medium: "bg-saffron", Low: "bg-ledger-2", Saving: "bg-olive-2", Info: "bg-line-2" };

export default function EvidenceList(params: AgWidgetParams<EvidenceDef>) {
  const { widgetApi } = params;
  const [cards, setCards] = useState<Card[]>([]);
  const [total, setTotal] = useState(0);
  const loaded = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const byId = new Map<string, AgWidgetField>();
      for (const table of widgetApi.getSchema()) for (const f of table.fields) byId.set(f.fieldId, f);
      const pick = (k: Key) => byId.get(FIELDS[k]);
      const fields = (Object.keys(FIELDS) as Key[]).map(pick).filter((f): f is AgWidgetField => !!f);
      const title = pick("title");
      if (!title) {
        widgetApi.setDisplayState("noData");
        return;
      }
      widgetApi.setDisplayState("loading", { prominent: !loaded.current });
      const rank = pick("rank");
      const withhold = pick("withhold");
      const response = await widgetApi.getData({
        fields,
        sort: [...(rank ? [{ field: rank, direction: "asc" as const }] : []), ...(withhold ? [{ field: withhold, direction: "desc" as const }] : [])],
        limit: { count: 60 },
      });
      if (cancelled) return;
      const val = (row: Record<string, unknown>, k: Key) => {
        const f = pick(k);
        return f ? row[f.key] : undefined;
      };
      const text = (row: Record<string, unknown>, k: Key) => {
        const f = pick(k);
        const v = f ? row[f.key] : undefined;
        return f && v != null ? widgetApi.formatFieldValue(f, v) : "";
      };
      const rows = response.results.rows;
      const next = rows.map((row, i) => {
        const amount = Number(val(row, "withhold")) || 0;
        return {
          key: String(val(row, "id") ?? i),
          severity: String(val(row, "severity") ?? ""),
          kind: text(row, "kind"),
          title: text(row, "title"),
          detail: text(row, "detail"),
          evidence: text(row, "evidence"),
          withhold: amount > 0 ? text(row, "withhold") : null,
          number: text(row, "number"),
          link: typeof val(row, "link") === "string" ? (val(row, "link") as string) : null,
          supplier: text(row, "supplier"),
        };
      });
      loaded.current = next.length > 0;
      setCards(next);
      setTotal(response.results.metadata?.totalRowCount ?? next.length);
      widgetApi.setDisplayState(next.length > 0 ? "displayed" : "noData");
    };
    load().catch(() => {
      if (!cancelled) widgetApi.setDisplayState("noData");
    });
    return () => {
      cancelled = true;
    };
  }, [params, widgetApi]);

  return (
    <div className="h-full min-h-0 overflow-auto px-1 pb-1">
      <ul className="space-y-2">
        {cards.map((c) => (
          <li key={c.key} className="rounded-xl border border-line bg-paper/50 px-3 py-2.5">
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
              <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[c.severity] ?? "bg-line-2"}`} aria-hidden />
              <span>{c.kind}</span>
              <span className="sr-only">severity {c.severity}</span>
              {c.withhold && <span className="num ml-auto normal-case tracking-normal text-terracotta">withhold {c.withhold}</span>}
            </p>
            <p className="mt-1 text-sm font-medium leading-snug text-ink">{c.title}</p>
            {c.detail && c.detail !== c.title && <p className="mt-0.5 line-clamp-3 text-[13px] leading-snug text-ink-2">{c.detail}</p>}
            {c.evidence && <p className="mt-1.5 rounded-lg bg-card px-2 py-1 font-mono text-[11px] leading-snug text-ink-2">{c.evidence}</p>}
            <p className="mt-1.5 text-xs text-muted">
              {c.supplier}
              {c.number && (
                <>
                  {" · "}
                  {c.link ? (
                    <Link href={c.link} className="font-mono text-ledger-2 underline-offset-2 hover:underline">
                      {c.number}
                    </Link>
                  ) : (
                    <span className="font-mono">{c.number}</span>
                  )}
                </>
              )}
            </p>
          </li>
        ))}
      </ul>
      {total > cards.length && <p className="mt-2 text-xs text-muted">Showing {cards.length} of {total}. Filter the page to narrow it down.</p>}
    </div>
  );
}
