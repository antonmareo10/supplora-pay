// App state persistence, serialised per state key through an in-process lock.
//
//  - Local / single-user (default): one JSON file under .data/ (git-ignored), written atomically.
//  - DEMO_MODE (public demo): one state per visitor session (see session.ts), kept in memory on a
//    long-running server (Render), or in Redis when KV_REST_API_URL/KV_REST_API_TOKEN (or the
//    UPSTASH_REDIS_REST_* equivalents) are set, so serverless hosts (Vercel) keep a session's
//    state across instances. Demo sessions expire after a day of inactivity.
//  - DEMO_MODE also keeps a cross-session registry of sent payout batches (see below).
// Good enough for a demo; a real deployment would use a database with per-user auth.

import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_SETTINGS, INITIAL_INVENTORY, SAMPLE_FILES } from "@/data/seed";
import { Breaker } from "./breaker";
import type { DemoPayoutEntry } from "./demo-sweep";
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
const g = globalThis as typeof globalThis & { __supploraSlots?: Map<string, Slot>; __supploraDemoPayouts?: Map<string, DemoPayoutEntry> };
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

// If Redis fails (outage, free-tier limit, bad token), the demo keeps working from this instance's memory
// instead of erroring on every page: the store is skipped for a minute, then tried again.
const redisBreaker = new Breaker(60_000);

/** Redis is configured and not in its cool-down after a failure. */
function redisUp(): boolean {
  return !!redisConfig() && redisBreaker.up();
}

export function stateBackend(key: string): "file" | "memory" | "redis" {
  if (key === "default") return "file";
  return redisUp() ? "redis" : "memory";
}

async function redis(command: string[]): Promise<unknown> {
  const cfg = redisConfig()!;
  try {
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(8_000),
    });
    const json = (await res.json().catch(() => ({}))) as { result?: unknown; error?: string };
    if (!res.ok || json.error) throw new Error(`State store (Redis) error: ${json.error ?? res.status}`);
    return json.result;
  } catch (err) {
    if (redisBreaker.trip()) console.warn("[state] Redis unavailable, using this instance's memory for a minute:", err instanceof Error ? err.message : err);
    throw err;
  }
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
    try {
      const raw = (await redis(["GET", redisKey(key)])) as string | null;
      slot.state = raw ? revive(JSON.parse(raw) as AppState) : initialState();
    } catch {
      slot.state ??= initialState(); // Redis is down: carry on from this instance's memory
    }
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
    // If Redis is down the new state still lives in this instance's memory (the caller keeps it in the slot).
    await redis(["SET", redisKey(key), JSON.stringify(state), "EX", String(SESSION_TTL_MS / 1000)]).catch(() => undefined);
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

/** Whether a state key has a stored session (webhooks must not create sessions for unknown keys). */
export async function stateExists(key: string): Promise<boolean> {
  const backend = stateBackend(key);
  if (backend === "file") return true;
  if (backend === "memory") return !!slots.get(key)?.state;
  try {
    return ((await redis(["EXISTS", redisKey(key)])) as number) === 1;
  } catch {
    return !!slots.get(key)?.state;
  }
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

// ---------------------------------------------------------------------------
// Public demo: registry of every payout batch the demo has sent, across sessions, so the
// housekeeping sweep (demo-sweep.ts) can return unclaimed sandbox money even when the visitor
// never comes back. Same backend as the sessions: process memory, or Redis when configured (so it
// survives restarts and is shared by serverless instances).

const REGISTRY_KEY = "supplora-pay:demo-payout-batches";
const REGISTRY_TTL_S = 31 * 24 * 60 * 60;
const memoryRegistry: Map<string, DemoPayoutEntry> = (g.__supploraDemoPayouts ??= new Map());

export async function registerDemoPayout(entry: DemoPayoutEntry): Promise<void> {
  if (redisUp()) {
    try {
      await redis(["HSET", REGISTRY_KEY, entry.batchId, JSON.stringify(entry)]);
      await redis(["EXPIRE", REGISTRY_KEY, String(REGISTRY_TTL_S)]);
      return;
    } catch {
      /* Redis is down: keep it in memory below */
    }
  }
  memoryRegistry.set(entry.batchId, entry);
}

export async function listDemoPayouts(): Promise<DemoPayoutEntry[]> {
  if (!redisUp()) return [...memoryRegistry.values()];
  let flat: string[];
  try {
    flat = ((await redis(["HGETALL", REGISTRY_KEY])) as string[] | null) ?? [];
  } catch {
    return [...memoryRegistry.values()];
  }
  // Plus anything this instance kept in memory while Redis was down.
  const out: DemoPayoutEntry[] = [...memoryRegistry.values()];
  for (let i = 1; i < flat.length; i += 2) {
    try {
      out.push(JSON.parse(flat[i]) as DemoPayoutEntry);
    } catch {
      /* skip a malformed entry */
    }
  }
  return out;
}

export async function forgetDemoPayout(batchId: string): Promise<void> {
  memoryRegistry.delete(batchId);
  if (redisUp()) await redis(["HDEL", REGISTRY_KEY, batchId]).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// PayPal webhooks: which session owns a PayPal resource (payout batch, order, authorization,
// capture), so a verified event updates the right visitor's ledger. Same backend as the sessions.
// Also the processed-event set that makes webhook handling idempotent (PayPal retries deliveries).

const RESOURCE_KEY = "supplora-pay:paypal-resources";
const EVENTS_KEY = "supplora-pay:webhook-events";
const EVENT_TTL_S = 7 * 24 * 60 * 60;
const MAX_MEMORY_RESOURCES = 20_000;
const gx = globalThis as typeof globalThis & { __supploraResources?: Map<string, string>; __supploraEvents?: Map<string, number> };
const memoryResources: Map<string, string> = (gx.__supploraResources ??= new Map());
const memoryEvents: Map<string, number> = (gx.__supploraEvents ??= new Map());

/** Remember that these PayPal ids belong to the current session. Never throws. */
export async function indexPayPalResources(ids: (string | undefined | null)[]): Promise<void> {
  const list = ids.filter((x): x is string => !!x);
  if (!list.length) return;
  try {
    const key = await currentStateKey();
    if (redisUp()) {
      try {
        await redis(["HSET", RESOURCE_KEY, ...list.flatMap((id) => [id, key])]);
        await redis(["EXPIRE", RESOURCE_KEY, String(REGISTRY_TTL_S)]);
        return;
      } catch {
        /* Redis is down: keep the index in memory below */
      }
    }
    for (const id of list) memoryResources.set(id, key);
    while (memoryResources.size > MAX_MEMORY_RESOURCES) memoryResources.delete(memoryResources.keys().next().value!);
  } catch (err) {
    console.error("[webhooks] could not index PayPal resources:", err instanceof Error ? err.message : err);
  }
}

/** The session that owns the first of these PayPal ids we know, or null. */
export async function sessionForPayPalResources(ids: string[]): Promise<string | null> {
  if (!ids.length) return null;
  if (redisUp()) {
    try {
      const found = ((await redis(["HMGET", RESOURCE_KEY, ...ids])) as (string | null)[] | null) ?? [];
      const hit = found.find((v) => !!v);
      if (hit) return hit;
      // Payout batches sent before the index existed are still in the demo payout registry.
      for (const e of await listDemoPayouts()) if (ids.includes(e.batchId)) return e.key;
    } catch {
      /* Redis is down: look in memory below */
    }
  }
  for (const id of ids) {
    const key = memoryResources.get(id);
    if (key) return key;
  }
  for (const e of memoryRegistry.values()) if (ids.includes(e.batchId)) return e.key;
  return null;
}

/** Claim a webhook event id; false when it was already processed (PayPal retries and duplicates). */
export async function claimWebhookEvent(eventId: string): Promise<boolean> {
  if (redisUp()) {
    try {
      const res = await redis(["SET", `${EVENTS_KEY}:${eventId}`, "1", "NX", "EX", String(EVENT_TTL_S)]);
      return res === "OK";
    } catch {
      /* Redis is down: de-duplicate in memory below */
    }
  }
  const now = Date.now();
  for (const [id, at] of memoryEvents) if (now - at > EVENT_TTL_S * 1000) memoryEvents.delete(id);
  if (memoryEvents.has(eventId)) return false;
  memoryEvents.set(eventId, now);
  return true;
}

/** Processing failed after the claim: let PayPal's retry try again. */
export async function releaseWebhookEvent(eventId: string): Promise<void> {
  memoryEvents.delete(eventId);
  if (redisUp()) await redis(["DEL", `${EVENTS_KEY}:${eventId}`]).catch(() => undefined);
}

export function auditEntry(entry: Omit<AuditEntry, "id" | "at">): AuditEntry {
  return { id: newId("au"), at: new Date().toISOString(), ...entry };
}

export async function audit(entry: Omit<AuditEntry, "id" | "at">): Promise<void> {
  await updateState((s) => {
    s.audit.push(auditEntry(entry));
  });
}
