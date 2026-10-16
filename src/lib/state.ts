// Local persistence: one JSON file under .data/ (git-ignored), written atomically
// and serialised through an in-process lock. Good enough for a single-restaurant
// demo; a real deployment would use a database.

import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_SETTINGS, INITIAL_INVENTORY, SAMPLE_FILES } from "@/data/seed";
import type { AppState, AuditEntry, DocumentRecord } from "./types";

export const DATA_DIR = path.join(process.cwd(), ".data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
export const CACHE_DIR = path.join(DATA_DIR, "claude-cache");
const STATE_FILE = path.join(DATA_DIR, "state.json");
const MAX_AUDIT = 600;

type Store = { lock: Promise<unknown>; state?: AppState };
const g = globalThis as typeof globalThis & { __supploraStore?: Store };
const store: Store = (g.__supploraStore ??= { lock: Promise.resolve() });

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

async function load(): Promise<AppState> {
  if (store.state) return store.state;
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as AppState;
    if (parsed.version !== 1) throw new Error("Unsupported state version");
    // A review cannot survive a server restart: release documents stuck in "reviewing".
    for (const d of parsed.documents) {
      if (d.reviewStatus === "reviewing") d.reviewStatus = d.review ? "reviewed" : "pending";
    }
    store.state = parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") console.error("[state] could not read state, starting fresh:", err);
    store.state = initialState();
    await persist(store.state);
  }
  return store.state;
}

async function persist(state: AppState): Promise<void> {
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

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = store.lock.then(fn, fn);
  store.lock = run.catch(() => undefined);
  return run;
}

/** Read-only snapshot (deep copy, safe to hand to React). */
export async function readState(): Promise<AppState> {
  return withLock(async () => structuredClone(await load()));
}

/**
 * Mutate state under the lock and persist. Keep `fn` fast and synchronous in spirit:
 * never call external APIs inside it.
 */
export async function updateState<T>(fn: (state: AppState) => T): Promise<T> {
  return withLock(async () => {
    const state = await load();
    const draft = structuredClone(state);
    const result = fn(draft);
    if (draft.audit.length > MAX_AUDIT) draft.audit = draft.audit.slice(-MAX_AUDIT);
    await persist(draft);
    store.state = draft;
    return structuredClone(result);
  });
}

export async function resetState(): Promise<void> {
  await withLock(async () => {
    store.state = initialState();
    await persist(store.state);
    await fs.rm(UPLOAD_DIR, { recursive: true, force: true });
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
