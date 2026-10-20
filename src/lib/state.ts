// App state persistence, serialised per state key through an in-process lock.
//
//  - Local / single-user (default): one JSON file under .data/ (git-ignored), written atomically.
//  - DEMO_MODE (public demo): one state per visitor session (see session.ts), kept in memory on a
//    long-running server (Render), or in Redis when KV_REST_API_URL/KV_REST_API_TOKEN (or the
//    UPSTASH_REDIS_REST_* equivalents) are set, so serverless hosts (Vercel) keep a session's
//    state across instances. Demo sessions expire after a day of inactivity.
// Good enough for a demo; a real deployment would use a database with per-user auth.

import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_SETTINGS, INITIAL_INVENTORY, SAMPLE_FILES } from "@/data/seed";
import { currentStateKey } from "./session";
import type { AppState, AuditEntry, DocumentRecord } from "./types";

export const DATA_DIR = path.join(process.cwd(), ".data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
export const CACHE_DIR = path.join(DATA_DIR, "claude-cache");
const STATE_FILE = path.join(DATA_DIR, "state.json");
const MAX_AUDIT = 600;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_MEMORY_SESSIONS = 400;

type Slot = { lock: Promise<unknown>; state?: AppState; touched: number };
const g = globalThis as typeof globalThis & { __supploraSlots?: Map<string, Slot> };
const slots: Map<string, Slot> = (g.__supploraSlots ??= new Map());

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function initialState(): AppState {
  const documents: DocumentRecord[] = SAMPLE_FILES.map((file, i) => ({
    id: `doc-${String(i + 1).padStart(2, "0")}`,
    origin: "sample",
    fileName: file,
    mimeType: "image/png",
    url: `/samples/${file}`,
    // Arrived through the morning, in this order (earlier copies win duplicate checks).
    addedAt: `2026-10-16T0${7 + Math.floor(i / 3)}:${String(5 + (i % 3) * 17).padStart(2, "0")}:00.000Z`,
    reviewStatus: "pending",
    payment: { status: "unpaid" },
  }));
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    settings: { ...DEFAULT_SETTINGS },
    documents,
    plans: [],
    batches: [],
    proposals: [],
    orders: [],
    inventory: INITIAL_INVENTORY.map((i) => ({ ...i })),
    audit: [
      {
        id: newId("au"),
        at: new Date().toISOString(),
        actor: "system",
        message: `${documents.length} supplier documents arrived in the inbox (forwarded from the restaurant's email by Supplora).`,
      },
    ],
  };
}

/** A review cannot survive a restart: release documents stuck in "reviewing". */
function revive(parsed: AppState): AppState {
  if (parsed.version !== 1) throw new Error("Unsupported state version");
  for (const d of parsed.documents) {
    if (d.reviewStatus === "reviewing") d.reviewStatus = d.review ? "reviewed" : "pending";
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Backends

function redisConfig(): { url: string; token: string } | null {
  const url = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL)?.trim();
  const token = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN)?.trim();
  return url && token ? { url: url.replace(/\/+$/, ""), token } : null;
}

export function stateBackend(key: string): "file" | "memory" | "redis" {
  if (key === "default") return "file";
  return redisConfig() ? "redis" : "memory";
}

async function redis(command: string[]): Promise<unknown> {
  const cfg = redisConfig()!;
  const res = await fetch(cfg.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(8_000),
  });
  const json = (await res.json().catch(() => ({}))) as { result?: unknown; error?: string };
  if (!res.ok || json.error) throw new Error(`State store (Redis) error: ${json.error ?? res.status}`);
  return json.result;
}

const redisKey = (key: string) => `supplora-pay:state:${key}`;

async function loadFrom(key: string, slot: Slot): Promise<AppState> {
  const backend = stateBackend(key);
  if (backend === "memory") {
    slot.state ??= initialState();
    return slot.state;
  }
  if (backend === "redis") {
    // Always read fresh: another serverless instance may have written this session.
    const raw = (await redis(["GET", redisKey(key)])) as string | null;
    slot.state = raw ? revive(JSON.parse(raw) as AppState) : initialState();
    return slot.state;
  }
  if (slot.state) return slot.state;
  try {
    slot.state = revive(JSON.parse(await fs.readFile(STATE_FILE, "utf8")) as AppState);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") console.error("[state] could not read state, starting fresh:", err);
    slot.state = initialState();
    await persistTo(key, slot.state);
  }
  return slot.state;
}

async function persistTo(key: string, state: AppState): Promise<void> {
  const backend = stateBackend(key);
  if (backend === "memory") return;
  if (backend === "redis") {
    await redis(["SET", redisKey(key), JSON.stringify(state), "EX", String(SESSION_TTL_MS / 1000)]);
    return;
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${STATE_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 1), "utf8");
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(tmp, STATE_FILE);
      return;
    } catch (err) {
      // Windows can briefly lock the target (antivirus, indexers): retry a few times.
      if (attempt >= 5 || (err as NodeJS.ErrnoException).code !== "EPERM") throw err;
      await new Promise((r) => setTimeout(r, 40 * (attempt + 1)));
    }
  }
}

function slotFor(key: string): Slot {
  const now = Date.now();
  let slot = slots.get(key);
  if (!slot) {
    slot = { lock: Promise.resolve(), touched: now };
    slots.set(key, slot);
    // Forget idle demo sessions so a long-running server stays small.
    for (const [k, s] of slots) if (k !== "default" && k !== key && now - s.touched > SESSION_TTL_MS) slots.delete(k);
    if (slots.size > MAX_MEMORY_SESSIONS) {
      const idle = [...slots.entries()].filter(([k]) => k !== "default" && k !== key).sort((a, b) => a[1].touched - b[1].touched);
      while (idle.length && slots.size > MAX_MEMORY_SESSIONS) slots.delete(idle.shift()![0]);
    }
  }
  slot.touched = now;
  return slot;
}

function withLock<T>(slot: Slot, fn: () => Promise<T>): Promise<T> {
  const run = slot.lock.then(fn, fn);
  slot.lock = run.catch(() => undefined);
  return run;
}

// ---------------------------------------------------------------------------
// API

/** Read-only snapshot of the current session's state (deep copy, safe to hand to React). */
export async function readState(): Promise<AppState> {
  const key = await currentStateKey();
  const slot = slotFor(key);
  return withLock(slot, async () => structuredClone(await loadFrom(key, slot)));
}

/**
 * Mutate the current session's state under the lock and persist. Keep `fn` fast and
 * synchronous in spirit: never call external APIs inside it.
 */
export async function updateState<T>(fn: (state: AppState) => T): Promise<T> {
  const key = await currentStateKey();
  const slot = slotFor(key);
  return withLock(slot, async () => {
    const state = await loadFrom(key, slot);
    const draft = structuredClone(state);
    const result = fn(draft);
    if (draft.audit.length > MAX_AUDIT) draft.audit = draft.audit.slice(-MAX_AUDIT);
    await persistTo(key, draft);
    slot.state = draft;
    return structuredClone(result);
  });
}

export async function resetState(): Promise<void> {
  const key = await currentStateKey();
  const slot = slotFor(key);
  await withLock(slot, async () => {
    slot.state = initialState();
    await persistTo(key, slot.state);
    if (key === "default") await fs.rm(UPLOAD_DIR, { recursive: true, force: true });
  });
}

export function auditEntry(entry: Omit<AuditEntry, "id" | "at">): AuditEntry {
  return { id: newId("au"), at: new Date().toISOString(), ...entry };
}

export async function audit(entry: Omit<AuditEntry, "id" | "at">): Promise<void> {
  await updateState((s) => {
    s.audit.push(auditEntry(entry));
  });
}
