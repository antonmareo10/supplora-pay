// Small helpers for route handlers: same-origin protection for writes, JSON body
// parsing with a size cap, and mapping domain errors to HTTP responses.

import { PayPalError } from "./paypal";

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Reject cross-site writes: a payments app must not be drivable from another origin. */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return; // same-origin fetches from older browsers / curl
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    if (new URL(origin).host !== host) throw new HttpError("Cross-origin request rejected.", 403);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError("Invalid origin.", 403);
  }
}

export async function readJson<T = Record<string, unknown>>(request: Request, maxBytes = 32_000): Promise<T> {
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError("Request body too large.", 413);
  if (!text) return {} as T;
  try {
    const value = JSON.parse(text);
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error();
    return value as T;
  } catch {
    throw new HttpError("Invalid JSON body.", 400);
  }
}

export function errorResponse(err: unknown): Response {
  if (err instanceof PayPalError) {
    return Response.json({ error: err.message, paypalIssue: err.issue, paypalDebugId: err.debugId }, { status: 502 });
  }
  const status = (err as { status?: unknown })?.status;
  if (err instanceof Error && typeof status === "number" && status >= 400 && status < 600) {
    return Response.json({ error: err.message }, { status });
  }
  console.error("[api] unexpected error:", err);
  return Response.json({ error: err instanceof Error ? err.message : "Unexpected error" }, { status: 500 });
}

/** Wrap a write handler with the same-origin check and error mapping. */
export async function handleWrite(request: Request, fn: () => Promise<Response>): Promise<Response> {
  try {
    assertSameOrigin(request);
    return await fn();
  } catch (err) {
    return errorResponse(err);
  }
}

export function eurosToCents(value: unknown, { min, max }: { min: number; max: number }): number {
  const n = typeof value === "string" ? Number(value.replace(",", ".")) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) throw new HttpError("Enter an amount in euros.", 400);
  const cents = Math.round(n * 100);
  if (cents < min * 100 || cents > max * 100) throw new HttpError(`Amount must be between €${min} and €${max.toLocaleString("en")}.`, 400);
  return cents;
}

const encoder = new TextEncoder();
export function encodeLine(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value) + "\n");
}

/** One agent run at a time per kind (protects API credit and keeps state simple). */
const g = globalThis as typeof globalThis & { __supploraRuns?: Set<string> };
const running = (g.__supploraRuns ??= new Set<string>());
export function acquireRun(kind: string): () => void {
  if (running.has(kind)) throw new HttpError("The agent is already working on this. Wait for it to finish.", 429);
  running.add(kind);
  return () => running.delete(kind);
}
