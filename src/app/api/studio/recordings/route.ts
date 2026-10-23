// Local recording only: saves live runs of the suggested Studio prompts as the replays the keyless
// public demo plays back (src/data/recorded/studio-runs.json). Off unless RECORD_DEMO=1 on a dev server.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import recordings from "@/data/recorded/studio-runs.json";
import { PROMPT_STARTERS } from "@/components/client/ledger-studio/ai/starters";
import { assertSameOrigin, errorResponse, HttpError, readJson } from "@/lib/http";

interface Run {
  label: string;
  prompt: string;
  turns: { events: unknown[]; response: { status?: string } }[];
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (process.env.RECORD_DEMO !== "1" || process.env.NODE_ENV === "production") throw new HttpError("Recording is off.", 403);
    const body = await readJson<{ model?: string; runs?: Run[] }>(request, 20_000_000);
    const runs = (body.runs ?? []).filter(
      (r) => PROMPT_STARTERS.some((s) => s.prompt === r.prompt) && Array.isArray(r.turns) && r.turns.length > 0 && r.turns.every((t) => t.response?.status === "completed"),
    );
    if (runs.length === 0) throw new HttpError("No complete run of a suggested prompt to save.", 400);
    // The latest complete run of each prompt replaces the old one; prompts keep their order.
    const existing = (recordings as unknown as { runs: Run[] }).runs;
    const byPrompt = new Map(existing.map((r) => [r.prompt, r]));
    for (const r of runs) byPrompt.set(r.prompt, r);
    const ordered = PROMPT_STARTERS.map((s) => byPrompt.get(s.prompt)).filter((r): r is Run => !!r);
    const file = { version: 1, recordedAt: new Date().toISOString(), model: body.model ?? null, runs: ordered };
    await writeFile(path.join(process.cwd(), "src", "data", "recorded", "studio-runs.json"), JSON.stringify(file, null, 1) + "\n", "utf8");
    return Response.json({ saved: runs.length });
  } catch (err) {
    return errorResponse(err);
  }
}
