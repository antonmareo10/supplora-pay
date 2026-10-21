// Demo mode and per-visitor sessions (server only).
//
// DEMO_MODE=1 turns the app into a keyless public demo:
//   - every visitor gets their own app state, keyed by an httpOnly cookie set in src/proxy.ts,
//     so judges clicking through at the same time never see each other's payments;
//   - Claude is never called: invoice readings and agent runs are replayed from recordings of
//     real runs (src/data/recorded), while the tools, the money rules and every PayPal sandbox
//     call execute for real;
//   - uploads are off (there is no model to read them).
// Without DEMO_MODE the app is single-user and keeps one state file, as before.

import { AsyncLocalStorage } from "node:async_hooks";

export const SESSION_COOKIE = "sp_session";
const SID = /^[a-f0-9]{32}$/;

export function demoMode(): boolean {
  const v = process.env.DEMO_MODE?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function newSessionId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export function isSessionId(value: string | undefined | null): value is string {
  return !!value && SID.test(value);
}

type Pinned = { key: string; ip?: string };
const g = globalThis as typeof globalThis & { __supploraRequestAls?: AsyncLocalStorage<Pinned> };
const als = (g.__supploraRequestAls ??= new AsyncLocalStorage<Pinned>());

/** The state key for the current request: "default" outside demo mode, one per visitor in it. */
export async function currentStateKey(): Promise<string> {
  if (!demoMode()) return "default";
  const pinned = als.getStore()?.key;
  if (pinned) return pinned;
  try {
    const { cookies } = await import("next/headers");
    const sid = (await cookies()).get(SESSION_COOKIE)?.value;
    if (isSessionId(sid)) return `demo:${sid}`;
  } catch {
    /* outside a request (scripts, tests) */
  }
  // No cookie (e.g. curl without a cookie jar): a shared scratch session.
  return "demo:anonymous";
}

/**
 * Pin a state key (and the client IP, for the demo's write caps) for work that outlives the request
 * handler's own scope (streamed agent runs, background housekeeping), so every state read and write
 * inside `fn` hits the same session.
 */
export function runWithStateKey<T>(key: string, fn: () => T, ip?: string): T {
  return als.run({ key, ip }, fn);
}

/**
 * Best-effort client IP for the public demo's per-IP write cap. Prefers headers that hosting edges
 * set themselves (Vercel, Cloudflare), then the first X-Forwarded-For hop. Headers can be spoofed on
 * hosts that pass them through, which is why the demo also has per-session and total caps.
 */
export function clientIpFrom(headers: { get(name: string): string | null }): string {
  for (const name of ["x-vercel-forwarded-for", "cf-connecting-ip", "true-client-ip", "x-real-ip", "x-forwarded-for"]) {
    const value = headers.get(name)?.split(",")[0]?.trim();
    if (value && value.length <= 64) return value;
  }
  return "unknown";
}

export async function currentClientIp(): Promise<string> {
  const pinned = als.getStore();
  if (pinned) return pinned.ip ?? "unknown";
  try {
    const { headers } = await import("next/headers");
    return clientIpFrom(await headers());
  } catch {
    return "unknown"; // outside a request
  }
}
