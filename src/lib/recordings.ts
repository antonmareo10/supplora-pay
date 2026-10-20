// Recordings of real Claude work, replayed by the keyless public demo (DEMO_MODE).
//
// They are produced by the app itself: run it locally with real keys and RECORD_DEMO=1, click
// through the demo flow, and every Claude result is written to src/data/recorded/*.json:
//   - reviews.json   invoice readings (vision + structured output), keyed by sample file and
//                    checked against the file's SHA-256 so a changed sample is never replayed;
//   - planner-run.json / restock-run.json   tool-runner runs: Claude's notes and tool calls per
//                    turn, plus a fingerprint of the inputs they were recorded against;
//   - disputes.json  credit-note emails, keyed by a fingerprint of the facts Claude was given.
// Nothing here is hand-written: replay shows Claude's own words; tools, rules and PayPal calls
// run live.

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import disputesFile from "@/data/recorded/disputes.json";
import plannerFile from "@/data/recorded/planner-run.json";
import restockFile from "@/data/recorded/restock-run.json";
import reviewsFile from "@/data/recorded/reviews.json";
import { demoMode } from "./session";
import type { Extraction } from "./types";

const DIR = path.join(process.cwd(), "src", "data", "recorded");

/** Writing recordings: local only, with real keys, never in the public demo. */
export function recordMode(): boolean {
  return process.env.RECORD_DEMO === "1" && !demoMode();
}

export function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function fingerprint(value: unknown): string {
  return sha256(JSON.stringify(value)).slice(0, 24);
}

// ---------------------------------------------------------------------------
// Reviews

export interface RecordedReview {
  sha256: string;
  promptVersion: string;
  model: string;
  recordedAt: string;
  durationMs: number;
  usage?: string;
  extraction: Extraction;
}

export function recordedReview(fileName: string): RecordedReview | null {
  const entries = (reviewsFile as { entries: Record<string, RecordedReview> }).entries;
  return entries[fileName] ?? null;
}

// ---------------------------------------------------------------------------
// Agent runs

export interface RecordedCall {
  id: string;
  tool: string;
  input: Record<string, unknown>;
}

export interface RecordedTurn {
  notes: string[];
  calls: RecordedCall[];
}

export interface AgentRecording {
  kind: "planner" | "restock";
  recordedAt: string;
  model: string;
  fingerprint: string;
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number; requests: number } | null;
  turns: RecordedTurn[];
  meta: Record<string, unknown>;
}

export function recordedRun(kind: "planner" | "restock"): AgentRecording | null {
  const rec = (kind === "planner" ? plannerFile : restockFile) as unknown as AgentRecording;
  return rec.fingerprint && rec.turns.length ? rec : null;
}

// ---------------------------------------------------------------------------
// Disputes

export interface RecordedDispute {
  docId: string;
  invoiceNumber: string | null;
  model: string;
  recordedAt: string;
  subject: string;
  body: string;
  /** Ids that were live at recording time and are swapped for this session's ids on replay. */
  placeholders: Record<string, string>;
}

export function recordedDispute(factsFingerprint: string): RecordedDispute | null {
  return (disputesFile as { entries: Record<string, RecordedDispute> }).entries[factsFingerprint] ?? null;
}

// ---------------------------------------------------------------------------
// Writing (RECORD_DEMO=1 only)

async function update(file: string, fn: (current: Record<string, unknown>) => Record<string, unknown>): Promise<void> {
  if (!recordMode()) return;
  const target = path.join(DIR, file);
  let current: Record<string, unknown> = {};
  try {
    current = JSON.parse(await fs.readFile(target, "utf8"));
  } catch {
    /* new file */
  }
  await fs.writeFile(target, JSON.stringify(fn(current), null, 1) + "\n", "utf8");
}

export async function saveRecordedReview(fileName: string, entry: RecordedReview): Promise<void> {
  await update("reviews.json", (cur) => ({ ...cur, entries: { ...(cur.entries as object), [fileName]: entry } }));
}

export async function saveAgentRecording(rec: AgentRecording): Promise<void> {
  await update(`${rec.kind}-run.json`, (cur) => ({ about: cur.about, ...rec }));
}

export async function saveRecordedDispute(factsFingerprint: string, entry: RecordedDispute): Promise<void> {
  await update("disputes.json", (cur) => ({ ...cur, entries: { ...(cur.entries as object), [factsFingerprint]: entry } }));
}
