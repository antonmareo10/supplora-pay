"use client";

// AG Studio only runs in the browser and is large, so it loads on this page alone, after the
// server-rendered header, never in the bundles of the other pages.

import dynamic from "next/dynamic";
import type { StudioTables } from "@/lib/studio-data";
import type { StudioAiConfig } from "./ai/config";

const LedgerStudioWithAi = dynamic(() => import("./LedgerStudioWithAi"), {
  ssr: false,
  loading: () => (
    <div role="status" className="grid h-[78vh] min-h-[620px] place-items-center rounded-2xl border border-line bg-paper text-sm text-muted">
      Loading AG Studio…
    </div>
  ),
});

export function StudioLoader(props: { tables: StudioTables; licenseKey?: string; ai: StudioAiConfig }) {
  return <LedgerStudioWithAi {...props} />;
}
